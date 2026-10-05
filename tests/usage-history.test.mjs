import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {allocateHistory,distributeHistoryDays,validateHistory} from '../server/usage-history.mjs';
import {consumeCodex,emptyTask} from '../server/parsers.mjs';
import {normalizeSourcePath} from '../server/collector.mjs';
const allocations=[{provider:'codex',model:'recalled-model',weight:8500},{provider:'cursor',model:'recalled-claude',weight:1500}];
test('历史分配：大整数无损，生成工作日总数守恒，模型起始日期和闰日正确',()=>{
 const total=5558000001, rows=allocateHistory(total,allocations);
 assert.equal(rows.reduce((s,r)=>s+r.total,0),total);
 const days=distributeHistoryDays(rows,'2024-02-26','2024-03-08');assert.equal(days.length,10);assert.equal(days.reduce((s,d)=>s+d.total,0),total);
 assert.ok(days.every(d=>[1,2,3,4,5].includes(new Date(d.day*86400000).getUTCDay())));
 assert.deepEqual(days,distributeHistoryDays(rows,'2024-02-26','2024-03-08'));
 const late=distributeHistoryDays([{...rows[0],since:'2024-03-07'}],'2024-02-26','2024-03-08');assert.equal(late.length,2);assert.equal(late.reduce((s,d)=>s+d.total,0),rows[0].total);
});
test('历史补录验证：比例、日期、重复模型与不合理区间拒绝',()=>{
 const input={mode:'target',tokens:5558000000,note:'合成测试估算',start:'2024-02-26',end:'2024-03-08',allocations};assert.equal(validateHistory(input).allocations.length,2);
 for(const patch of [{allocations:[{...allocations[0],weight:9999}]},{end:'2024-02-30'},{start:'2010-01-01'},{end:'2099-01-01'},{allocations:[{...allocations[0],weight:10000,since:'2024-03-09'}]},{allocations:[{...allocations[0],weight:5000},{...allocations[0],weight:5000}]}])assert.throws(()=>validateHistory({...input,...patch}));
});
test('Codex 分叉保留第一个会话身份，父元数据不得覆盖子 ID 与入口',()=>{
 let task=emptyTask('codex','child','synthetic.jsonl');
 task=consumeCodex(task,{type:'session_meta',payload:{id:'child',forked_from_id:'parent',originator:'cli'}},{path:'synthetic.jsonl',line:1});
 const id=task.id;
 task=consumeCodex(task,{type:'session_meta',payload:{id:'parent',originator:'desktop'}},{path:'synthetic.jsonl',line:2});
 assert.equal(task.nativeId,'child');assert.equal(task.id,id);assert.equal(task.parentNativeId,'parent');
});
test('Windows 扩展前缀与普通路径定位同一日志',{skip:process.platform!=='win32'},()=>{
 assert.equal(normalizeSourcePath('\\\\?\\C:\\synthetic\\log.jsonl'),path.resolve('C:\\synthetic\\log.jsonl'));
 assert.equal(normalizeSourcePath('\\\\?\\UNC\\host\\share\\log.jsonl'),path.resolve('\\\\host\\share\\log.jsonl'));
});
