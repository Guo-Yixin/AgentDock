import { createReadStream, existsSync, watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldThread } from 'node:timers/promises';
import { consumeClaude, consumeCodex, cursorTask, emptyTask, epoch, finalize, PARSER_VERSION } from './parsers.mjs';

export async function* walk(root, extension) {
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(file, extension);
    else if (entry.isFile() && entry.name.endsWith(extension)) yield file;
  }
}
export async function readLog(file, provider, previous, meta, onProgress) {
  const stats = await stat(file);
  const reset = !previous || previous.task._parserVersion !== PARSER_VERSION || previous.task._sourceInode !== stats.ino || stats.size < previous.offset || (stats.size === previous.size && stats.mtimeMs !== previous.mtime);
  let offset = reset ? 0 : previous.offset; let line = reset ? 0 : previous.line;
  let task = reset ? emptyTask(provider, path.basename(file, '.jsonl'), file, meta) : previous.task;
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
          try { const record = JSON.parse(raw); const evidence = { path: file, line }; task = provider === 'codex' ? consumeCodex(task, record, evidence) : consumeClaude(task, record, evidence); }
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
export class Collector {
  constructor(store, config, notify) {
    this.store = store; this.config = config; this.notify = notify; this.busy = false; this.stopped = false; this.dirty = false; this.watchers = [];
    this.progress = { active: false, completed: 0, total: 0 }; this.codexMeta = new Map();
    this.sources = [
      { id: 'codex', name: 'Codex / Codex CLI', state: 'scanning', message: '等待扫描会话索引与日志', locations: [config.codex] },
      { id: 'claude', name: 'Claude Code / CLI', state: 'scanning', message: '等待扫描项目会话日志', locations: [config.claude] },
      { id: 'cursor', name: 'Cursor', state: 'scanning', message: '等待检查本机会话数据库', locations: [config.cursor] },
      { id: 'pi', name: 'Pi CLI', state: 'planned', message: '第二阶段接入；首版尚未采集 Pi 会话', locations: existsSync(path.join(config.home, '.pi', 'agent', 'sessions')) ? [path.join(config.home, '.pi', 'agent', 'sessions')] : [] },
      { id: 'deepseek', name: 'DeepSeek Harness', state: 'planned', message: '待确认具体 Harness 版本与会话记录来源', locations: [] },
      { id: 'workbuddy', name: 'WorkBuddy', state: 'planned', message: '待确认当前版本的任务持久化位置与导出方式', locations: [] },
    ].map(s => ({ ...s, syncAt: null, count: 0 }));
  }
  source(id) { return this.sources.find(s => s.id === id); }
  async codexIndex() {
    const source = this.source('codex'); let db;
    try {
      const entries = await readdir(this.config.codex).catch(() => []);
      const candidates = entries.filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
      if (!candidates.length) return;
      const file = path.join(this.config.codex, candidates[0]); db = readonly(file);
      const rows = db.prepare('SELECT * FROM threads ORDER BY updated_at DESC').all();
      for (const row of rows) {
        const meta = { nativeId: row.id, title: row.name || row.title || '', cwd: row.cwd || '', createdAt: epoch(row.created_at_ms || row.created_at), updatedAt: epoch(row.updated_at_ms || row.updated_at), archived: Boolean(row.archived), evidence: { path: file, locator: `threads.id=${row.id}` }, surface: /desktop|daybreak/i.test(row.originator || '') ? '桌面' : /cli/i.test(row.source || '') ? 'CLI' : /vscode/i.test(row.source || '') ? '编辑器' : '桌面/服务' };
        if (row.rollout_path) this.codexMeta.set(path.resolve(row.rollout_path), meta);
        const task = finalize(emptyTask('codex', row.id, file, meta));
        const existing = this.store.get(task.id);
        // Metadata must never overwrite an already parsed transcript or its evidence.
        if (!existing) { task.partial = true; this.store.upsert(task); }
      }
      source.locations = [file, path.join(this.config.codex, 'sessions'), path.join(this.config.codex, 'archived_sessions')];
    } catch (e) { source.state = 'partial'; source.message = `索引暂不可读，继续读取日志：${e.message}`; }
    finally { db?.close(); }
  }
  async cursorIndex() {
    const source = this.source('cursor'); const root = this.config.cursor; const files = [];
    const globalFile = path.join(root, 'globalStorage', 'state.vscdb'); if (existsSync(globalFile)) files.push(globalFile);
    for await (const file of walk(path.join(root, 'workspaceStorage'), '.vscdb')) files.push(file);
    if (!files.length) { source.state = 'missing'; source.message = '指定目录中未找到 Cursor 会话数据库'; source.syncAt = Date.now(); return; }
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
        headersCount += headers.length;
        for (const header of headers) {
          const body = bodies.get(header.composerId); const task = cursorTask(header, body, file);
          if (!task) { drafts++; continue; }
          if (task.partial) partialCount++;
          this.store.upsert(finalize(task)); parsedCount++;
        }
      } catch { errors++; }
      finally { db?.close(); }
      await yieldThread();
    }
    source.locations = files; source.syncAt = Date.now();
    source.state = errors === files.length ? 'error' : partialCount || errors || !parsedCount ? 'partial' : 'ready';
    source.message = errors === files.length ? '数据库暂不可读，将自动重试' : `发现 ${headersCount} 个会话头；${parsedCount} 个可导入，${partialCount} 个缺少完整正文，${drafts} 个空草稿已排除${errors ? `，${errors} 个数据库暂不可读` : ''}。当前适配本机 SQLite 结构；未覆盖的正文不会补写。`;
  }
  async scan() {
    if (this.busy || this.stopped) { this.dirty = true; return; } this.busy = true; this.dirty = false;
    try {
      await this.codexIndex(); const files = [];
      for (const [provider, roots] of [['codex', [path.join(this.config.codex, 'sessions'), path.join(this.config.codex, 'archived_sessions')]], ['claude', [path.join(this.config.claude, 'projects')]]]) {
        for (const root of roots) for await (const file of walk(root, '.jsonl')) {
          try { const stats = await stat(file); files.push({ file, provider, stats }); } catch { /* Concurrent rotation: retry next cycle. */ }
        }
      }
      // Use recorded update timestamps when available, then mtime. Newest tasks become usable first.
      files.sort((a, b) => (this.codexMeta.get(b.file)?.updatedAt || b.stats.mtimeMs) - (this.codexMeta.get(a.file)?.updatedAt || a.stats.mtimeMs));
      this.progress = { active: true, completed: 0, total: files.length }; this.notify();
      const errors = { codex: 0, claude: 0 }; const partial = { codex: 0, claude: 0 };
      let changed = 0;
      for (const item of files) {
        if (this.stopped) break;
        const subagent = item.provider === 'claude' && item.file.split(path.sep).includes('subagents');
        const meta = this.codexMeta.get(item.file) || { archived: item.file.includes('archived_sessions'), surface: subagent ? '子代理' : item.provider === 'claude' ? 'CLI' : '未知入口', ...(subagent ? { subagentId: path.basename(item.file, '.jsonl') } : {}) };
        try {
          const previous = this.store.checkpoint(item.file);
          const result = await readLog(item.file, item.provider, previous, meta);
          if (!result.unchanged) {
            this.store.db.exec('BEGIN');
            try {
              const sameSource = this.store.get(result.task.id)?.evidence.path === item.file;
              this.store.upsert(result.task, result.reset && sameSource);
              this.store.saveCheckpoint(item.file, result.stats, result.offset, result.line, result.task);
              this.store.db.exec('COMMIT');
            } catch (e) { this.store.db.exec('ROLLBACK'); throw e; }
            changed++;
          }
          if (result.task.partial || result.unfinished) partial[item.provider]++;
        } catch { errors[item.provider]++; }
        this.progress.completed++;
        if (changed && changed % 8 === 0) this.notify();
        await yieldThread();
      }
      for (const id of ['codex', 'claude']) {
        const source = this.source(id); const count = files.filter(file => file.provider === id).length;
        source.state = !count ? 'missing' : errors[id] === count ? 'error' : errors[id] || partial[id] ? 'partial' : 'ready';
        source.message = !count ? '未找到可扫描的会话日志；已保留现有索引' : `已检查 ${count} 份日志${errors[id] ? `，${errors[id]} 份暂不可读` : ''}${partial[id] ? `，${partial[id]} 份记录不完整` : ''}。回复结束与整体完成分别记录；原始文件只读。`;
        source.syncAt = Date.now();
      }
      await this.cursorIndex();
    } finally { this.progress.active = false; this.busy = false; this.notify(); }
  }
  async start() {
    for (const root of [path.join(this.config.codex, 'sessions'), path.join(this.config.codex, 'archived_sessions'), path.join(this.config.claude, 'projects')]) {
      try { const watcher = watch(root, { recursive: true }, () => { this.dirty = true; }); watcher.on('error', () => { this.dirty = true; }); this.watchers.push(watcher); } catch { /* Polling also handles roots created after startup. */ }
    }
    this.timer = setInterval(() => { void this.scan().catch(() => { this.notify(); }); }, 3000);
    await this.scan();
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.watchers.forEach(w => w.close()); }
}
