import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { emptyTask,finalize } from '../server/parsers.mjs';
import { readLog } from '../server/collector.mjs';
import { openStore } from '../server/store.mjs';
import { generateReport,migrateLegacy,buildContext } from '../server/workspace.mjs';
import { testStore } from './mysql-helper.mjs';
const enabled=process.env.AGENTDOCK_INTEGRATION==='true';
test('MySQL: 原子断点、回滚、中文查询、确认时间与重启', {skip:!enabled}, async()=>{
 const {store,config}=await testStore('agentdock_test_store');const t=finalize(emptyTask('codex','test-id','sample.jsonl',{title:'修复同步😀',summary:'来源摘要',updatedAt:Date.now()}));
 try {
 const event={kind:'assistant',timestamp:Date.now(),text:'同一轮回复',evidence:{path:'desktop.jsonl',line:1}};t._newEvents=[event];await store.upsert(t);await store.upsert({...t,_newEvents:[{...event,evidence:{path:'archive.jsonl',line:5}}]});assert.equal((await store.events({task:t.id})).length,1);await store.upsert(t);assert.equal((await store.list()).total,1);
 await assert.rejects(store.transaction(async tx=>{await tx.saveCheckpoint('sample.jsonl',{size:20,mtimeMs:1},20,2,t);await tx.patch(t.id,{note:'回滚的备注'});throw new Error('模拟中断');}));assert.equal(await store.checkpoint('sample.jsonl'),null);assert.equal((await store.get(t.id)).annotation.note,'');
 await store.transaction(async tx=>{await tx.upsert(t);await tx.saveCheckpoint('sample.jsonl',{size:20,mtimeMs:1},20,2,t);});assert.equal((await store.checkpoint('sample.jsonl')).line,2);
 await store.patch(t.id,{note:'人工验证',manualStatus:'done',goalGroup:'交付首版',summaryOverride:'人工补充'});const confirmed=(await store.get(t.id)).annotation.confirmedAt;await store.patch(t.id,{note:'更新备注'});assert.equal((await store.get(t.id)).annotation.confirmedAt,confirmed);await store.upsert({...t,summary:'新的来源回复'});assert.equal((await store.list({q:'首版'})).total,1);assert.match(await store.export(t.id),/人工补充/);
 await store.close();const reopened=await openStore(config);assert.equal((await reopened.get(t.id)).annotation.note,'更新备注');await reopened.close();
 }finally{await store.close().catch(()=>{});}
});
test('MySQL: 跨日完整活动、报告补充与上下文、重复迁移', {skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_reports');mkdirSync('artifacts/unit',{recursive:true});const dir=mkdtempSync(path.resolve('artifacts/unit/migration-'));const file=path.join(dir,'old.sqlite');
 try{
 const at=Date.parse('2026-09-30T12:00:00+08:00');const t=finalize(emptyTask('claude','period-id','period.jsonl',{title:'跨日记录',createdAt:at,updatedAt:at+86400000,summary:'次日总结'}));t._newEvents=Array.from({length:230},(_,i)=>({kind:'assistant',timestamp:at+i,text:'本期进展 '+i,evidence:{path:'period.jsonl',line:i+1}}));t._newEvents.push({kind:'assistant',timestamp:at+86400000,text:'次日总结',evidence:{path:'period.jsonl',line:300}});await store.upsert(t);
 const r=await generateReport(store,{date:'2026-09-30'});assert.equal(r.facts.activityCount,230);assert.match(r.facts.items[0].summary,/229/);assert.doesNotMatch(r.facts.items[0].summary,/次日/);await store.putDocument('report',{...r,userText:'人工补充',versions:[{text:'AI 分析',model:'mock'}]});assert.equal((await generateReport(store,{date:'2026-09-30'})).userText,'人工补充');
 const preview=await buildContext(store,[{type:'task',id:t.id}]);assert.match(preview.text,/跨日记录/);assert.ok(preview.id);await assert.rejects(buildContext(store,[{type:'task',id:'C:\\private.txt'}]));
 const old=new DatabaseSync(file);old.exec('CREATE TABLE tasks(id TEXT,record TEXT);CREATE TABLE annotations(task_id TEXT,value TEXT,updated_at INTEGER);CREATE TABLE checkpoints(path TEXT,size INTEGER,mtime INTEGER,offset INTEGER,line INTEGER,state TEXT)');old.prepare('INSERT INTO tasks VALUES(?,?)').run(t.id,JSON.stringify(t));old.prepare('INSERT INTO annotations VALUES(?,?,?)').run(t.id,JSON.stringify({note:'旧备注',confirmedAt:at,manualStatus:'done'}),at);old.close();await migrateLegacy(store,file);assert.equal((await store.get(t.id)).annotation.confirmedAt,at);await store.patch(t.id,{note:'目标库编辑'});await migrateLegacy(store,file);assert.equal((await store.get(t.id)).annotation.note,'目标库编辑');assert.equal((await store.list()).total,1);
 }finally{await store.close();}
});
import { testDatabase,databaseError,connectionOptions } from '../server/store.mjs';
import mysql from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
test('MySQL: 只读测试、数据库缺失、连接失败、TLS 与权限不足',{skip:!enabled},async()=>{
 const {store,config}=await testStore('agentdock_test_health');
 const connection=await mysql.createConnection(connectionOptions(config));const username='agentdock_test_'+randomUUID().replaceAll('-','').slice(0,16);
 try {
 const before=await store.rows('SELECT table_name FROM information_schema.tables WHERE table_schema=?',[config.database]);await testDatabase(config);const after=await store.rows('SELECT table_name FROM information_schema.tables WHERE table_schema=?',[config.database]);assert.deepEqual(before,after);
 await assert.rejects(testDatabase({...config,database:'agentdock_test_missing_'+randomUUID().slice(0,8)}),/数据库不存在/);
 await assert.rejects(testDatabase({...config,port:1}),/无法连接|超时/);
 await assert.rejects(testDatabase({...config,tls:true,ca:'invalid synthetic certificate'}),/证书|数据库操作失败/);
 await connection.query(`CREATE USER '${username}'@'%' IDENTIFIED BY 'synthetic-readonly-only'`);await connection.query(`GRANT SELECT ON \`${config.database}\`.* TO '${username}'@'%'`);
 assert.equal((await testDatabase({...config,user:username,password:'synthetic-readonly-only'})).ok,true);await assert.rejects(openStore({...config,user:username,password:'synthetic-readonly-only'},true),/权限/);
 const id=(await connection.query('SELECT CONNECTION_ID() id'))[0][0].id;const killer=await mysql.createConnection(connectionOptions(config));await killer.query('KILL '+Number(id));await killer.end();await assert.rejects(connection.query('SELECT 1'));assert.equal((await store.rows('SELECT 1 n'))[0].n,1);
 assert.match(databaseError({code:'ER_ACCESS_DENIED_ERROR'}),/认证失败/);
 }finally {const cleanup=await mysql.createConnection(connectionOptions(config));await cleanup.query(`DROP USER IF EXISTS '${username}'@'%'`);await cleanup.end();await connection.end().catch(()=>{});await store.close();}
});
test('MySQL: 迁移中断重跑不修改源文件、不覆盖用户编辑',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_resume');const dir=mkdtempSync(path.resolve('artifacts/unit/migration-'));const file=path.join(dir,'old.sqlite');const source=new DatabaseSync(file);source.exec('CREATE TABLE tasks(id TEXT,record TEXT);CREATE TABLE annotations(task_id TEXT,value TEXT,updated_at INTEGER);CREATE TABLE checkpoints(path TEXT,size INTEGER,mtime INTEGER,offset INTEGER,line INTEGER,state TEXT)');for(let i=0;i<3;i++){const t=finalize(emptyTask('pi','migration-'+i,'source.jsonl',{title:'迁移会话 '+i}));source.prepare('INSERT INTO tasks VALUES(?,?)').run(t.id,JSON.stringify(t));}source.close();const {readFileSync}=await import('node:fs');const original=readFileSync(file);let count=0;const wrapper=Object.create(store);wrapper.transaction=fn=>{if(++count===2)throw new Error('模拟迁移中断');return store.transaction(fn);};
 try{await assert.rejects(migrateLegacy(wrapper,file),/中断/);assert.equal((await store.list()).total,1);await migrateLegacy(store,file);await migrateLegacy(store,file);assert.equal((await store.list()).total,3);assert.deepEqual(readFileSync(file),original);}finally{await store.close();}
});
import {Collector} from '../server/collector.mjs';
test('MySQL: 未变化日志只读断点头信息，追加后才加载完整状态',{skip:!enabled},async()=>{const {store}=await testStore('agentdock_test_headers');const dir=mkdtempSync(path.resolve('artifacts/unit/headers-'));const codex=path.join(dir,'.codex');mkdirSync(path.join(codex,'sessions'),{recursive:true});const file=path.join(codex,'sessions','sample.jsonl');const timestamp=new Date().toISOString();const line=(role,text)=>({type:'response_item',timestamp,payload:{type:'message',role,channel:role==='assistant'?'final':undefined,content:[{type:'text',text}]}});writeFileSync(file,[{type:'session_meta',timestamp,payload:{id:'headers-id',cwd:dir,source:'cli'}},line('user','实现断点头信息检查'),line('assistant','首次采集完成')].map(JSON.stringify).join('\n')+'\n');const collector=new Collector(store,{home:dir,codex,claude:path.join(dir,'.claude'),cursor:path.join(dir,'cursor')},()=>{});let loads=0;const checkpoint=store.checkpoint.bind(store);store.checkpoint=async file=>{loads++;return checkpoint(file);};try{await collector.scan();assert.equal(loads,1);await collector.scan();assert.equal(loads,1);appendFileSync(file,JSON.stringify(line('assistant','追加采集完成'))+'\n');await collector.scan();assert.equal(loads,2);assert.equal((await store.list()).tasks[0].summary,'追加采集完成');}finally{await collector.stop();await store.close();}});
