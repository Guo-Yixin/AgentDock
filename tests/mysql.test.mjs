import {manualPut} from '../server/usage-manual.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { emptyTask,finalize } from '../server/parsers.mjs';
import { readLog, Collector } from '../server/collector.mjs';
import { openStore,canInitialize } from '../server/store.mjs';
import { generateReport,migrateLegacy,buildContext } from '../server/workspace.mjs';
import { testStore } from './mysql-helper.mjs';
import {createOwner,login,authStatus,account} from '../server/auth.mjs';
import {saveUsage,usageOverview,usageRecords,validatePrice} from '../server/usage.mjs';
import {memoryPut,memoryReview,studioList,workflowPut,workflowStep} from '../server/studio.mjs';
const enabled=process.env.AGENTDOCK_INTEGRATION==='true';
test('MySQL: 记忆、工作流、上下文闭环与并发保护',{skip:!enabled},async()=>{
 const {store,config}=await testStore('agentdock_test_studio');let closed=false;
 try {
  const t=finalize(emptyTask('codex','studio-task','synthetic-studio.jsonl',{title:'可复用交付经验',summary:'测试通过后确认',updatedAt:Date.now()}));await store.upsert(t);
  const m=await memoryPut(store,{title:'中文经验😀',text:'原始回复需核实',category:'pattern',status:'draft',tags:['验证'],projectId:t.projectId,refs:[{type:'task',id:t.id}]});
  assert.equal(m.status,'draft');assert.equal(m.refs[0].title,t.title);assert.equal(m.reviewAt,null);
  await assert.rejects(memoryReview(store,{id:m.id,version:1}),/已确认/);
  const verified=await memoryPut(store,{...m,status:'verified',version:1});assert.equal(verified.version,2);assert.ok(verified.reviewAt>Date.now());
  await assert.rejects(memoryPut(store,{...m,text:'过时编辑'}),/已更新/);
  const results=await Promise.allSettled([memoryReview(store,{id:m.id,version:2,days:1}),memoryReview(store,{id:m.id,version:2,days:30})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await studioList(store,{kind:'memory',q:'中文',status:'verified'})).total,1);
  const before=await store.document(m.id,'memory');await store.putDocument('memory',{...before,reviewAt:Date.now()-1});assert.equal((await studioList(store,{kind:'memory',due:true})).total,1);
  const run=await workflowPut(store,{templateId:'delivery',title:'测试交付',refs:[{type:'memory',id:m.id},{type:'task',id:t.id}]});
  await assert.rejects(workflowStep(store,{id:run.id,version:1,step:1,note:'跳步'}),/顺序/);await assert.rejects(workflowStep(store,{id:run.id,version:1,step:0,note:''}),/结论/);
  const advances=await Promise.allSettled([workflowStep(store,{id:run.id,version:1,step:0,note:'目标与来源已核对'}),workflowStep(store,{id:run.id,version:1,step:0,note:'另一个窗口'})]);assert.equal(advances.filter(r=>r.status==='fulfilled').length,1);
  let active=await store.document(run.id,'workflow');for(let step=1;step<4;step++)active=await workflowStep(store,{id:run.id,version:active.version,step,note:`第 ${step} 步已验证`});assert.equal(active.status,'completed');assert.ok(active.steps.every(s=>s.completedAt));assert.notEqual((await store.get(t.id)).completion,'done');
  const preview=await buildContext(store,[{type:'memory',id:m.id},{type:'workflow',id:run.id}]);assert.match(preview.text,/目标与来源已核对|另一个窗口/);assert.match(preview.text,/verified/);assert.equal(preview.sources[0].id,m.id);
  const archive=await memoryPut(store,{...await store.document(m.id,'memory'),status:'archived'});assert.equal((await studioList(store,{kind:'memory'})).total,0);await assert.rejects(buildContext(store,[{type:'memory',id:archive.id}]),/归档/);
  await assert.rejects(memoryPut(store,{title:'非法来源',text:'样本',status:'draft',category:'pattern',refs:[{type:'task',id:'missing'}]}),/不存在/);
  assert.equal((await studioList(store,{kind:'memory',status:'archived'})).total,1);
  await store.close();closed=true;const reopened=await openStore(config);try{assert.equal((await reopened.document(run.id,'workflow')).status,'completed');assert.equal((await reopened.document(m.id,'memory')).text,'原始回复需核实');}finally{await reopened.close();}
 }finally{if(!closed)await store.close();}
});
test('MySQL: 记忆分页、脱敏与工作流归档',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_studio_pages');try{
  for(let i=0;i<32;i++)await memoryPut(store,{title:`经验 ${i}`,text:'api_key: sk-syntheticsecretabcdefgh',category:'pitfall',status:'draft',tags:[],refs:[]});
  const first=await studioList(store,{kind:'memory'}),second=await studioList(store,{kind:'memory',page:2});assert.equal(first.items.length,30);assert.equal(second.items.length,2);assert.equal(first.total,32);assert.ok(!first.items.some(m=>m.text.includes('sk-syntheticsecret')));assert.equal(new Set([...first.items,...second.items].map(m=>m.id)).size,32);
  const r=await workflowPut(store,{templateId:'review',refs:[]});await workflowStep(store,{id:r.id,version:r.version,archive:true});assert.equal((await studioList(store,{kind:'workflow'})).total,0);assert.equal((await studioList(store,{kind:'workflow',status:'archived'})).total,1);
 }finally{await store.close();}
});
test('MySQL: 账号初始化竞态、会话吊销和修改密码不泄露哈希',{skip:!enabled},async()=>{
 const {store,config}=await testStore('agentdock_test_auth');try{
 assert.equal(await canInitialize(config),true);
 const owner={username:'synthetic_owner',password:'synthetic-owner-pass'};const results=await Promise.allSettled([createOwner(store,owner),createOwner(store,owner)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await canInitialize(config),false);
 const a=await login(store,owner),b=await login(store,{...owner,desktop:true,remember:true});assert.equal((await authStatus(store,a.token)).user.username,owner.username);assert.equal(a.user.password_hash,undefined);assert.ok(!(await store.rows('SELECT password_hash FROM ad_users'))[0].password_hash.includes(owner.password));await assert.rejects(login(store,{...owner,password:'wrong-password'}));
 const sessions=await account(store,{token:a.token,action:'sessions'});assert.equal(sessions.length,2);assert.ok(sessions.some(s=>s.current));assert.ok(sessions.every(s=>!s.id.includes(a.token)));
 await account(store,{token:a.token,action:'revoke'});assert.equal((await authStatus(store,b.token)).user,null);await account(store,{token:a.token,action:'profile',displayName:'中文所有者'});assert.equal((await authStatus(store,a.token)).user.displayName,'中文所有者');
 await account(store,{token:a.token,action:'password',currentPassword:owner.password,password:'synthetic-new-password'});assert.equal((await authStatus(store,a.token)).user,null);await assert.rejects(login(store,owner));const c=await login(store,{...owner,password:'synthetic-new-password'});await account(store,{token:c.token,action:'logout'});assert.equal((await authStatus(store,c.token)).user,null);
 }finally{await store.close();}
});
test('MySQL: 请求分段取最大值、累计双记录去重、历史单价与币种分开',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_usage');try{
 const timestamp=Date.parse('2026-09-30T12:00:00+08:00'),task=finalize(emptyTask('claude','synthetic-usage','synthetic.jsonl',{updatedAt:timestamp,createdAt:timestamp,title:'用量验收'}));
 const u={id:'a'.repeat(64),model:'synthetic',timestamp,input:100,cacheRead:60,cacheWrite:10,output:5,total:105,cacheWriteLong:0,mode:'request',evidence:{path:'synthetic.jsonl',line:1}};
 task._newUsage=[u,{...u,output:20,total:120}];await store.upsert(task);await store.upsert({...task,_newUsage:[u]});assert.equal(Number((await store.rows('SELECT COUNT(*) n FROM ad_usage'))[0].n),1);
 const record=(await usageRecords(store,{start:timestamp-86400000,end:timestamp+86400000})).records[0];assert.equal(record.output,20);assert.equal(record.total,120);
 const price={provider:'claude',model:'synthetic',currency:'USD',date:'2026-09-01',input:2,output:4,cacheRead:1,cacheWrite:3,cacheWriteLong:6};await store.putDocument('price',validatePrice(price));await store.putDocument('price',validatePrice({...price,date:'2026-09-30',currency:'CNY',input:10,output:20,cacheRead:5,cacheWrite:15,cacheWriteLong:30}));
 let overview=await usageOverview(store,{start:timestamp-86400000,end:timestamp+86400000});assert.equal(overview.summary.total,120);assert.equal(overview.coverage.measuredSessions,1);assert.equal(overview.costs.reduce((s,c)=>s+c.records,0),1);assert.equal(overview.costs.find(c=>c.currency==='CNY').amount,.00115);
 const codex={...task,id:'codex-synthetic',provider:'codex',_newUsage:[{...u,id:'b'.repeat(64),mode:'codex_direct'}]};await saveUsage(store,codex);await saveUsage(store,{...codex,_codexHasTotals:true,_newUsage:[{...u,id:'c'.repeat(64),mode:'codex_cumulative'}]});assert.equal(Number((await store.rows('SELECT COUNT(*) n FROM ad_usage WHERE task_id=?',[codex.id]))[0].n),1);
 const snapshot=(id,input,output,time)=>({...u,id:id.repeat(64),input,output,total:input+output,cacheRead:0,cacheWrite:0,timestamp:time,mode:'codex_cumulative',cumulative:{input_tokens:input,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:output,total_tokens:input+output}});const merged={...task,id:'codex-archive-merge',provider:'codex',_codexHasTotals:true,_newUsage:[snapshot('f',200,20,timestamp+10)]};await saveUsage(store,merged);await saveUsage(store,{...merged,_newUsage:[snapshot('9',100,10,timestamp)]});assert.equal(Number((await store.rows('SELECT SUM(total_tokens) total FROM ad_usage WHERE task_id=?',[merged.id]))[0].total),220);await saveUsage(store,merged);assert.equal(Number((await store.rows('SELECT SUM(total_tokens) total FROM ad_usage WHERE task_id=?',[merged.id]))[0].total),220);
 const missing={...task,_newUsage:[{...u,id:'d'.repeat(64),input:null,total:null,output:3,model:'missing-model'}]};await saveUsage(store,missing);await saveUsage(store,missing);overview=await usageOverview(store,{start:timestamp-86400000,end:timestamp+86400000});assert.equal(overview.summary.incomplete,1);assert.equal((await usageRecords(store,{start:timestamp-86400000,end:timestamp+86400000})).records.find(r=>r.model==='missing-model').input,null);
 await assert.rejects(store.transaction(async tx=>{await saveUsage(tx,{...task,_newUsage:[{...u,id:'e'.repeat(64)}]});throw new Error('事务中断');}));assert.equal(Number((await store.rows('SELECT COUNT(*) n FROM ad_usage WHERE id=?',['e'.repeat(64)]))[0].n),0);
 }finally{await store.close();}
});
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
test('MySQL: Cursor 独立消息完整导入、重复采集与用户标记保留',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_cursor');const dir=mkdtempSync(path.resolve('artifacts/unit/cursor-'));const root=path.join(dir,'Cursor');mkdirSync(path.join(root,'globalStorage'),{recursive:true});const file=path.join(root,'globalStorage','state.vscdb');const db=new DatabaseSync(file);db.exec('CREATE TABLE composerHeaders(composerId TEXT,value TEXT);CREATE TABLE cursorDiskKV(key TEXT,value TEXT)');const start=Date.parse('2026-09-29T08:00:00Z');const headers=Array.from({length:220},(_,i)=>({bubbleId:'bubble-'+i,type:i%2?2:1,createdAt:new Date(start+i*60000).toISOString()}));db.prepare('INSERT INTO composerHeaders VALUES(?,?)').run('history-id',JSON.stringify({composerId:'history-id',createdAt:start,isArchived:true}));const insert=db.prepare('INSERT INTO cursorDiskKV VALUES(?,?)');insert.run('composerData:history-id',JSON.stringify({composerId:'history-id',createdAt:start,fullConversationHeadersOnly:headers,conversationMap:{},workspaceIdentifier:{uri:{fsPath:dir}}}));db.exec('BEGIN');for(const h of headers)insert.run('bubbleId:history-id:'+h.bubbleId,JSON.stringify({...h,text:'历史消息 '+h.bubbleId}));db.exec('COMMIT');db.close();const collector=new Collector(store,{home:dir,codex:dir,claude:dir,cursor:root},()=>{});
 try{await collector.cursorIndex();const t=(await store.list({provider:'cursor'})).tasks[0];assert.equal(t.partial,false);assert.equal(t.archived,true);assert.equal(t.cwd,dir);assert.equal(t.summary,'历史消息 bubble-219');assert.equal((await store.events({task:t.id,start,end:start+86400000})).length,220);const annotation=(await store.patch(t.id,{note:'保留的用户备注',manualStatus:'done'})).annotation;await collector.cursorIndex();assert.equal((await store.list({provider:'cursor'})).total,1);assert.equal((await store.events({task:t.id,start,end:start+86400000})).length,220);assert.deepEqual((await store.get(t.id)).annotation,annotation);assert.match((await store.get(t.id)).summaryEvidence.locator,/bubbleId=bubble-219/);}finally{await collector.stop();await store.close();}
});
test('MySQL: 未变化日志只读断点头信息，追加后才加载完整状态',{skip:!enabled},async()=>{const {store}=await testStore('agentdock_test_headers');const dir=mkdtempSync(path.resolve('artifacts/unit/headers-'));const codex=path.join(dir,'.codex');mkdirSync(path.join(codex,'sessions'),{recursive:true});const file=path.join(codex,'sessions','sample.jsonl');const timestamp=new Date().toISOString();const line=(role,text)=>({type:'response_item',timestamp,payload:{type:'message',role,channel:role==='assistant'?'final':undefined,content:[{type:'text',text}]}});writeFileSync(file,[{type:'session_meta',timestamp,payload:{id:'headers-id',cwd:dir,source:'cli'}},line('user','实现断点头信息检查'),line('assistant','首次采集完成')].map(JSON.stringify).join('\n')+'\n');const collector=new Collector(store,{home:dir,codex,claude:path.join(dir,'.claude'),cursor:path.join(dir,'cursor')},()=>{});let loads=0;const checkpoint=store.checkpoint.bind(store);store.checkpoint=async file=>{loads++;return checkpoint(file);};try{await collector.scan();assert.equal(loads,1);await collector.scan();assert.equal(loads,1);appendFileSync(file,JSON.stringify(line('assistant','追加采集完成'))+'\n');await collector.scan();assert.equal(loads,2);assert.equal((await store.list()).tasks[0].summary,'追加采集完成');}finally{await collector.stop();await store.close();}});
import {goalPut,goalGet,goalLink,migrateGoalGroups} from '../server/goals.mjs';
test('MySQL: 工作目标、旧文本迁移、完整分页与待处理口径',{skip:!enabled},async()=>{
 const {store,config}=await testStore('agentdock_test_goals');const dir=mkdtempSync(path.resolve('artifacts/unit/goals-'));mkdirSync(path.join(dir,'.git'));mkdirSync(path.join(dir,'other','.git'),{recursive:true});const now=Date.now();const a=finalize(emptyTask('codex','goal-a','sample.jsonl',{cwd:dir,title:'目标会话 A',createdAt:now,updatedAt:now})),b=finalize(emptyTask('claude','goal-b','sample.jsonl',{cwd:dir,title:'目标会话 B',createdAt:now,updatedAt:now})),other=finalize(emptyTask('pi','goal-c','sample.jsonl',{cwd:path.join(dir,'other'),createdAt:now,updatedAt:now}));a._newEvents=Array.from({length:220},(_,i)=>({timestamp:now,kind:i%2?'assistant':'user',text:'分页记录 '+i,evidence:{path:'sample.jsonl',line:i+1}}));
 try{await store.upsert(a);await store.upsert(b);await store.upsert(other);assert.equal((await store.overview([],{})).needsAttention,0);assert.equal((await store.overview([],{})).today,1);await store.patch(a.id,{needsReview:true,goalGroup:'同一交付',note:'迁移保留备注'});await store.patch(b.id,{goalGroup:'同一交付'});assert.equal((await store.overview([],{})).needsAttention,1);await migrateGoalGroups(store);await migrateGoalGroups(store);const migrated=await store.rows('SELECT id FROM ad_goals');assert.equal(migrated.length,1);let g=await goalGet(store,migrated[0].id);assert.equal(g.sessions.length,2);assert.equal(g.needsReview,true);g=await goalPut(store,{id:g.id,title:g.title,status:'done',note:'用户目标备注'});const confirmed=g.confirmedAt;await migrateGoalGroups(store);assert.equal((await goalGet(store,g.id)).note,'用户目标备注');assert.equal((await goalGet(store,g.id)).confirmedAt,confirmed);await assert.rejects(goalLink(store,{id:g.id,taskId:other.id}),/同项目/);await goalLink(store,{id:g.id,taskId:b.id,remove:true});assert.equal((await goalGet(store,g.id)).sessions.length,1);assert.equal((await store.get(a.id)).annotation.note,'迁移保留备注');const preview=await buildContext(store,[{type:'goal',id:g.id}]);assert.ok(preview.text.includes('用户目标备注'));let cursor,events=[];do{const page=await store.timeline({id:a.id,cursor});events.push(...page.events);cursor=page.nextCursor;}while(cursor);assert.equal(events.length,220);assert.equal(new Set(events.map(e=>e.text)).size,220);assert.equal((await store.timeline({goalId:g.id})).events.length,50);await store.close();const reopened=await openStore(config,true);try{assert.equal((await goalGet(reopened,g.id)).confirmedAt,confirmed);assert.equal((await reopened.get(a.id)).annotation.note,'迁移保留备注');}finally{await reopened.close();}}
 finally{await store.close().catch(()=>{});}
});

