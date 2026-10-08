import test from 'node:test';
import assert from 'node:assert/strict';
import {chatPage} from '../server/chat-pages.mjs';

test('聊天位置分页从最近 20 条向前读取，不改动记录或暴露预览快照',()=>{
 const chat={id:'synthetic',title:'分页验收',messages:Array.from({length:143},(_,i)=>({role:i%2?'assistant':'user',text:String(i),preview:{text:'private snapshot'},sources:[]}))};
 const original=structuredClone(chat),latest=chatPage(chat);
 assert.equal(latest.start,123);assert.equal(latest.end,143);assert.equal(latest.nextBefore,123);assert.equal(latest.total,143);
 assert.equal(latest.messages.length,20);assert.equal(latest.messages[0].text,'123');assert.equal('preview'in latest.messages[0],false);
 const all=[...latest.messages];let before=latest.nextBefore;
 while(before!==null){const page=chatPage(chat,{before});all.unshift(...page.messages);before=page.nextBefore;}
 assert.deepEqual(all.map(m=>m.text),chat.messages.map(m=>m.text));assert.deepEqual(chat,original);
 assert.equal(chatPage(chat,{before:0}).messages.length,0);
 assert.equal(chatPage(chat,{before:999,limit:1}).messages[0].text,'142');
 assert.deepEqual(chatPage({id:'empty',messages:[]}).messages,[]);
});
