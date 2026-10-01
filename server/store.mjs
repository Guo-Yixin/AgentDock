import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const defaultAnnotation = { note: '', summaryOverride: null, manualStatus: null, goalGroup: '', pinned: false };
export function openStore(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, provider TEXT NOT NULL, native_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL, UNIQUE(provider,native_id));
    CREATE INDEX IF NOT EXISTS task_recency ON tasks(updated_at DESC);
    CREATE INDEX IF NOT EXISTS task_project ON tasks(project_id);
    CREATE TABLE IF NOT EXISTS annotations (task_id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, offset INTEGER NOT NULL, line INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS task_search USING fts5(task_id UNINDEXED, content, tokenize='trigram');
    PRAGMA user_version=1;`);
  return new Store(db);
}
export class Store {
  constructor(db) { this.db = db; }
  upsert(task, force = false) {
    const current = this.db.prepare('SELECT updated_at,record FROM tasks WHERE id=?').get(task.id);
    if (!force && current && current.updated_at > task.updatedAt) return false;
    this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,created_at=excluded.created_at,updated_at=excluded.updated_at,record=excluded.record').run(task.id, task.provider, task.nativeId, task.projectId, task.createdAt, task.updatedAt, JSON.stringify(task));
    this.db.prepare('DELETE FROM task_search WHERE task_id=?').run(task.id);
    this.db.prepare('INSERT INTO task_search(task_id,content) VALUES(?,?)').run(task.id, `${task.title} ${task.goal} ${task.summary} ${task.projectName} ${task.cwd}`);
    return true;
  }
  hydrate(row, detail = false) {
    if (!row) return null;
    const task = JSON.parse(row.record); const annotation = { ...defaultAnnotation, ...JSON.parse(row.annotation || '{}') };
    task.annotation = annotation; task.completion = annotation.manualStatus || task.completion;
    if (!detail) delete task.events;
    return task;
  }
  get(id) { return this.hydrate(this.db.prepare('SELECT t.*,a.value AS annotation FROM tasks t LEFT JOIN annotations a ON a.task_id=t.id WHERE t.id=?').get(id), true); }
  all(detail = false) { return this.db.prepare('SELECT t.*,a.value AS annotation FROM tasks t LEFT JOIN annotations a ON a.task_id=t.id ORDER BY t.updated_at DESC').all().map(row => this.hydrate(row, detail)); }
  list({ q = '', provider = '', project = '', status = '', page = 1, recent = false } = {}) {
    const words = q.trim().toLocaleLowerCase(); const cutoff = Date.now() - 30 * 86400000;
    // Literal substring search supports short Chinese terms and punctuation without exposing FTS operators.
    const matches = this.all().filter(task => (!provider || task.provider === provider) && (!project || task.projectId === project) && (!status || task.completion === status) && (!recent || task.updatedAt >= cutoff) && (!words || `${task.title} ${task.goal} ${task.summary} ${task.annotation.summaryOverride || ''} ${task.annotation.note} ${task.annotation.goalGroup} ${task.cwd}`.toLocaleLowerCase().includes(words)));
    return { tasks: matches.slice((page - 1) * 30, page * 30), total: matches.length, page, pageSize: 30 };
  }
  patch(id, patch) {
    const task = this.get(id); if (!task) return null;
    const annotation = { ...task.annotation, ...patch };
    if (patch.manualStatus === 'done' && task.annotation.manualStatus !== 'done') annotation.confirmedAt = Date.now();
    else if ('manualStatus' in patch && patch.manualStatus !== 'done') annotation.confirmedAt = null;
    this.db.prepare('INSERT INTO annotations VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(id, JSON.stringify(annotation), Date.now());
    return this.get(id);
  }
  checkpoint(file) { const row = this.db.prepare('SELECT * FROM checkpoints WHERE path=?').get(file); return row ? { ...row, task: JSON.parse(row.state) } : null; }
  saveCheckpoint(file, stat, offset, line, task) { this.db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?,?,?)').run(file, stat.size, stat.mtimeMs, offset, line, JSON.stringify(task)); }
  overview(sources, progress) {
    const tasks = this.all(true); const todayStart = dayStart(); const projects = new Map(); const hourly = Array(24).fill(0);
    for (const task of tasks) {
      const project = projects.get(task.projectId) || { id: task.projectId, name: task.projectName, root: task.projectRoot || task.cwd, count: 0, updatedAt: 0, providers: [] };
      project.count++; project.updatedAt = Math.max(project.updatedAt, task.updatedAt); if (!project.providers.includes(task.provider)) project.providers.push(task.provider); projects.set(project.id, project);
      for (const event of task.events || []) if (event.timestamp >= todayStart && event.timestamp < todayStart + 86400000) hourly[Math.floor((event.timestamp - todayStart) / 3600000)]++;
    }
    const completedToday = new Set(this.db.prepare('SELECT task_id,value FROM annotations').all().filter(row => { const value = JSON.parse(row.value); return value.manualStatus === 'done' && value.confirmedAt >= todayStart; }).map(row => row.task_id));
    return { total: tasks.length, recent: tasks.filter(t => t.updatedAt >= Date.now() - 30 * 86400000).length, needsAttention: tasks.filter(t => ['blocked', 'unconfirmed'].includes(t.completion)).length, today: tasks.filter(t => t.updatedAt >= todayStart).length, doneToday: completedToday.size, projects: [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt), sources: sources.map(source => ({ ...source, count: tasks.filter(t => t.provider === source.id).length })), hourly, importing: progress.active, importProgress: { completed: progress.completed, total: progress.total }, updatedAt: Date.now() };
  }
  export(id) {
    const tasks = id ? [this.get(id)].filter(Boolean) : this.all().filter(t => t.updatedAt >= dayStart());
    if (id && !tasks.length) return null;
    const labels = { unconfirmed: '待确认', reported_complete: '已报告完成（来源陈述）', done: '用户已确认完成', blocked: '需处理', in_progress: '进行中' };
    return `# AgentDock · ${id ? '任务' : '今日'}摘要\n\n导出时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（UTC+8）\n\n摘要来自本机记录，不自动构成实现或验证结果。\n\n${tasks.map(task => `## ${task.title}\n\n- 来源：${task.provider} / ${task.surface}\n- 项目：${task.projectName}\n- 状态：${labels[task.completion]}\n- 原始会话：${task.nativeId}\n- 依据：${task.evidence.path}${task.evidence.line ? ':' + task.evidence.line : ''}${task.evidence.locator ? ' · ' + task.evidence.locator : ''}\n\n### 目标\n\n${task.goal || '暂无目标'}\n\n### 摘要${task.annotation.summaryOverride ? '（用户编辑）' : '（原始记录提取）'}\n\n${task.annotation.summaryOverride || task.summary || '暂无可提取摘要'}\n\n${task.summaryEvidence ? `摘要依据：${task.summaryEvidence.path}${task.summaryEvidence.line ? ':' + task.summaryEvidence.line : ''}\n\n` : ''}### 待办\n\n${task.todos.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.text}`).join('\n') || '无结构化待办'}\n\n### 关联目标\n\n${task.annotation.goalGroup || '未关联'}\n\n### 我的备注\n\n${task.annotation.note || '无'}\n`).join('\n---\n\n')}`;
  }
  close() { this.db.close(); }
}
export function dayStart(now = Date.now()) { const offset = 8 * 3600000; return Math.floor((now + offset) / 86400000) * 86400000 - offset; }
