import {crc32,deflateSync} from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compactTitle,compactSummary} from '../server/presentation.mjs';
import {validateAvatar} from '../server/avatar.mjs';
import {catalogue,referenceBudgets} from '../server/price-catalogue.mjs';
import {CollectionRun} from '../server/collection-policy.mjs';
test('长会话标题与 Markdown 摘要提炼，短原始标题保留',()=>{
 assert.equal(compactTitle('You are helping find a small contribution to NVIDIA/OpenShell and prepare a PR'), 'OpenShell PR 方案');
 assert.equal(compactTitle('PostgreSQL 连接修复'),'PostgreSQL 连接修复');
 assert.equal(compactSummary('**已完成** [测试](https://example.com)'),'已完成 测试');
 assert.equal(compactTitle('<command-name>/model</command-name>','','ASUS'),'Agent 模型配置');
});
test('头像拒绝 SVG、过大图片及无效头部',()=>{
 assert.equal(validateAvatar(''),'');assert.throws(()=>validateAvatar('data:image/svg+xml;base64,PHN2Zz4='));
 const b=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.write('IHDR',12);b.writeUInt32BE(128,16);b.writeUInt32BE(128,20);
 const chunk=(type,data)=>{const h=Buffer.alloc(8);h.writeUInt32BE(data.length);h.write(type,4);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([h.subarray(4),data])));return Buffer.concat([h,data,crc]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;const valid=Buffer.concat([b.subarray(0,8),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);assert.ok(validateAvatar('data:image/png;base64,'+valid.toString('base64')));b.writeUInt32BE(10000,16);assert.throws(()=>validateAvatar('data:image/png;base64,'+b.toString('base64')));
});
test('官方价区分输入输出和等级，不为未知回忆标签猜价',()=>{
 assert.ok(catalogue.every(r=>r.source.startsWith('https://')&&r.input>=0&&r.output>=0));
 const f=referenceBudgets([{provider:'deepseek',model:'deepseek-flash',input:1000000,output:1000000,cacheRead:0,cacheWrite:0,records:1,incomplete:0}])[0];
 assert.equal(f.min,.75);assert.equal(f.max,1.5);
 assert.equal(referenceBudgets([{model:'claude-sonnet-4.8',provider:'cursor'}])[0].available,false);
});
test('采集时间到期后只停止一次，不受重连延长',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});let ended=0;
 const run=new CollectionRun({durationMinutes:1},()=>ended++);run.start();t.mock.timers.tick(59999);assert.equal(run.paused,false);t.mock.timers.tick(1);assert.equal(run.paused,true);assert.equal(ended,1);t.mock.timers.tick(60000);assert.equal(ended,1);run.close();
});