import {claimReminder,acknowledgeReminder} from '../server/reminders.mjs';
test('MySQL: 提醒领取互斥、过期恢复与确认',{skip:!enabled},async()=>{const {store}=await testStore('agentdock_test_reminders');try{const s=await store.putDocument('schedule',{title:'合成提醒',start:Date.now()-1000,end:Date.now()+60000,reminderMinutes:0,done:false});const claims=await Promise.all(['desktop','browser'].map(owner=>claimReminder(store,{id:s.id,owner})));assert.equal(claims.filter(c=>c.claimed).length,1);await assert.rejects(acknowledgeReminder(store,{id:s.id,claim:'invalid'}),/过期/);const old=await store.document(s.id,'schedule');await store.putDocument('schedule',{...old,claimUntil:Date.now()-1});const next=await claimReminder(store,{id:s.id,owner:'browser'});assert.equal(next.claimed,true);await acknowledgeReminder(store,{id:s.id,claim:next.token});assert.equal((await claimReminder(store,{id:s.id,owner:'desktop'})).claimed,false);}finally{await store.close();}});

import {saveHistory,disableHistory} from '../server/usage-history.mjs';
test('MySQL: 历史基准、重复保存、恢复替换、新增累加、筛选与重启持久化',{skip:!enabled},async()=>{
 const {store,config}=await testStore('agentdock_test_history');try{
 await createOwner(store,{username:'synthetic_history_owner',password:'synthetic-history-pass'});
 const old=Date.parse('2024-03-04T12:00:00+08:00');
 const make=(name,total,timestamp)=>{const task=finalize(emptyTask('claude',name,'synthetic-'+name+'.jsonl',{createdAt:timestamp,updatedAt:timestamp}));task._newUsage=[{id:name.padEnd(64,'a'),model:'synthetic',timestamp,input:total-10,output:10,total,cacheRead:0,cacheWrite:0,mode:'request',evidence:{path:task.evidence.path,line:1}}];return task;};
 await store.upsert(make('first',1000,old));
 const value={mode:'target',tokens:5558000000,note:'合成测试：工作日估算',start:'2024-03-04',end:'2024-03-08',allocations:[{provider:'codex',model:'recalled',weight:8500},{provider:'cursor',model:'recalled',weight:1500}]};
 await assert.rejects(saveHistory(store,value,'other'));
 await saveHistory(store,value,'owner');await saveHistory(store,value,'owner');
 let o=await store.transaction(tx=>usageOverview(tx,{start:0,end:Date.now()+86400000}));
 assert.equal(o.profile.total,value.tokens);assert.equal(o.summary.total,1000);assert.equal(o.history.periodTotal,value.tokens-1000);assert.equal(o.history.days.reduce((s,d)=>s+d.total,0),o.history.total);assert.equal(o.costs.length,0);
 await store.upsert(make('recovered',2000,old));
 o=await usageOverview(store,{});assert.equal(o.profile.total,value.tokens);assert.equal(o.history.recovered,2000);
 await store.upsert(make('new',3000,Date.now()+100));
 o=await usageOverview(store,{});assert.equal(o.profile.total,value.tokens+3000);
 const p=await usageOverview(store,{provider:'codex'});assert.equal(p.profile.total,p.history.total);assert.equal(p.history.total,Math.floor((value.tokens-3000)*.85));
 const project=await usageOverview(store,{project:'unassigned'});assert.equal(project.history.total,0);assert.equal(project.history.projectExcluded,true);
 const period=await usageOverview(store,{start:Date.parse('2024-03-05T00:00:00+08:00'),end:Date.parse('2024-03-06T00:00:00+08:00')});assert.equal(period.history.periodTotal,period.history.days.find(d=>new Date(d.day*86400000).toISOString().slice(0,10)==='2024-03-05').total);
 const reopened=await openStore(config);try{assert.equal((await usageOverview(reopened,{})).profile.total,value.tokens+3000);}finally{await reopened.close();}
 await disableHistory(store,'owner');assert.equal((await usageOverview(store,{})).profile.total,6000);assert.equal((await store.document('usage-history-owner','usage-history')).versions.length,2);
 }finally{await store.close();}
});

