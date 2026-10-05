import {consumeUsage} from './usage.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
export const PARSER_VERSION = 8;
export function epoch(value, fallback = 0) {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  const result = Date.parse(value); return Number.isFinite(result) ? result : fallback;
}
export function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter(v => ['text', 'input_text', 'output_text'].includes(v?.type)).map(v => v.text || '').join('\n');
  return '';
}
export function cleanText(text, max = 8000) {
  let value = String(text || '').replace(/<(environment_context|system_reminder|system-reminder|instructions|INSTRUCTIONS|app-context|permissions instructions|skills_instructions)>[\s\S]*?<\/\1>/gi, '').replace(/<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/g, '').trim();
  const request = value.lastIndexOf('## My request:');
  if (request >= 0) value = value.slice(request + 14).trim();
  value = value.replace(/^# AGENTS\.md instructions\s*$/gm, '').trim();
  return value.slice(0, max);
}
const projectCache = new Map();
export function projectFor(cwd = '') {
  if (!cwd) return { id: 'unassigned', name: '未归属项目', root: '' };
  if (projectCache.has(cwd)) return projectCache.get(cwd);
  let root = path.resolve(cwd); let search = root; let gitIdentity = '';
  while (true) {
    const git = path.join(search, '.git');
    if (existsSync(git)) {
      root = search; gitIdentity = git;
      try {
        const pointer = readFileSync(git, 'utf8').match(/^gitdir:\s*(.+)/m);
        if (pointer) {
          const gitDir = path.resolve(search, pointer[1].trim());
          const commonFile = path.join(gitDir, 'commondir');
          if (existsSync(commonFile)) { gitIdentity = path.resolve(gitDir, readFileSync(commonFile, 'utf8').trim()); root = path.dirname(gitIdentity); }
          else gitIdentity = gitDir;
        }
      } catch { /* Ordinary .git directory: root is already resolved. */ }
      break;
    }
    const parent = path.dirname(search); if (parent === search) break; search = parent;
  }
  const identity = gitIdentity || root;
  const result = { id: hash(process.platform === 'win32' ? identity.toLowerCase() : identity), name: path.basename(root) || root, root };
  projectCache.set(cwd, result); return result;
}
export function emptyTask(provider, nativeId, file, meta = {}) {
  return { id: `${provider}-${hash(nativeId)}`, provider, nativeId, surface: '未知入口', title: '', goal: '', cwd: '', createdAt: 0, updatedAt: 0, activity: 'unknown', completion: 'unconfirmed', summary: '', summaryEvidence: null, todos: [], archived: false, partial: false, evidence: { path: file }, events: [], ...meta };
}
export function addEvent(task, kind, text, timestamp, evidence) {
  const value = cleanText(text, 6000); if (!value) return;
  const last = task.events.at(-1);
  if (last?.kind === kind && last.text === value && Math.abs(last.timestamp - timestamp) < 10000) return;
  const event = { timestamp, kind, text: value, evidence };
  task.events.push(event);
  (task._newEvents ||= []).push(event);
  if (task.events.length > 200) task.events.shift();
}
export function message(task, role, text, timestamp, evidence) {
  const value = cleanText(text); if (!value) return;
  if(role==='user')task.activity='recent';
  if (role === 'user' && !task.goal) { task.goal = value; if (!task.title) task.title = value.split('\n').find(line => line.trim() && !/^# (AGENTS|Files)/.test(line))?.replace(/^#+\s*/, '').slice(0, 180) || '未命名会话'; }
  if (role === 'assistant') { task.summary = value; task.summaryEvidence = evidence; task.activity = 'responded'; }
  if (['user', 'assistant'].includes(role)) addEvent(task, role, value, timestamp, evidence);
}
export function setTodos(task, values) {
  if (!Array.isArray(values)) return;
  task.todos = values.map(todo => ({ text: String(todo.step || todo.content || todo.text || todo.description || todo.subject || '').slice(0, 600), status: ['completed', 'done'].includes(todo.status) ? 'completed' : todo.status === 'in_progress' ? 'in_progress' : 'pending' })).filter(todo => todo.text).slice(0, 100);
}
function tool(task, name, args, timestamp, evidence) {
  let data = args;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  if (/update_plan|TodoWrite/i.test(name)) setTodos(task, data?.plan || data?.todos);
  addEvent(task, 'tool', `工具调用：${name}`, timestamp, evidence);
}
export function consumeCodex(task, record, evidence) {
  const item = record.payload || {}; const timestamp = epoch(record.timestamp);
  if (timestamp) { task.createdAt ||= timestamp; task.updatedAt = Math.max(task.updatedAt, timestamp); }
  if (record.type === 'session_meta') {
    const nativeId=item.id||item.session_id;
    if(task._codexSessionId&&nativeId&&nativeId!==task._codexSessionId)return task;
    task._codexSessionId ||= nativeId;task.parentNativeId ||= item.forked_from_id||item.parent_thread_id||'';
    task.nativeId = nativeId || task.nativeId; task.id = `codex-${hash(task.nativeId)}`;
    task.cwd = item.cwd || task.cwd;
    const source = typeof item.source === 'object' ? item.source?.type || JSON.stringify(item.source) : item.source || '';
    const origin = String(item.originator || item.thread_source || '');
    task.surface = /desktop|codex.app|daybreak/i.test(origin) ? '桌面' : /vscode|extension/i.test(source + origin) ? '编辑器' : /appserver/i.test(source) ? '桌面/服务' : /cli/i.test(source) ? 'CLI' : task.surface;
  }
  consumeUsage(task,record,evidence,timestamp);
  if (record.type === 'response_item') {
    if (item.type === 'message' && item.channel !== 'analysis') {message(task, item.role, contentText(item.content), timestamp, evidence);if(item.channel==='commentary')task.activity='recent';}
    if (item.type === 'function_call') tool(task, item.name || '未命名工具', item.arguments, timestamp, evidence);
  }
  if (record.type === 'event_msg') {
    if (item.type === 'agent_message' && item.phase !== 'analysis') {message(task, 'assistant', item.message, timestamp, evidence);if(item.phase==='commentary')task.activity='recent';}
    if (item.type === 'user_message') message(task, 'user', item.message, timestamp, evidence);
    if (item.type === 'task_started') { task.activity = 'recent'; addEvent(task, 'status', '新一轮任务开始', timestamp, evidence); }
    if (item.type === 'task_complete') { task.activity = 'responded'; addEvent(task, 'status', '本轮回复已结束；整体任务完成待确认', timestamp, evidence); if (item.last_agent_message && !task.summary) message(task, 'assistant', item.last_agent_message, timestamp, evidence); }
    if (['turn_aborted', 'error'].includes(item.type)) { task.activity = 'interrupted'; addEvent(task, 'status', '本轮中断或发生错误', timestamp, evidence); }
  }
  return task;
}
export function consumeClaude(task, record, evidence) {
  const timestamp = epoch(record.timestamp); if (timestamp) { task.createdAt ||= timestamp; task.updatedAt = Math.max(task.updatedAt, timestamp); }
  if (record.sessionId) { task.nativeId = task.subagentId ? `${record.sessionId}/subagent/${task.subagentId}` : record.sessionId; task.id = `claude-${hash(task.nativeId)}`; if (task.subagentId) task.parentNativeId = record.sessionId; }
  task.cwd = record.cwd || task.cwd;
  if (record.entrypoint) task.surface = task.subagentId ? '子代理' : /vscode|ide/i.test(record.entrypoint) ? '编辑器' : /desktop/i.test(record.entrypoint) ? '桌面' : 'CLI';
  consumeUsage(task,record,evidence,timestamp);
  if (record.type === 'custom-title') task.title = String(record.customTitle || record.title || task.title).slice(0, 180);
  if (record.type === 'user' && !record.isMeta) {
    const content = record.message?.content;
    // tool_result items are intentionally excluded from the user goal.
    message(task, 'user', contentText(content), timestamp, evidence);
    if (contentText(content)) task.activity = 'recent';
  }
  if (record.type === 'assistant') {
    const content = record.message?.content || [];
    message(task, 'assistant', contentText(content), timestamp, evidence);
    if (Array.isArray(content)) for (const block of content) if (block.type === 'tool_use') tool(task, block.name || '未命名工具', block.input, timestamp, evidence);
    if (record.message?.stop_reason === 'tool_use') task.activity = 'recent';
  }
  if (record.type === 'system' && /error/i.test(record.subtype || '')) { task.activity = 'interrupted'; addEvent(task, 'status', '记录包含错误事件', timestamp, evidence); }
  return task;
}
export function cursorTask(header, body, file) {
  const nativeId = header.composerId || body?.composerId; if (!nativeId) return null;
  // A draft with no transcript is not a real task.
  const hasConversation = body && (Object.keys(body.conversationMap || {}).length || body.fullConversationHeadersOnly?.length || body.text || body.todos?.length);
  if ((body?.isDraft || header.isDraft) && !hasConversation) return null;
  const evidence = { path: file, locator: `composerId=${nativeId}` };
  const task = emptyTask('cursor', nativeId, file, { surface: '编辑器', title: body?.name || header.name || '', createdAt: epoch(header.createdAt || body?.createdAt), updatedAt: Math.max(epoch(header.lastUpdatedAt),epoch(body?.lastUpdatedAt),epoch(header.createdAt || body?.createdAt)), archived: Boolean(header.isArchived), partial: !body || Boolean(body._missingBubbles || body._missingMetadata), evidence });
  const workspace = body?.workspaceIdentifier || header.workspaceIdentifier;
  const uri = workspace?.uri;
  task.cwd = typeof workspace === 'string' ? workspace : workspace?.fsPath || (typeof uri==='string'?uri:uri?.fsPath||uri?.external||uri?.path) || workspace?.path || '';
  if (task.cwd.startsWith('file:')) { try { task.cwd = decodeURIComponent(new URL(task.cwd).pathname).replace(/^\/([A-Za-z]:)/, '$1'); } catch { task.cwd = ''; } }
  const conversation = body?.conversationMap || {};
  const entries = Array.isArray(conversation) ? conversation : Object.values(conversation);
  for (const entry of entries) {
    consumeUsage(task,entry,{...evidence,locator:`${evidence.locator};bubbleId=${entry.bubbleId||entry.id||'?'}`},epoch(entry.timestamp||entry.createdAt,task.updatedAt));
    if (entry.toolFormerData || entry.grouping?.toolCallId || entry.grouping?.hasThinking || entry.capabilityType === 30) continue;
    const role = entry.role || (entry.type === 1 || entry.type === 'user' ? 'user' : entry.type === 2 || entry.type === 'assistant' ? 'assistant' : '');
    const text = contentText(entry.text || entry.content || entry.message?.content);
    const timestamp=epoch(entry.timestamp || entry.createdAt, task.updatedAt);task.updatedAt=Math.max(task.updatedAt,timestamp);
    message(task, role, text, timestamp, { ...evidence, locator: `${evidence.locator}; bubbleId=${entry.bubbleId || entry.id || '?'}` });
  }
  if (body?.text && !task.goal) message(task, 'user', contentText(body.text), task.createdAt, evidence);
  setTodos(task, body?.todos);
  if (!entries.length || body?.fullConversationHeadersOnly?.some(h=>!entries.some(e=>(e.bubbleId||e.id)===h.bubbleId))) task.partial = true;
  task.title ||= 'Cursor 会话（标题不可读）';
  if (header.hasBlockingPendingActions) { task.activity = 'unknown'; task.requiresAction=true; }
  return task;
}
export function finalize(task) {
  const project = projectFor(task.cwd);
  return { ...task, title: cleanText(task.title, 180) || '未命名会话', projectId: project.id, projectName: project.name, projectRoot: project.root, completion: task.sourceOutcome==='blocked'?'blocked':task.todos.length && task.todos.every(todo => todo.status === 'completed') ? 'reported_complete' : 'unconfirmed' };
}
