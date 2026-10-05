import type { Annotation, Overview, Task, TaskPage } from './types';
const now = Date.now();
const annotation: Annotation = { note: '', summaryOverride: null, manualStatus: null, goalGroup: '', pinned: false };
const demoTasks: Task[] = [
  ['codex', '实现跨工具任务索引', 'agentdock', 'responded', 'unconfirmed', '已提交索引实现与测试结果。原始回复声称实现完成，整体任务仍待确认。'],
  ['claude', '等待确认数据库迁移方案', 'folio', 'responded', 'blocked', '已比较两种迁移路径，需要确定兼容策略后继续。'],
  ['cursor', '完善任务详情与来源时间线', 'agentdock', 'responded', 'done', '详情面板已实现；演示中的完成状态由用户标记。'],
  ['codex', '检查增量采集边界', 'deer-flow', 'recent', 'in_progress', '正在检查文件轮换、半行 JSON 和中断恢复。'],
  ['claude', '补充导入错误提示', 'agentdock', 'responded', 'unconfirmed', '已整理错误场景及处理建议，等待验证。'],
  ['cursor', '优化导航与键盘交互', 'folio', 'unknown', 'unconfirmed', '暂无可提取的最终回复。'],
].map((row, i) => ({ id: `demo-${i}`, nativeId: `example-${i}`, provider: row[0] as Task['provider'], surface: row[0] === 'codex' ? '桌面' : row[0] === 'claude' ? 'CLI' : '编辑器', title: row[1], goal: row[1], projectId: row[2], projectName: row[2], cwd: `B:\\projects\\${row[2]}`, createdAt: now - (i + 2) * 3600000, updatedAt: now - (i + 1) * 180000, activity: row[3] as Task['activity'], completion: row[4] as Task['completion'], summary: row[5], summaryEvidence: { path: '演示记录', line: 8 }, todos: [{ text: '完成实现', status: 'completed' }, { text: '核对原始记录与页面状态', status: 'pending' }], archived: i === 5, partial: i === 5, evidence: { path: '演示记录', line: 1 }, annotation: { ...annotation, manualStatus: row[4] === 'done' ? 'done' : null }, events: [{ timestamp: now - 3600000, kind: 'user', text: row[1], evidence: { path: '演示记录', line: 2 } }, { timestamp: now - 180000, kind: 'assistant', text: row[5], evidence: { path: '演示记录', line: 8 } }] }));
export function demoOverview(): Overview {
  const projects = ['agentdock', 'folio', 'deer-flow'].map(name => ({ id: name, name, root: `B:\\projects\\${name}`, count: demoTasks.filter(t => t.projectId === name).length, updatedAt: now, providers: [...new Set(demoTasks.filter(t => t.projectId === name).map(t => t.provider))] }));
  return { total: demoTasks.length, recent: 6, needsAttention: demoTasks.filter(t=>t.completion==='blocked'||t.annotation.needsReview).length, today: 6, doneToday: 1, projects, sources: [{ id: 'codex', name: 'Codex', state: 'ready', count: 2, syncAt: now, message: '演示来源，非本机记录', locations: ['演示记录'] }, { id: 'claude', name: 'Claude Code', state: 'ready', count: 2, syncAt: now, message: '演示来源，非本机记录', locations: ['演示记录'] }, { id: 'cursor', name: 'Cursor', state: 'partial', count: 2, syncAt: now, message: '演示部分接入状态', locations: ['演示记录'] }, { id: 'pi', name: 'Pi CLI', state: 'planned', count: 0, syncAt: null, message: '第二阶段接入', locations: [] }, { id: 'deepseek', name: 'DeepSeek Harness', state: 'planned', count: 0, syncAt: null, message: '待核实记录来源', locations: [] }, { id: 'workbuddy', name: 'WorkBuddy', state: 'planned', count: 0, syncAt: null, message: '待核实记录来源', locations: [] }], hourly: [0, 0, 0, 0, 1, 0, 1, 2, 0, 1, 2, 3, 1, 0, 2, 1, 3, 2, 1, 0, 0, 0, 0, 0], importing: false, importProgress: { completed: 6, total: 6 }, updatedAt: now };
}
export function demoPage(q: string, provider: string, project: string, status: string, page: number,pinned=false): TaskPage {
  const tasks = demoTasks.filter(t => (!pinned||t.annotation.pinned)&& (!q || `${t.title} ${t.summary}`.includes(q)) && (!provider || t.provider === provider) && (!project || t.projectId === project) && (!status || t.completion === status));
  return { tasks: tasks.slice((page - 1) * 30, page * 30), total: tasks.length, page, pageSize: 30 };
}
export function demoDetail(id: string) { return structuredClone(demoTasks.find(t => t.id === id)!); }
export function demoPatch(id: string, patch: Partial<Annotation>) {
  const task = demoTasks.find(t => t.id === id)!;
  task.annotation = { ...task.annotation, ...patch };
  if (patch.manualStatus) task.completion = patch.manualStatus;
  return structuredClone(task);
}
