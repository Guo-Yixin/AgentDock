import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { emptyTask, consumeCodex, consumeClaude, cursorTask, finalize, cleanText, projectFor } from '../server/parsers.mjs';
import { openStore, dayStart } from '../server/store.mjs';
import { readLog, Collector } from '../server/collector.mjs';

mkdirSync('artifacts/unit', { recursive: true });
const temp = () => mkdtempSync(path.resolve('artifacts/unit/case-'));
const now = new Date().toISOString();
const evidence = { path: 'redacted.jsonl', line: 3 };
const meta = { type: 'session_meta', timestamp: now, payload: { id: 'sample-codex', cwd: '', source: 'cli' } };
const records = [meta, { type: 'response_item', timestamp: now, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '实现本地任务列表' }] } }, { type: 'response_item', timestamp: now, payload: { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '已实现列表，待你验证。' }] } }, { type: 'event_msg', timestamp: now, payload: { type: 'task_complete' } }];

test('Codex: completion of a turn never confirms the whole task; analysis stays excluded', () => {
  const task = emptyTask('codex', 'initial', evidence.path);
  records.forEach((row, i) => consumeCodex(task, row, { ...evidence, line: i + 1 }));
  consumeCodex(task, { type: 'response_item', timestamp: now, payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'excluded internal analysis' }] } }, evidence);
  assert.equal(task.nativeId, 'sample-codex'); assert.equal(task.surface, 'CLI');
  assert.equal(finalize(task).completion, 'unconfirmed'); assert.equal(task.activity, 'responded');
  assert.equal(task.summary, '已实现列表，待你验证。'); assert.equal(task.summaryEvidence.line, 3);
  assert.ok(task.events.every(event => !event.text.includes('excluded')));
});
test('Claude: tool results are not user goals; structured todos preserve provenance', () => {
  const task = emptyTask('claude', 'sample', 'sample.jsonl');
  consumeClaude(task, { type: 'user', sessionId: 'claude-session', message: { content: [{ type: 'tool_result', content: 'irrelevant tool result' }] } }, evidence);
  assert.equal(task.goal, '');
  consumeClaude(task, { type: 'user', sessionId: 'claude-session', timestamp: now, entrypoint: 'cli', message: { content: '修复同步问题' } }, evidence);
  consumeClaude(task, { type: 'assistant', timestamp: now, message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: '修复同步', status: 'completed' }] } }, { type: 'text', text: '已完成同步修改。' }] } }, evidence);
  assert.equal(task.goal, '修复同步问题'); assert.equal(task.todos[0].text, '修复同步');
  assert.equal(finalize(task).completion, 'reported_complete');
  const child = emptyTask('claude', 'sample', 'child.jsonl', { subagentId: 'agent-redacted' });
  consumeClaude(child, { type: 'user', sessionId: 'claude-session', message: { content: '检查测试' } }, evidence);
  assert.notEqual(child.id, task.id); assert.equal(child.parentNativeId, 'claude-session');
});
test('Cursor: parse plain records, retain header-only evidence, skip empty drafts', () => {
  const header = { composerId: 'cursor-redacted', createdAt: Date.now() };
  const task = cursorTask(header, { composerId: header.composerId, name: '完成前端', workspaceIdentifier: '', todos: [], conversationMap: { a: { type: 1, text: '构建详情页面' }, b: { type: 2, text: '已实现，请核对。' } } }, 'sample.vscdb');
  assert.equal(task.goal, '构建详情页面'); assert.equal(task.summary, '已实现，请核对。'); assert.equal(task.partial, false);
  assert.equal(cursorTask(header, null, 'sample.vscdb').partial, true);
  assert.equal(cursorTask(header, { isDraft: true, conversationMap: {} }, 'sample.vscdb'), null);
});
test('Checkpoint: UTF-8 half-lines resume exactly once, unchanged logs do not reimport', async () => {
  const file = path.join(temp(), 'sample.jsonl');
  writeFileSync(file, records.slice(0, 2).map(row => JSON.stringify(row)).join('\n') + '\n' + JSON.stringify(records[2]).slice(0, -5));
  const first = await readLog(file, 'codex', null, {});
  assert.equal(first.line, 2); assert.equal(first.task.summary, ''); assert.equal(first.unfinished, true);
  const previous = { task: first.task, offset: first.offset, line: first.line, size: first.stats.size, mtime: first.stats.mtimeMs };
  appendFileSync(file, JSON.stringify(records[2]).slice(-5) + '\n' + JSON.stringify(records[3]) + '\n');
  const second = await readLog(file, 'codex', previous, {});
  assert.equal(second.line, 4); assert.equal(second.task.summary, '已实现列表，待你验证。');
  const unchanged = await readLog(file, 'codex', { task: second.task, offset: second.offset, line: second.line, size: second.stats.size, mtime: second.stats.mtimeMs }, {});
  assert.equal(unchanged.unchanged, true);
  writeFileSync(file, JSON.stringify(meta) + '\n');
  const truncated = await readLog(file, 'codex', { task: second.task, offset: second.offset, line: second.line, size: second.stats.size, mtime: second.stats.mtimeMs }, {});
  assert.equal(truncated.line, 1); assert.equal(truncated.task.summary, ''); assert.equal(truncated.reset, true);
});
test('Malformed and unknown events do not halt history import; context-only prompts stay out', async () => {
  const file = path.join(temp(), 'bad.jsonl'); writeFileSync(file, JSON.stringify(meta) + '\n{invalid}\n' + JSON.stringify({ type: 'future_event', unknown: true }) + '\n');
  const parsed = await readLog(file, 'codex', null, {}); assert.equal(parsed.task.partial, true);
  assert.equal(cleanText('# AGENTS.md instructions\n<INSTRUCTIONS>Do things</INSTRUCTIONS>\n<environment_context>hidden</environment_context>'), '');
});
test('Collector reads Cursor sources without changing database contents', async () => {
  const dir = temp(); const root = path.join(dir, 'Cursor', 'globalStorage'); mkdirSync(root, { recursive: true });
  const file = path.join(root, 'state.vscdb'); const db = new DatabaseSync(file);
  db.exec('CREATE TABLE composerHeaders(composerId TEXT,value TEXT); CREATE TABLE cursorDiskKV(key TEXT,value TEXT)');
  db.prepare('INSERT INTO composerHeaders VALUES(?,?)').run('cursor-id', JSON.stringify({ composerId: 'cursor-id', createdAt: Date.now(), workspaceIdentifier: dir })); db.close();
  const checksum = () => createHash('sha256').update(readFileSync(file)).digest('hex'); const before = checksum();
  const values = new Map(); const store = { upsert: async t => values.set(t.id,t), all: () => [...values.values()], close: () => {} }; const collector = new Collector(store, { home: dir, codex: dir, claude: dir, cursor: path.join(dir, 'Cursor') }, () => {});
  await collector.cursorIndex(); assert.equal(checksum(), before); assert.equal(collector.source('cursor').state, 'partial'); assert.equal(store.all().length, 1); store.close();
});
test('Project grouping resolves repository subfolders and UTC+8 midnight', () => {
  const dir = temp(); mkdirSync(path.join(dir, '.git')); mkdirSync(path.join(dir, 'src'));
  assert.equal(projectFor(dir).id, projectFor(path.join(dir, 'src')).id);
  assert.equal(dayStart(Date.parse('2026-10-01T01:00:00Z')), Date.parse('2026-09-30T16:00:00Z'));
});