test('MySQL: Codex 旧分叉断点修复父子归属、用量去重、用户备注和接入健康',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_fork');try{
 const root=mkdtempSync(path.join(process.cwd(),'artifacts','fork-')),logs=path.join(root,'sessions');mkdirSync(logs,{recursive:true});
 const parentFile=path.join(logs,'parent.jsonl'),childFile=path.join(logs,'child.jsonl');
 const time='2024-03-04T12:00:00Z';const usage=n=>({type:'event_msg',timestamp:time,payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,output_tokens:10,total_tokens:n+10}}}});
 const meta=id=>({type:'session_meta',timestamp:time,payload:{id,cwd:root}});const write=(file,records)=>writeFileSync(file,records.map(JSON.stringify).join('\n')+'\n');
 write(parentFile,[meta('parent'),usage(100)]);write(childFile,[{...meta('child'),payload:{...meta('child').payload,forked_from_id:'parent'}},meta('parent'),usage(200)]);
 const db=new DatabaseSync(path.join(root,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT,rollout_path TEXT,cwd TEXT,title TEXT,created_at INTEGER,updated_at INTEGER)');for(const [id,file]of [['parent',parentFile],['child',childFile]])db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)').run(id,file,root,id,1709553600,1709553600);db.close();
 const parent=await readLog(parentFile,'codex');await store.upsert(parent.task);
 const child=await readLog(childFile,'codex');const old={...child.task,id:parent.task.id,nativeId:'parent',_parserVersion:7};await store.upsert(old,true);await store.saveCheckpoint(childFile,child.stats,child.offset,child.line,old);
 await store.patch(parent.task.id,{note:'父会话备注',manualStatus:'done'});const confirmed=(await store.get(parent.task.id)).annotation.confirmedAt;
 const missing=finalize(emptyTask('codex','lost','missing-index',{partial:true}));await store.upsert(missing);
 const collector=new Collector(store,{home:root,codex:root,claude:path.join(root,'claude'),cursor:path.join(root,'cursor')},()=>{});await collector.scan();
 const repaired=await store.get(child.task.id);assert.equal(repaired.nativeId,'child');assert.equal(repaired.partial,false);assert.equal((await store.get(parent.task.id)).annotation.note,'父会话备注');assert.equal((await store.get(parent.task.id)).annotation.confirmedAt,confirmed);
 assert.equal((await usageOverview(store,{})).summary.total,320);
 await collector.scan();assert.equal((await usageOverview(store,{})).summary.total,320);
 const o=await store.overview(collector.sources,collector.progress);const source=o.sources.find(s=>s.id==='codex');assert.equal(source.state,'ready');assert.equal(source.partialSessions,1);assert.match(source.message,/历史会话/);
 }finally{await store.close();}
});

