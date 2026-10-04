import { createReadStream, existsSync, watch } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldThread } from 'node:timers/promises';
import { consumeExtra, zstdFrames, decodeFrame } from './adapters.mjs';
import { consumeClaude, consumeCodex, cursorTask, emptyTask, epoch, finalize, cleanText, PARSER_VERSION } from './parsers.mjs';

export async function* walk(root, extension) {
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(file, extension);
    else if (entry.isFile() && entry.name.endsWith(extension)) yield file;
  }
}
export function workbuddyTaskDirectory(root,id){return typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)?path.join(root,'tasks',id):null;}
export async function readLog(file, provider, previous, meta, onProgress) {
  const stats = await stat(file);
  const reset = !previous || previous.task._parserVersion !== PARSER_VERSION || previous.task._sourceInode !== stats.ino || stats.size < previous.offset || (stats.size === previous.size && stats.mtimeMs !== previous.mtime);
  let offset = reset ? 0 : previous.offset; let line = reset ? 0 : previous.line;
  let task = reset ? emptyTask(provider, path.basename(file, '.jsonl'), file, meta) : previous.task;
  task._newEvents = [];
  if (!reset && stats.mtimeMs === previous.mtime && stats.size === previous.size) {
    const metadataChanged = meta && ((meta.title && task.title !== meta.title) || (meta.archived !== undefined && task.archived !== meta.archived));
    if (!metadataChanged) return { unchanged: true, task, stats, offset, line, unfinished: Boolean(task._unfinished) };
    task = { ...task, title: meta.title || task.title, archived: meta.archived ?? task.archived };
    return { unchanged: false, task: finalize(task), stats, offset, line };
  }
  if (!reset && meta) task = { ...task, title: meta.title || task.title, archived: meta.archived ?? task.archived };
  let pending = Buffer.alloc(0); let consumed = 0;
  const stream = createReadStream(file, { start: offset, highWaterMark: 65536 });
  try {
    for await (const chunk of stream) {
      pending = Buffer.concat([pending, chunk]); let newline;
      while ((newline = pending.indexOf(10)) !== -1) {
        const raw = pending.subarray(0, newline).toString('utf8').replace(/\r$/, '');
        offset += newline + 1; pending = pending.subarray(newline + 1); line++;
        if (raw.trim()) {
          try { const record = JSON.parse(raw); const evidence = { path: file, line }; task = provider === 'codex' ? consumeCodex(task, record, evidence) : provider === 'claude' ? consumeClaude(task, record, evidence) : consumeExtra(task, record, evidence); }
          catch { task.partial = true; }
        }
        if (++consumed % 250 === 0) { onProgress?.(); await yieldThread(); }
      }
      if (pending.length > 32 * 1024 * 1024) throw new Error('单条记录超过 32MB，跳过并标记部分接入');
    }
  } finally { stream.destroy(); }
  // Do not commit an unfinished last line. The next append resumes from its beginning.
  task.evidence = { path: file, line: 1 };
  task._parserVersion = PARSER_VERSION; task._sourceInode = stats.ino; task._unfinished = pending.length > 0;
  return { task: finalize(task), stats, offset, line, unfinished: pending.length > 0, unchanged: false, reset: reset && Boolean(previous) };
}
function readonly(file) { const db = new DatabaseSync(file, { readOnly: true, timeout: 150 }); db.exec('PRAGMA query_only=ON;'); return db; }
function safeRows(db, table) { try { return db.prepare(`SELECT * FROM ${table}`).all(); } catch { return []; } }
function parsed(value) { try { return JSON.parse(value); } catch { return null; } }
export async function readCompressed(file, previous, meta = {}) {
  const stats = await stat(file);
  const reset = !previous || previous.task._parserVersion !== PARSER_VERSION || previous.task._sourceInode !== stats.ino || stats.size < previous.offset || (stats.size === previous.size && stats.mtimeMs !== previous.mtime);
  if (!reset && stats.size === previous.size && stats.mtimeMs === previous.mtime) return { unchanged: true, task: previous.task, stats, unfinished: previous.task._unfinished };
  if (stats.size > 128 * 1024 * 1024) throw new Error('压缩日志超过当前读取上限');
  const bytes = await readFile(file); const scanned = zstdFrames(bytes);
  let task = reset ? emptyTask('deepseek', path.basename(path.dirname(file)), file, meta) : previous.task;
  task._newEvents = []; let offset = reset ? 0 : previous.offset; let line = reset ? 0 : previous.line; let pending = reset ? '' : task._compressedPending || '';
  for (const frame of scanned.frames) {
    if (frame.end <= offset) continue;
    pending += decodeFrame(bytes.subarray(frame.start, frame.end)); const rows = pending.split('\n'); pending = rows.pop();
    for (const raw of rows) { line++; if (!raw.trim()) continue; try { task = consumeExtra(task, JSON.parse(raw), { path: file, line, locator: `frame=${frame.start}` }); } catch { task.partial = true; } }
    offset = frame.end; await yieldThread();
  }
  task.evidence = { path: file, line: 1 }; task._compressedPending = pending;
  task._parserVersion = PARSER_VERSION; task._sourceInode = stats.ino; task._unfinished = scanned.incomplete || Boolean(pending);
  return { task: finalize(task), stats, offset, line, unfinished: task._unfinished, reset: reset && Boolean(previous) };
}
const databaseFailure = e => ['ECONNREFUSED','ECONNRESET','PROTOCOL_CONNECTION_LOST','POOL_CLOSED','ETIMEDOUT','EPIPE','ER_SERVER_SHUTDOWN'].includes(e.code);
export class Collector {
  constructor(store, config, notify, onError = () => {}) {
    config = { pi: path.join(config.home, '.pi', 'agent'), deepseek: path.join(config.home, '.dsh'), workbuddy: path.join(config.home, '.workbuddy'), ...config };
    this.onError = onError; this.store = store; this.config = config; this.notify = notify; this.busy = false; this.stopped = false; this.dirty = false; this.watchers = [];
    this.changedDates=new Set();this.progress = { active: false, completed: 0, total: 0 }; this.codexMeta = new Map();
    this.sources = [
      { id: 'codex', name: 'Codex / Codex CLI', state: 'scanning', message: '等待扫描会话索引与日志', locations: [config.codex] },
      { id: 'claude', name: 'Claude Code / CLI', state: 'scanning', message: '等待扫描项目会话日志', locations: [config.claude] },
      { id: 'cursor', name: 'Cursor', state: 'scanning', message: '等待检查本机会话数据库', locations: [config.cursor] },
      { id: 'pi', name: 'Pi CLI', state: 'scanning', message: '读取本机分支会话日志', locations: [config.pi] },
      { id: 'deepseek', name: 'DeepSeek Harness', state: 'scanning', message: '读取本机压缩会话日志', locations: [config.deepseek] },
      { id: 'workbuddy', name: 'WorkBuddy', state: 'scanning', message: '读取本机会话与待办', locations: [config.workbuddy] },
    ].map(s => ({ ...s, syncAt: null, count: 0 }));
  }
  source(id) { return this.sources.find(s => s.id === id); }
  async workbuddyIndex() {
    if (this.config.disabled?.includes('workbuddy')) return;
    let db; this.workbuddyMeta = new Map();
    const file = path.join(this.config.workbuddy, 'workbuddy.db');
    if (!existsSync(file)) return;
    try {
      db = readonly(file);
      for (const row of db.prepare('SELECT id,cwd,title,custom_title,created_at,updated_at FROM sessions WHERE deleted_at IS NULL').all()) {
        const meta = { nativeId: row.id, cwd: row.cwd || '', title: cleanText(row.custom_title || row.title || '',180), createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at), evidence: { path: file, locator: `sessions.id=${row.id}` } };
        this.workbuddyMeta.set(row.id, meta);
        const task = finalize(emptyTask('workbuddy', row.id, file, { ...meta, partial: true, surface: '桌面/CLI' }));
        if (!(this.store.has?await this.store.has(task.id):await this.store.get(task.id))) await this.store.upsert(task);
      }
    } catch (e) { if(databaseFailure(e))throw e;(this.metadataErrors||={}).workbuddy=true; this.source('workbuddy').message = '元数据暂不可读，继续读取会话日志'; }
    finally { db?.close(); }
  }
  async codexIndex() {
    const source = this.source('codex'); let db;
    try {
      const entries = await readdir(this.config.codex).catch(() => []);
      const candidates = entries.filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
      if (!candidates.length) return;
      const file = path.join(this.config.codex, candidates[0]); db = readonly(file);
      const rows = db.prepare('SELECT * FROM threads ORDER BY updated_at DESC').all();
      for (const row of rows) {
        const meta = { nativeId: row.id, title: cleanText(row.name || row.title || '',180), cwd: row.cwd || '', createdAt: epoch(row.created_at_ms || row.created_at), updatedAt: epoch(row.updated_at_ms || row.updated_at), archived: Boolean(row.archived), evidence: { path: file, locator: `threads.id=${row.id}` }, surface: /desktop|daybreak/i.test(row.originator || '') ? '桌面' : /cli/i.test(row.source || '') ? 'CLI' : /vscode/i.test(row.source || '') ? '编辑器' : '桌面/服务' };
        if (row.rollout_path) this.codexMeta.set(path.resolve(row.rollout_path), meta);
        const task = finalize(emptyTask('codex', row.id, file, meta));
        const existing = this.store.has?await this.store.has(task.id):await this.store.get(task.id);
        // Metadata must never overwrite an already parsed transcript or its evidence.
        if (!existing) { task.partial = true; await this.store.upsert(task); }
      }
      source.locations = [file, path.join(this.config.codex, 'sessions'), path.join(this.config.codex, 'archived_sessions')];
    } catch (e) { if(databaseFailure(e))throw e;(this.metadataErrors||={}).codex=true; source.state = 'partial'; source.message = '索引暂不可读，继续读取日志'; }
    finally { db?.close(); }
  }
  async cursorIndex() {
    const source = this.source('cursor'); const root = this.config.cursor; const files = [];
    const globalFile = path.join(root, 'globalStorage', 'state.vscdb'); if (existsSync(globalFile)) files.push(globalFile);
    for await (const file of walk(path.join(root, 'workspaceStorage'), '.vscdb')) files.push(file);
    if (!files.length) { source.state = 'missing'; source.message = '指定目录中未找到 Cursor 会话数据库'; source.syncAt = Date.now(); return; }
    const fingerprints=[];for(const file of files)for(const candidate of [file,file+'-wal']){try{const r=await stat(candidate);fingerprints.push([candidate,r.size,r.mtimeMs,r.ino]);}catch{fingerprints.push([candidate,null]);}}
    const fingerprint=JSON.stringify(fingerprints),now=Date.now();if(this.cursorFingerprint===fingerprint&&now-(this.cursorCheckedAt||0)<60000){source.syncAt=now;return;}this.cursorFingerprint=fingerprint;this.cursorCheckedAt=now;
    const discovered=new Map();
    let parsedCount = 0, headersCount = 0, partialCount = 0, drafts = 0, errors = 0;
    for (const file of files) {
      let db;
      try {
        db = readonly(file);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
        const headers = tables.includes('composerHeaders') ? safeRows(db, 'composerHeaders').map(row => ({ ...row, ...parsed(row.value) })) : [];
        const bodies = new Map();
        if (tables.includes('cursorDiskKV')) {
          for (const row of db.prepare("SELECT key,value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all()) { const body = parsed(row.value); if (body) bodies.set(body.composerId || row.key.slice(13), body); }
        }
        if (tables.includes('ItemTable')) {
          for (const row of db.prepare("SELECT value FROM ItemTable WHERE key='composer.composerData'").all()) {
            const data = parsed(row.value); for (const header of data?.allComposers || []) if (!headers.some(h => h.composerId === header.composerId)) headers.push(header);
          }
        }
        for (const [id, body] of bodies) if (!headers.some(h => h.composerId === id)) headers.push({ composerId: id, createdAt: body.createdAt });
        // Recent Cursor versions store message bodies separately from composerData.
        const bubbles = new Map();
        if (tables.includes('cursorDiskKV')) for (const row of db.prepare("SELECT key,value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all()) {
          const key = row.key.match(/^bubbleId:([^:]+):(.+)$/); if (!key) continue;
          if (!bubbles.has(key[1])) bubbles.set(key[1], new Map());
          bubbles.get(key[1]).set(key[2], parsed(row.value));
        }
        for (const [id, messages] of bubbles) {
          const body = bodies.get(id) || { composerId: id, _missingMetadata: true };
          const inline = new Map(Object.entries(body.conversationMap || {}).filter(([,value])=>value&&typeof value==='object').map(([key, value]) => [value.bubbleId || value.id || key, value]));
          const order = body.fullConversationHeadersOnly?.length ? body.fullConversationHeadersOnly : [...messages].map(([bubbleId, value]) => ({ bubbleId, createdAt: value?.createdAt })).sort((a,b) => epoch(a.createdAt)-epoch(b.createdAt));
          const entries = []; const seen = new Set();
          for (const header of order) { const entry = inline.get(header.bubbleId) || messages.get(header.bubbleId); seen.add(header.bubbleId); if (entry) entries.push({ ...header, ...entry, bubbleId: header.bubbleId }); else body._missingBubbles = true; }
          for (const [bubbleId, entry] of inline) if (!seen.has(bubbleId)) entries.push(entry);
          body.conversationMap = entries; bodies.set(id, body);
          if (!headers.some(h=>h.composerId===id)) headers.push({composerId:id,createdAt:body.createdAt});
        }
        headersCount += headers.length;
        for (const header of headers) {
          const body = bodies.get(header.composerId); const task = cursorTask(header, body, file);
          if (!task) { drafts++; continue; }
          discovered.set(task.nativeId,(discovered.get(task.nativeId)??true)&&task.partial);if (task.partial) partialCount++;
          const existing = this.store.get ? await this.store.get(task.id) : null;
          if (task.partial && existing && !existing.partial) { parsedCount++; continue; }
          if(await this.store.upsert(finalize(task)))for(const e of task._newEvents||[])this.changedDates.add(new Date(e.timestamp+28800000).toISOString().slice(0,10));parsedCount++;
        }
      } catch (e) { if(databaseFailure(e))throw e; errors++; }
      finally { db?.close(); }
      await yieldThread();
    }
    source.discoveredCount=discovered.size;parsedCount=discovered.size;partialCount=[...discovered.values()].filter(Boolean).length;if(errors)this.cursorFingerprint=null;source.locations = files; source.syncAt = Date.now();
    source.state = errors === files.length ? 'error' : partialCount || errors || !parsedCount ? 'partial' : 'ready';
    source.message = errors === files.length ? '数据库暂不可读，将自动重试' : `发现 ${headersCount} 个会话头；${parsedCount} 个可导入，${partialCount} 个缺少完整正文，${drafts} 个空草稿已排除${errors ? `，${errors} 个数据库暂不可读` : ''}。当前适配本机 SQLite 结构；未覆盖的正文不会补写。`;
  }
  async scan() {
    if (this.busy || this.stopped) { this.dirty = true; return; } this.busy = true; this.dirty = false;this.metadataErrors={};
    try {
      if (!this.config.disabled?.includes('codex')) await this.codexIndex();
      await this.workbuddyIndex(); const files = [];
      for (const [provider, roots] of [['codex', [path.join(this.config.codex, 'sessions'), path.join(this.config.codex, 'archived_sessions')]], ['claude', [path.join(this.config.claude, 'projects')]], ['pi', [path.join(this.config.pi, 'sessions')]], ['deepseek', [path.join(this.config.deepseek, 'sessions')]], ['workbuddy', [path.join(this.config.workbuddy, 'projects')]]]) {
        if (this.config.disabled?.includes(provider)) continue;
        for (const root of roots) for await (const file of walk(root, '')) {
          if (!file.endsWith('.jsonl') && !(provider === 'deepseek' && file.endsWith('.jsonl.zstd'))) continue;
          try { const stats = await stat(file); files.push({ file, provider, stats }); } catch { /* Concurrent rotation: retry next cycle. */ }
        }
      }
      // Use recorded update timestamps when available, then mtime. Newest tasks become usable first.
      files.sort((a, b) => (this.codexMeta.get(b.file)?.updatedAt || b.stats.mtimeMs) - (this.codexMeta.get(a.file)?.updatedAt || a.stats.mtimeMs));
      this.progress = { active: true, completed: 0, total: files.length }; this.notify();
      const errors = Object.fromEntries(this.sources.map(s => [s.id,0])); const partial = {...errors};
      let changed = 0;
      for (const item of files) {
        if (this.stopped) break;
        const subagent = item.provider === 'claude' && item.file.split(path.sep).includes('subagents');
        const meta = this.codexMeta.get(item.file) || { archived: item.file.includes('archived_sessions'), surface: subagent ? '子代理' : item.provider === 'claude' ? 'CLI' : '未知入口', ...(subagent ? { subagentId: path.basename(item.file, '.jsonl') } : {}) };
        try {
          const header=await this.store.checkpointHeader?.(item.file);const metaTitle=this.store.scrub?.({title:meta.title}).title||meta.title;
          if(item.provider!=='workbuddy'&&header&&Number(header.version)===PARSER_VERSION&&Number(header.inode)===item.stats.ino&&Number(header.size)===item.stats.size&&header.mtime===item.stats.mtimeMs&&(!metaTitle||header.title===metaTitle)&&(meta.archived===undefined||(header.archived==='true')===meta.archived)){if(header.partial==='true'||header.unfinished==='true')partial[item.provider]++;this.progress.completed++;await yieldThread();continue;}
          const previous = await this.store.checkpoint(item.file);
          const result = item.file.endsWith('.zstd') ? await readCompressed(item.file, previous, meta) : await readLog(item.file, item.provider, previous, meta);
          if (item.provider === 'workbuddy') {
            const details = this.workbuddyMeta?.get(result.task.nativeId);
            if (details) { if((details.title&&details.title!==result.task.title)||(details.cwd&&details.cwd!==result.task.cwd)||details.updatedAt>result.task.updatedAt)result.unchanged=false;result.task.title = details.title || result.task.title; result.task.cwd = details.cwd || result.task.cwd;result.task.updatedAt=Math.max(result.task.updatedAt,details.updatedAt); }
            const todos = [];const todoRoot=workbuddyTaskDirectory(this.config.workbuddy,result.task.nativeId);if(!todoRoot)result.task.partial=true;
            if(todoRoot)for await (const todoFile of walk(todoRoot, '.json')) { try { const todo = JSON.parse(await readFile(todoFile, 'utf8')); todos.push({ text: todo.subject || todo.description || '', status: todo.status || 'pending' }); } catch { result.task.partial = true; } }
            if (JSON.stringify(todos) !== JSON.stringify(result.task.todos)) { result.task.todos = todos; result.unchanged = false; }
            result.task = finalize(result.task);
          }
          if (['workbuddy','deepseek'].includes(item.provider) && !result.task.goal && !result.task.summary && !result.task.partial) { result.task.partial = true; result.unchanged = false; }
          if (!result.unchanged) {
            await this.store.transaction(async tx => {
              const sameSource = (await tx.get(result.task.id))?.evidence.path === item.file;
              await tx.upsert(result.task, result.reset && sameSource);
              await tx.saveCheckpoint(item.file, result.stats, result.offset, result.line, result.task);
            });
            for(const event of result.task._newEvents||[])if(event.timestamp)this.changedDates.add(new Date(event.timestamp+28800000).toISOString().slice(0,10));changed++;
          }
          if (result.task.partial || result.unfinished) partial[item.provider]++;
        } catch (e) { if(databaseFailure(e))throw e; errors[item.provider]++; }
        this.progress.completed++;
        if (changed && changed % 8 === 0) this.notify();
        await yieldThread();
      }
      for (const id of ['codex', 'claude', 'pi', 'deepseek', 'workbuddy']) {
        const source = this.source(id); const count = files.filter(file => file.provider === id).length;
        if (this.config.disabled?.includes(id)) { source.state = 'missing'; source.message = '用户已停用采集'; continue; }
        source.state = !count ? 'missing' : errors[id] === count ? 'error' : errors[id] || partial[id] || this.metadataErrors[id] ? 'partial' : 'ready';
        source.message = !count ? '未找到可扫描的会话日志；已保留现有索引' : `已检查 ${count} 份日志${errors[id] ? `，${errors[id]} 份暂不可读` : ''}${partial[id] ? `，${partial[id]} 份记录不完整` : ''}。回复结束与整体完成分别记录；原始文件只读。`;
        if(this.metadataErrors[id])source.message+=' 会话索引元数据暂不可读，将继续重试。';source.syncAt = Date.now();
      }
      if (!this.config.disabled?.includes('cursor')) await this.cursorIndex();
    } finally { this.progress.active = false; this.busy = false; this.notify({dates:[...this.changedDates]});this.changedDates.clear(); }
  }
  async start() {
    for (const root of [path.join(this.config.codex, 'sessions'), path.join(this.config.codex, 'archived_sessions'), path.join(this.config.claude, 'projects'), path.join(this.config.pi,'sessions'), path.join(this.config.deepseek,'sessions'), path.join(this.config.workbuddy,'projects')]) {
      try { const watcher = watch(root, { recursive: true }, () => { this.dirty = true; }); watcher.on('error', () => { this.dirty = true; }); this.watchers.push(watcher); } catch { /* Polling also handles roots created after startup. */ }
    }
    this.timer = setInterval(() => { void this.scan().catch(e => { this.onError(e); this.notify(); }); }, 3000);
    await this.scan();
  }
  async stop() { this.stopped = true; clearInterval(this.timer); this.watchers.forEach(w => w.close()); while(this.busy) await new Promise(resolve=>setTimeout(resolve,20)); }
}