test('Cursor: nested workspace URI, body update time and missing bubbles stay accurate',()=>{
  const created=Date.parse('2026-09-30T08:00:00Z'), updated=created+86400000;
  const header={composerId:'nested-workspace',createdAt:created,lastUpdatedAt:null,isArchived:true};
  const body={workspaceIdentifier:{id:'workspace',uri:{fsPath:path.resolve('artifacts/unit/project')}},lastUpdatedAt:updated,fullConversationHeadersOnly:[{bubbleId:'user'},{bubbleId:'missing'}],conversationMap:{user:{bubbleId:'user',type:1,text:'核对历史会话',createdAt:new Date(created).toISOString()}}};
  const t=cursorTask(header,body,'sample.vscdb');assert.equal(t.cwd,body.workspaceIdentifier.uri.fsPath);assert.equal(t.updatedAt,updated);assert.equal(t.title,'核对历史会话');assert.equal(t.partial,true);assert.equal(t.archived,true);
  assert.equal(cursorTask({...header,isDraft:true},null,'sample.vscdb'),null);
});

test('Cursor: separate bubbles follow header order, exclude tools and keep complete history',async()=>{
  const dir=temp(),root=path.join(dir,'Cursor'),global=path.join(root,'globalStorage');mkdirSync(global,{recursive:true});const file=path.join(global,'state.vscdb');const db=new DatabaseSync(file);db.exec('CREATE TABLE composerHeaders(composerId TEXT,value TEXT);CREATE TABLE cursorDiskKV(key TEXT,value TEXT)');
  const created=Date.parse('2026-09-30T08:00:00Z');const header={composerId:'separate-id',createdAt:created,isArchived:true,name:'历史任务'};
  db.prepare('INSERT INTO composerHeaders VALUES(?,?)').run(header.composerId,JSON.stringify(header));
  db.prepare('INSERT INTO cursorDiskKV VALUES(?,?)').run('composerData:'+header.composerId,JSON.stringify({composerId:header.composerId,createdAt:created,fullConversationHeadersOnly:[{bubbleId:'u'},{bubbleId:'tool'},{bubbleId:'thinking',grouping:{hasThinking:true}},{bubbleId:'a'}],conversationMap:{},workspaceIdentifier:{uri:{fsPath:dir}}}));
  const put=db.prepare('INSERT INTO cursorDiskKV VALUES(?,?)');for(const [id,entry]of [['a',{type:2,text:'已完成本轮回复',createdAt:new Date(created+10000).toISOString()}],['thinking',{type:2,text:'不应发送的内部推理'}],['tool',{type:2,text:'不应发送的工具结果',toolFormerData:{}}],['u',{type:1,text:'修复历史读取',createdAt:new Date(created).toISOString()}]])put.run('bubbleId:'+header.composerId+':'+id,JSON.stringify(entry));db.close();
  const before=createHash('sha256').update(readFileSync(file)).digest('hex'),values=new Map();const store={get:async id=>values.get(id),upsert:async t=>{values.set(t.id,t);return true;}};const collector=new Collector(store,{home:dir,codex:dir,claude:dir,cursor:root},()=>{});
  await collector.cursorIndex();const task=[...values.values()][0];assert.equal(task.goal,'修复历史读取');assert.equal(task.summary,'已完成本轮回复');assert.equal(task.partial,false);assert.equal(task.completion,'unconfirmed');assert.equal(task.archived,true);assert.deepEqual(task.events.map(e=>e.kind),['user','assistant']);assert.match(task.summaryEvidence.locator,/bubbleId=a/);assert.equal(task.cwd,dir);assert.equal(collector.source('cursor').state,'ready');
  const workspace=path.join(root,'workspaceStorage','same-project');mkdirSync(workspace,{recursive:true});const duplicate=new DatabaseSync(path.join(workspace,'state.vscdb'));duplicate.exec('CREATE TABLE composerHeaders(composerId TEXT,value TEXT)');duplicate.prepare('INSERT INTO composerHeaders VALUES(?,?)').run(header.composerId,JSON.stringify({...header,lastUpdatedAt:created+20000}));duplicate.close();
  await collector.cursorIndex();assert.equal(values.size,1);assert.equal(values.get(task.id).summary,task.summary);assert.equal(values.get(task.id).partial,false);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),before);assert.ok(collector.changedDates.has('2026-09-30'));
});