test('MySQL: 精确补录细化守恒、并发版本、删除恢复及采集互斥',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_precision');try{
 await createOwner(store,{username:'precision_test',password:'Synthetic-only-pass!'});
 const lease=await store.collectionLease();assert.ok(lease);assert.equal(await store.collectionLease(),null);await lease();const again=await store.collectionLease();assert.ok(again);await again();
 const yesterday=new Date(Date.now()+28800000-86400000).toISOString().slice(0,10);
 await saveHistory(store,{mode:'amount',tokens:1000000,start:'2025-01-01',end:yesterday,note:'合成基准',allocations:[{provider:'codex',model:'synthetic',weight:10000}]},'owner');
 const input={id:'precision-case',provider:'codex',model:'synthetic',input:800,output:200,timestamp:Date.now()-86400000,note:'合成手动补录',version:0,refine:true};
 const record=await manualPut(store,input,'owner');assert.equal(record.version,1);
 const args={start:0,end:Date.now()+1};let o=await usageOverview(store,args);assert.equal(o.profile.total,1000000);assert.equal(o.history.availableTotal,999000);assert.equal(o.profile.activeDays,0);assert.equal(o.summary.input,800);
 await assert.rejects(()=>manualPut(store,input,'owner'),/更新/);
 const edit=await manualPut(store,{...input,input:600,output:400,version:1},'owner');assert.equal(edit.version,2);
 await manualPut(store,{id:input.id,version:2},'owner',true);o=await usageOverview(store,args);assert.equal(o.profile.total,1000000);assert.equal(o.history.availableTotal,1000000);assert.equal(o.summary.records,0);
 await assert.rejects(()=>manualPut(store,{id:input.id,version:3},'owner',true));
 for(let i=0;i<12;i++)await store.upsert(finalize(emptyTask('codex','page-'+i,'fixture.jsonl',{title:'分页 '+i,updatedAt:Date.now()+i})));
 const first=await store.list({pageSize:5,page:1}),last=await store.list({pageSize:5,page:3});assert.equal(first.tasks.length,5);assert.equal(last.tasks.length,2);assert.equal(first.total,12);
 }finally{await store.close();}
});


