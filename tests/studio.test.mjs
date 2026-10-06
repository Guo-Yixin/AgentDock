import test from 'node:test';
import assert from 'node:assert/strict';
import { templates, validateRefs } from '../server/studio.mjs';

test('工作流模板提供独立的交付、诊断和复盘步骤',()=>{
  assert.equal(new Set(templates.map(t=>t.id)).size,3);
  assert.ok(templates.every(t=>t.steps.length===4&&new Set(t.steps).size===4));
});
test('来源引用拒绝任意路径、未知对象与超过预算的集合',async()=>{
  const store={get:async()=>null};
  await assert.rejects(validateRefs(store,[{type:'file',id:'C:/secret'}]),/无效/);
  await assert.rejects(validateRefs(store,[{type:'task',id:'missing'}]),/不存在/);
  await assert.rejects(validateRefs(store,Array(21).fill({type:'task',id:'x'})),/20/);
});
test('来源标题与依据由服务端读取，去重且不接受客户端伪造证据',async()=>{
  const refs=await validateRefs({get:async()=>({title:'真实标题',evidence:{path:'sample.jsonl',line:7}})},[{type:'task',id:'x',title:'伪造',evidence:{path:'secret'}},{type:'task',id:'x'}]);
  assert.deepEqual(refs,[{type:'task',id:'x',title:'真实标题',evidence:{path:'sample.jsonl',line:7}}]);
});
