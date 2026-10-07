import test from 'node:test';
import assert from 'node:assert/strict';
import {CollectionRun,validateCollection} from '../server/collection-policy.mjs';
import {zstdCompressSync} from 'node:zlib';
import {readLog,readCompressed} from '../server/collector.mjs';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
test('采集截止时间独立于重连与设置更新，暂停释放计时器',()=>{
  let now=1000;const run=new CollectionRun({},()=>{},()=>now);run.start();assert.equal(run.deadline,3601000);
  run.settings=validateCollection({durationMinutes:120});assert.equal(run.deadline,3601000);
  run.pause();assert.equal(run.deadline,null);now=2000;run.start();assert.equal(run.deadline,7202000);run.close();
  assert.throws(()=>validateCollection({intervalSeconds:3}));assert.throws(()=>validateCollection({durationMinutes:0}));
});
test('限量读取在同一文件继续，全部事件和用量不会被跳过',async()=>{
  await mkdir('artifacts/unit',{recursive:true});const root=await mkdtemp(path.resolve('artifacts/unit/batch-')),file=path.join(root,'sample.jsonl');
  const rows=[{type:'session_meta',payload:{id:'bounded'}}];
  for(let i=0;i<25;i++)rows.push({type:'response_item',timestamp:new Date(1800000000000+i*11000).toISOString(),payload:{type:'message',role:'user',content:[{type:'input_text',text:'消息 '+i}]}});
  await writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  let previous=null,events=0,runs=0;
  do {const r=await readLog(file,'codex',previous,{},undefined,{maxRecords:5});events+=r.task._newEvents.length;assert.ok(r.task._newEvents.length<=5);previous={task:r.task,offset:r.offset,line:r.line,size:r.stats.size,mtime:r.stats.mtimeMs};runs++;}while(previous.task._importPending);
  assert.equal(events,25);assert.equal(previous.line,26);assert.equal(runs,6);
  assert.equal((await readLog(file,'codex',previous,{})).unchanged,true);
});

test('压缩日志逐帧分批恢复，文件不需要整体读入内存',async()=>{
 await mkdir('artifacts/unit',{recursive:true});const root=await mkdtemp(path.resolve('artifacts/unit/frames-')),file=path.join(root,'session.jsonl.zstd');
 const rows=[{type:'session',version:0,id:'frames-test',createdAt:Date.now()},{type:'user/message',time:Date.now(),data:{content:'测试逐帧读取'}},{type:'assistant/message',time:Date.now(),data:{message:{content:'读取完成'}}}];
 await writeFile(file,Buffer.concat(rows.map(r=>zstdCompressSync(Buffer.from(JSON.stringify(r)+'\n')))));let previous=null,loops=0;
 do{const r=await readCompressed(file,previous,{}, {maxFrames:1});previous={task:r.task,offset:r.offset,line:r.line,size:r.stats.size,mtime:r.stats.mtimeMs};loops++;}while(previous.task._importPending);
 assert.equal(loops,3);assert.equal(previous.task.summary,'读取完成');assert.equal(previous.line,3);assert.equal(previous.task._unfinished,false);assert.equal((await readCompressed(file,previous)).unchanged,true);
});