test('MySQL: 默认价格、缓存费用、自定义覆盖和个人资料原子保存',{skip:!enabled},async()=>{
 const {store}=await testStore('agentdock_test_defaults');try{
  const timestamp=Date.now(),task=finalize(emptyTask('claude','default-rates','synthetic-defaults.jsonl',{updatedAt:timestamp,createdAt:timestamp,title:'默认价格验收'}));
  task._newUsage=[{id:'b'.repeat(64),model:'claude-sonnet-5-5',timestamp,input:1000000,cacheRead:500000,cacheWrite:100000,cacheWriteLong:25000,output:100000,total:1100000,mode:'request',evidence:{path:'synthetic-defaults.jsonl',line:1}}];await store.upsert(task);
  let data=await usageOverview(store,{});assert.equal(data.costs.length,1);assert.equal(data.costs[0].default,true);assert.equal(data.costs[0].amount,2.1375);assert.equal((await store.documents('price')).length,0);
  const price=validatePrice({provider:'claude',model:'claude-sonnet-5-5',currency:'CNY',date:'2020-01-01',input:4,output:20,cacheRead:.2,cacheWrite:5,cacheWriteLong:8});await store.putDocument('price',price);data=await usageOverview(store,{});assert.equal(data.costs.length,1);assert.equal(data.costs[0].default,false);assert.equal(data.costs[0].amount,4.275);assert.equal(data.costs[0].currency,'CNY');
  await createOwner(store,{username:'profile_test_owner',password:'profile-test-password'});const session=await login(store,{username:'profile_test_owner',password:'profile-test-password'});
  await account(store,{token:session.token,action:'profile',displayName:'测试用户',phone:'+86 138-0000-0000',email:'test@example.com',gender:'private',birthday:'2000-02-29',signature:'测试签名'});let user=(await authStatus(store,session.token)).user;assert.equal(user.email,'test@example.com');
  await assert.rejects(account(store,{token:session.token,action:'profile',displayName:'错误修改',birthday:'2001-02-29'}));user=(await authStatus(store,session.token)).user;assert.equal(user.displayName,'测试用户');assert.equal(user.birthday,'2000-02-29');
  await account(store,{token:session.token,action:'profile',displayName:'仅改名称'});assert.equal((await authStatus(store,session.token)).user.signature,'测试签名');
 }finally{await store.close();}
});
