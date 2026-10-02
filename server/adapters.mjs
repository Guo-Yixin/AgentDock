import { zstdDecompressSync } from 'node:zlib';
import { hash, message, addEvent, setTodos, contentText, cleanText, epoch } from './parsers.mjs';

export function consumeExtra(task, row, evidence) {
  const timestamp = epoch(row.timestamp || row.time || row.createdAt || row.message?.timestamp);
  if (timestamp) { task.createdAt ||= timestamp; task.updatedAt = Math.max(task.updatedAt, timestamp); }
  if (task.provider === 'pi') {
    if (row.type === 'session') { task.nativeId = row.id; task.cwd = row.cwd || ''; task.parentNativeId = row.parentSession || ''; task.surface = 'CLI'; if (![1, 2, 3].includes(row.version)) task.partial = true; }
    if (row.id && row.type !== 'session') {
      const role = row.message?.role; const text = ['user', 'assistant'].includes(role) ? contentText(row.message.content) : '';
      (task._piNodes ||= {})[row.id] = { id: row.id, parentId: row.parentId, role, text: cleanText(text), timestamp, evidence };
      task._piLeaf = row.id;
      if (cleanText(text)) { message(task, role, text, timestamp, evidence); }
    }
    if(row.type==='message'&&row.message?.stopReason==='toolUse')task.activity='recent';
    if(row.type==='message'&&['error','aborted'].includes(row.message?.stopReason))task.activity='interrupted';
    if (row.type === 'session_info' && row.name) task.title = row.name;
    const nodes = task._piNodes || {}; const parents = new Set(Object.values(nodes).map(n => n.parentId));
    task.branches = Object.values(nodes).filter(n => !parents.has(n.id)).map(leaf => {
      const chain = []; const seen = new Set(); let entry = leaf;
      while (entry && !seen.has(entry.id)) { seen.add(entry.id); chain.unshift(entry); entry = nodes[entry.parentId]; }
      return { id: leaf.id, summaryEvidence: [...chain].reverse().find(n => n.role === 'assistant' && n.text)?.evidence || null, summary: [...chain].reverse().find(n => n.role === 'assistant' && n.text)?.text || '', goal: chain.find(n => n.role === 'user' && n.text)?.text || '', events: chain.filter(n => n.text).map(n => ({ kind: n.role, text: n.text, timestamp: n.timestamp, evidence: n.evidence })) };
    });
    task.inferredBranch = task._piLeaf; const branch = task.branches.find(b => b.id === task._piLeaf); if (branch) { task.summary = branch.summary; task.goal = branch.goal; }
  }
  if (task.provider === 'workbuddy') {
    task.nativeId = row.sessionId || task.nativeId; task.cwd = row.cwd || row.meta?.cwd || task.cwd; task.surface = '桌面/CLI';
    if (row.type === 'session-meta') { task.title = row.meta?.customTitle || row.meta?.title || task.title; task.cwd = row.meta?.cwd || task.cwd; }
    if (row.type === 'message' && ['user', 'assistant'].includes(row.role)) message(task, row.role, contentText(row.content), timestamp, evidence);
    if (row.type === 'todo' || row.todos) setTodos(task, row.todos || row.content);
  }
  if (task.provider === 'deepseek') {
    const data = row.data || {};
    if (row.type === 'session') { task.nativeId = row.id; task.cwd = row.cwd || ''; task.createdAt = row.createdAt || task.createdAt; task.parentNativeId = row.parentSession || ''; task.surface = row.origin === 'subagent' ? '子代理' : 'CLI'; if (row.version !== 0) task.partial = true; }
    const location = { ...evidence, locator: `${evidence.locator || ''};seq=${row.seq ?? row.seq0 ?? '?'}` };
    if(row.type==='turn/start'){task.activity='recent';task.sourceOutcome=null;}
    if (row.type === 'user/message') message(task, 'user', contentText(data.content || data.text || data.message?.content), timestamp, location);
    if (row.type === 'assistant/message') { message(task, 'assistant', contentText(data.message?.content || data.content || data.message?.text), timestamp, location); task._harnessText = ''; task.activity=data.interrupted?'interrupted':'recent'; }
    if (row.type === 'text-chunks') { const text = (data.texts || []).join(''); task._harnessText = (task._harnessText || '') + text; }
    if (row.type === 'assistant/chunk' && data.chunk?.type === 'text-delta') task._harnessText = (task._harnessText || '') + (data.chunk.text || data.chunk.delta || '');
    if (row.type === 'turn/end') { if (task._harnessText) { message(task, 'assistant', task._harnessText, timestamp, location); task._harnessText = ''; } const reason=typeof data.reason==='string'?data.reason:data.reason?.kind;task.sourceOutcome=reason;task.activity=['completed','stop'].includes(reason)?'responded':['aborted','blocked','error','max-tokens','interrupted'].includes(reason)?'interrupted':'unknown';task.blockedEvidence=reason==='blocked'?location:null;addEvent(task, 'status', reason==='blocked'?'本轮阻塞，整体任务尚未确认':'本轮结束，整体任务完成待确认', timestamp, location); }
    if (/todo/.test(row.type)) setTodos(task, data.todos || data.items);
  }
  task.id = `${task.provider}-${hash(task.nativeId)}`;
  return task;
}

// Zstandard container framing: each independent complete frame is decoded once.
export function zstdFrames(bytes) {
  const frames = []; let cursor = 0;
  while (cursor < bytes.length) {
    const start = cursor; const incomplete = () => ({ frames, incomplete: true, offset: start });
    if (bytes.length - cursor < 5) return incomplete();
    if (bytes.readUInt32LE(cursor) !== 0xfd2fb528) throw new Error('压缩日志帧格式不支持');
    const header = bytes[cursor + 4]; cursor += 5;
    if (header & 0x18) throw new Error('压缩日志帧头无效');
    const single = Boolean(header & 32), sizeFlag = header >> 6, dictionary = header & 3;
    const rest = (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (sizeFlag ? 2 ** sizeFlag : single ? 1 : 0);
    if (bytes.length - cursor < rest) return incomplete(); cursor += rest;
    let last = false;
    while (!last) {
      if (bytes.length - cursor < 3) return incomplete(); const block = bytes.readUIntLE(cursor, 3); cursor += 3;
      last = Boolean(block & 1); const kind = (block >> 1) & 3; if (kind === 3) throw new Error('压缩日志块格式无效');
      const length = kind === 1 ? 1 : block >>> 3; if (bytes.length - cursor < length) return incomplete(); cursor += length;
    }
    if (header & 4) { if (bytes.length - cursor < 4) return incomplete(); cursor += 4; }
    frames.push({ start, end: cursor });
  }
  return { frames, incomplete: false, offset: cursor };
}
export const decodeFrame = bytes => zstdDecompressSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8');
