import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile} from '../server/account-profile.mjs';
import {defaultPrices,catalogue} from '../server/price-catalogue.mjs';
import {allocateHistory,distributeHistoryDays,validateHistory} from '../server/usage-history.mjs';

test('个人资料可清空、局部更新保留字段，拒绝非法生日和联系方式',()=>{
 const old={phone:'+86 138-0000-0000',email:'person@example.com',gender:'private',birthday:'2000-02-29',signature:'我的签名'};
 assert.deepEqual(validateProfile({},old),old);assert.equal(validateProfile({email:''},old).phone,old.phone);assert.equal(validateProfile({email:''},old).email,'');
 for(const patch of [{email:'x@x'},{email:'a@b@c.com'},{phone:'abc'},{phone:'()()()'},{birthday:'2001-02-29'},{birthday:'2099-01-01'},{signature:'a'.repeat(301)},{gender:'bad'},{phone:123}])assert.throws(()=>validateProfile(patch,old));
});
test('默认公开单价区分路由和直接 API，只匹配已核验 ID，包含缓存写入档位',()=>{
 const rows=defaultPrices([{provider:'codex',model:'gpt-6.1-sol'},{provider:'claude',model:'claude-sonnet-5-5'},{provider:'cursor',model:'gemini-3.8-flash'},{provider:'agentdock',model:'gemini-3.8-flash'},{provider:'pi',model:'私有模型'}]);
 assert.equal(rows.length,4);assert.deepEqual([rows[0].input,rows[0].output,rows[0].cacheRead,rows[0].cacheWrite],[2,10,.1,2.5]);assert.equal(rows[1].cacheRead,.1);assert.equal(rows[1].cacheWriteLong,4);assert.equal(rows[2].output,3.5);assert.equal(rows[3].output,3.75);assert.ok(rows.every(r=>r.default&&r.effectiveAt===0));
 assert.equal(new Set(catalogue.map(r=>r.id)).size,catalogue.length);
});
test('弹性历史分摊可含周末、重复读取稳定、总数守恒，旧分布不变',()=>{
 const total=5558000001,rows=allocateHistory(total,[{provider:'codex',model:'gpt-6.1-sol',weight:10000}]);
 const days=distributeHistoryDays(rows,'2024-02-26','2024-03-31','flexible');assert.equal(days.reduce((s,d)=>s+d.total,0),total);assert.ok(days.some(d=>[0,6].includes(new Date(d.day*86400000).getUTCDay())&&d.total>0));assert.ok(new Set(days.map(d=>d.total)).size>20);assert.deepEqual(days,distributeHistoryDays(rows,'2024-02-26','2024-03-31','flexible'));
 const input={distribution:'flexible',mode:'amount',tokens:total,note:'比例估算，非实测',start:'2024-03-02',end:'2024-03-03',allocations:[{provider:'codex',model:'synthetic',weight:10000}]};assert.equal(validateHistory(input).distribution,'flexible');assert.throws(()=>validateHistory({...input,distribution:'weekdays'}));
 for(let i=0;i<100;i++){const weekend=distributeHistoryDays([{provider:'codex',model:`synthetic-${i}`,total:101}],'2024-03-02','2024-03-03','flexible');assert.equal(weekend.reduce((s,d)=>s+d.total,0),101);assert.ok(weekend.every(d=>Number.isSafeInteger(d.total)&&d.total>=0));}
});
