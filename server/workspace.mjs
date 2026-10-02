import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dayStart, digest, decode } from './store.mjs';

export function period(kind, date) {
  if (!['daily', 'weekly'].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('报告日期或类型无效');
  let start = Date.parse(date + 'T00:00:00+08:00');
  if (!Number.isFinite(start) || new Date(start + 28800000).toISOString().slice(0, 10) !== date) throw new Error('日期无效');
  if (kind === 'weekly') start -= ((new Date(start + 28800000).getUTCDay() + 6) % 7) * 86400000;
  return { start, end: start + (kind === 'daily' ? 1 : 7) * 86400000, date: new Date(start + 28800000).toISOString().slice(0, 10) };
}
export async function generateReport(store, { kind = 'daily', date, project = '', provider = '' }) {
  const range = period(kind, date); const id = 'report-' + digest(JSON.stringify([kind, range.date, project, provider])).slice(0, 32);
  const [count] = await store.rows('SELECT COUNT(*) n FROM ad_events WHERE timestamp>=? AND timestamp<?', [range.start, range.end]);
  if (Number(count.n) > 100000) throw new Error('活动超过单次报告上限，请缩小日期范围');
  const events = await store.events({ ...range, project, provider, limit: 100000 });
  const ids = new Set(events.map(e => e.taskId));
  const completed = await store.rows("SELECT task_id FROM ad_annotations WHERE JSON_UNQUOTE(JSON_EXTRACT(value,'$.manualStatus'))='done' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(value,'$.confirmedAt')) AS UNSIGNED)>=? AND CAST(JSON_UNQUOTE(JSON_EXTRACT(value,'$.confirmedAt')) AS UNSIGNED)<?", [range.start, range.end]);
  completed.forEach(row => ids.add(row.task_id));
  const items = [];
  for (const taskId of ids) {
    const task = await store.get(taskId); if (!task || (project && project !== task.projectId) || (provider && provider !== task.provider)) continue;
    const activity = events.filter(e => e.taskId === taskId); const last = [...activity].reverse().find(e => e.kind === 'assistant');
    items.push({ taskId, title: task.title, projectName: task.projectName, provider: task.provider, summary: last?.text || activity.find(e => e.kind === 'user')?.text || '本期用户确认完成', evidence: last?.evidence || activity[0]?.evidence || task.evidence, confirmed: completed.some(r => r.task_id === taskId), reported: task.completion === 'reported_complete' && task.updatedAt >= range.start && task.updatedAt < range.end, blocked: task.completion === 'blocked', todos: task.todos, activityCount: activity.length });
  }
  const facts = { items, activityCount: events.length, confirmed: items.filter(i => i.confirmed).length, reported: items.filter(i => i.reported).length, blocked: items.filter(i => i.blocked).length };
  const factsDigest = digest(JSON.stringify(facts));
  return store.transaction(async tx => {
    const existing = await tx.document(id, 'report');
    if (existing?.factsDigest === factsDigest) return existing;
    return tx.putDocument('report', { id, title: `${range.date} ${kind === 'daily' ? '日报' : '周报'}`, kind, ...range, project, provider, facts, factsDigest, userText: existing?.userText || '', versions: existing?.versions || [], generatedAt: Date.now() });
  });
}
export function reportMarkdown(report) {
  return `# ${report.title}\n\n时区：Asia/Shanghai\n\n${report.facts.activityCount} 条本期活动 · ${report.facts.confirmed} 项用户确认完成 · ${report.facts.reported} 项来源报告完成\n\n## 进展与依据\n\n${report.facts.items.map(i => `### ${i.title}\n\n${i.summary}\n\n来源：${i.provider} / ${i.projectName} · ${i.evidence.path}:${i.evidence.line || ''}${i.evidence.locator ? ' · ' + i.evidence.locator : ''}\n\n状态：${i.confirmed ? '用户确认完成' : i.reported ? '来源报告完成，待验证' : '未确认完成'}\n\n当前待办快照：\n${i.todos.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.text}`).join('\n') || '无结构化待办'}\n`).join('\n') || '本期无可解析活动。'}\n\n## 我的补充\n\n${report.userText || '无'}\n\n${report.versions.map(v => `## AI 分析 · ${v.model}\n\n${v.text}\n\n生成时间：${new Date(v.createdAt).toISOString()}`).join('\n\n')}`;
}
export async function refreshReports(store, history = false) {
  const dateFor = timestamp => new Date(timestamp + 28800000).toISOString().slice(0, 10);
  for (let i = 0; i < (history ? 30 : 1); i++) { const date = dateFor(dayStart() - i * 86400000); await generateReport(store, { date }); if (history && i % 7 === 0) await generateReport(store, { date, kind: 'weekly' }); }
  await generateReport(store, { date: dateFor(Date.now()), kind: 'weekly' });
}
export function validateSchedule(input) {
  let start = Number(input.start), end = Number(input.end);
  if (!String(input.title || '').trim() || String(input.title).length > 200 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || ![0, 5, 15, 30, 60, 1440].includes(Number(input.reminderMinutes ?? 15))) throw new Error('请填写标题、有效起止时间与提醒时间');
  if(input.allDay){start=dayStart(start);end=dayStart(end)+(end===dayStart(end)?0:86400000);}
  return { id: input.id || randomUUID(), title: input.title.trim(), note: String(input.note || '').slice(0, 16000), start, end, allDay: Boolean(input.allDay), projectId: String(input.projectId || ''), taskId: String(input.taskId || ''), done: Boolean(input.done), reminderMinutes: Number(input.reminderMinutes ?? 15), notifiedAt: input.notifiedAt || null };
}
export async function migrateLegacy(store, file) {
  if (!existsSync(file)) throw new Error('未找到旧 SQLite 索引');
  const source = new DatabaseSync(file, { readOnly: true }); source.exec('PRAGMA query_only=ON;');
  const status = await store.document('legacy-migration', 'migration') || { id: 'legacy-migration', title: 'SQLite 迁移', tasks: 0, annotations: 0, checkpoints: 0 };
  try {
    for (const row of source.prepare('SELECT * FROM tasks').all()) await store.transaction(async tx => { if (!await tx.get(row.id)) await tx.upsert(decode(row.record)); });
    for (const row of source.prepare('SELECT * FROM annotations').all()) await store.rows('INSERT IGNORE INTO ad_annotations VALUES(?,?,?)', [row.task_id, row.value, row.updated_at]);
    // Parser-version bump forces full activity backfill, preserving stable task identities.
    for (const row of source.prepare('SELECT * FROM checkpoints').all()) {
      if (await store.checkpoint(row.path)) continue;
      await store.saveCheckpoint(row.path, { size: row.size, mtimeMs: row.mtime }, row.offset, row.line, decode(row.state));
    }
    for (const table of ['tasks', 'annotations', 'checkpoints']) status[table] = Number(source.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
    status.completedAt = Date.now(); return store.putDocument('migration', status);
  } finally { source.close(); }
}
export async function buildContext(store, refs, range = {}) {
  if (!Array.isArray(refs) || !refs.length || refs.length > 40) throw new Error('请选择 1 至 40 项上下文');
  if(range.start!==undefined&&range.end!==undefined&&range.end<=range.start)throw new Error('上下文日期范围无效');
  const sources = [], parts = [];
  for (const ref of refs) {
    if (!['task', 'project', 'report', 'schedule'].includes(ref.type) || typeof ref.id !== 'string') throw new Error('上下文对象无效');
    let text = '', title = '', evidence = null;
    if (ref.type === 'task') {
      const t = await store.get(ref.id); if (!t) throw new Error('所选会话不存在');
      const branch = ref.branchId ? t.branches?.find(b => b.id === ref.branchId) : t.branches?.find(b => b.id === t.annotation.branchId);
      if(ref.branchId&&!branch)throw new Error('所选分支不存在');title = t.title; evidence = branch?.summaryEvidence||t.summaryEvidence||t.evidence;
      text = JSON.stringify({ title, goal: branch?.goal || t.goal, summary: t.annotation.summaryOverride || branch?.summary || t.summary, completion: t.completion, todos: t.todos, note: t.annotation.note });
      if (ref.includeTranscript) { const [count] = await store.rows('SELECT COUNT(*) n FROM ad_events WHERE task_id=? AND timestamp>=? AND timestamp<?',[t.id,range.start??Date.now()-30*86400000,range.end??Date.now()+1]);if(!branch&&Number(count.n)>100000)throw new Error('正文记录过多，请缩小日期范围');const events = branch?.events || await store.events({ task: t.id, start: range.start ?? Date.now() - 30 * 86400000, end: range.end ?? Date.now() + 1, limit: 100000 }); text += '\n正文：\n' + events.filter(e => ['user', 'assistant'].includes(e.kind)&&e.timestamp>=(range.start??Date.now()-30*86400000)&&e.timestamp<(range.end??Date.now()+1)).map(e => `${e.kind}: ${e.text}`).join('\n'); }
    }
    if (ref.type === 'project') {
      const tasks = await store.rows('SELECT t.id FROM ad_tasks t WHERE project_id=? AND (EXISTS(SELECT 1 FROM ad_events e WHERE e.task_id=t.id AND e.timestamp>=? AND e.timestamp<?) OR (t.updated_at>=? AND t.updated_at<?)) ORDER BY t.updated_at DESC', [ref.id, range.start ?? Date.now() - 30 * 86400000, range.end ?? Date.now() + 1, range.start ?? Date.now() - 30 * 86400000, range.end ?? Date.now() + 1]);
      if (!tasks.length) throw new Error('该项目在指定范围内没有记录');
      const texts = []; for (const row of tasks) { const t = await store.get(row.id); title = t.projectName; const [reply]=await store.rows("SELECT record FROM ad_events WHERE task_id=? AND timestamp>=? AND timestamp<? AND JSON_UNQUOTE(JSON_EXTRACT(record,'$.kind'))='assistant' ORDER BY timestamp DESC LIMIT 1",[t.id,range.start??Date.now()-30*86400000,range.end??Date.now()+1]); const summary=reply?decode(reply.record).text:'本期无可解析回复';texts.push(JSON.stringify({ id: t.id, title: t.title, summary, userSummary: t.annotation.summaryOverride, completion: t.completion, todos: t.todos, note: t.annotation.note })); }
      text = texts.join('\n');
    }
    if (ref.type === 'report' || ref.type === 'schedule') { const d = await store.document(ref.id, ref.type); if (!d) throw new Error('所选对象不存在'); title = d.title; text = ref.type === 'report' ? reportMarkdown(d) : JSON.stringify({ title, note: d.note, start: d.start, end: d.end, done: d.done }); }
    const number = sources.length + 1; sources.push({ ...ref, number, title, evidence }); parts.push(`[${number}] ${title}\n${text}`);
  }
  const text = parts.join('\n\n'); if (text.length > 48000) throw new Error('上下文超过 48000 字符，请缩小范围或取消正文');
  return { id: randomUUID(), sources, text, characters: text.length, estimatedTokens: Math.ceil(text.length / 2), createdAt: Date.now(), expiresAt: Date.now() + 15 * 60000 };
}
