import { randomUUID } from 'node:crypto';
import { decode } from './store.mjs';

// Guided procedures only; no IDE execution or automatic model calls.
export const templates = [
  { id: 'delivery', title: '跨工具交付', description: '对齐目标、归纳方案、验证结果，再沉淀可复用经验。', steps: ['对齐目标与依据', '整理方案与分工', '核对验证与风险', '交付复盘与记忆'] },
  { id: 'unblock', title: '阻塞诊断', description: '从会话证据识别阻塞，记录下一步和回访结论。', steps: ['收集阻塞证据', '提出可验证假设', '记录验证结果', '沉淀避坑经验'] },
  { id: 'review', title: '每周复盘', description: '结合报告和旧记忆，找出进展、重复问题和下一周行动。', steps: ['回顾本周事实', '对照已有经验', '制定下一周行动', '更新长期记忆'] },
];
const states = { memory: ['draft', 'verified', 'archived'], workflow: ['active', 'completed', 'archived'] };
const fail = message => { throw new Error(message); };
export async function validateRefs(store, refs = []) {
  if (!Array.isArray(refs) || refs.length > 20) fail('最多关联 20 个来源');
  const result = [], seen = new Set();
  for (const ref of refs) {
    if (!ref || typeof ref.id !== 'string' || !ref.id || ref.id.length > 128 || !['task','project','report','schedule','goal','memory','workflow'].includes(ref.type)) fail('来源引用无效');
    const key = ref.type + ':' + ref.id; if (seen.has(key)) continue; seen.add(key);
    let item;
    if (ref.type === 'task') { const t = await store.get(ref.id); if (t) item = { title: t.title, evidence: t.summaryEvidence || t.evidence }; }
    else if (ref.type === 'project') { const [p] = await store.rows("SELECT JSON_UNQUOTE(JSON_EXTRACT(record,'$.projectName')) title FROM ad_tasks WHERE project_id=? LIMIT 1", [ref.id]); item = p; }
    else if (ref.type === 'goal') { const [g] = await store.rows('SELECT title FROM ad_goals WHERE id=?', [ref.id]); item = g; }
    else { const d = await store.document(ref.id, ref.type); if (d) item = { title: d.title }; }
    if (!item) fail('关联来源不存在，请重新选择');
    result.push({ type: ref.type, id: ref.id, title: item.title, ...(item.evidence ? { evidence: item.evidence } : {}) });
  }
  return result;
}
export async function studioList(store, { kind, q = '', status = '', project = '', due = false, page = 1, pageSize=30 } = {}) {
  if (!states[kind]) fail('对象类型无效');
  const clauses = ['kind=?'], params = [kind];
  if (status) { if (!states[kind].includes(status)) fail('状态无效'); clauses.push("JSON_UNQUOTE(JSON_EXTRACT(record,'$.status'))=?"); params.push(status); }
  else clauses.push("JSON_UNQUOTE(JSON_EXTRACT(record,'$.status'))<>'archived'");
  if (q.trim()) { clauses.push("LOCATE(CONVERT(? USING utf8mb4) COLLATE utf8mb4_0900_ai_ci,CAST(record AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_0900_ai_ci)>0"); params.push(q.trim().slice(0,200)); }
  if (project) { clauses.push("JSON_UNQUOTE(JSON_EXTRACT(record,'$.projectId'))=?"); params.push(project); }
  if (due) { clauses.push("JSON_UNQUOTE(JSON_EXTRACT(record,'$.status'))='verified' AND CAST(JSON_UNQUOTE(JSON_EXTRACT(record,'$.reviewAt')) AS UNSIGNED)<=?"); params.push(Date.now()); }
  const where = clauses.join(' AND '), safePage = Math.max(1, Math.min(100000, Math.floor(Number(page) || 1)));
  const [count] = await store.rows(`SELECT COUNT(*) total FROM ad_documents WHERE ${where}`, params);
  const size=Math.min(30,Math.max(1,Math.floor(Number(pageSize)||30)));
  const rows = await store.rows(`SELECT record FROM ad_documents WHERE ${where} ORDER BY updated_at DESC,id LIMIT ${size} OFFSET ${(safePage-1)*size}`, params);
  return { items: rows.map(r => decode(r.record)), total: Number(count.total), page: safePage };
}
export async function studioGet(store, { kind, id }) { if (!states[kind]) fail('对象类型无效'); return store.document(id, kind); }
export async function memoryPut(store, input) {
  return store.transaction(async tx => {
    const old = input.id ? await tx.document(input.id, 'memory') : null;
    if (input.id && !old) fail('记忆不存在');
    if (old && input.version !== old.version) fail('记忆已更新，请重新载入后编辑');
    const title = String(input.title || '').trim(), text = String(input.text || '').trim();
    if (!title || title.length > 200 || !text || text.length > 16000) fail('请填写标题和内容，内容最多 16000 字符');
    if (!['decision','pattern','pitfall','preference'].includes(input.category) || !states.memory.includes(input.status)) fail('记忆类别或状态无效');
    const tags = [...new Set((input.tags || []).map(t => String(t).trim()).filter(Boolean))];
    if (tags.length > 8 || tags.some(t => t.length > 30)) fail('最多 8 个标签，每个最多 30 字符');
    if (input.projectId) await validateRefs(tx, [{type:'project',id:input.projectId}]);
    const refs = await validateRefs(tx, input.refs); if (input.id && refs.some(r => r.type === 'memory' && r.id === input.id)) fail('记忆不能关联自身');
    const now = Date.now();
    return tx.putDocument('memory', { id: old?.id || randomUUID(), title, text, category: input.category, tags, status: input.status, projectId: input.projectId || '', refs, createdAt: old?.createdAt || now, version: (old?.version || 0) + 1, reviewedAt: old?.reviewedAt || null, reviewCount: old?.reviewCount || 0, reviewAt: input.status === 'verified' ? old?.reviewAt || now + 7*86400000 : null });
  });
}
export async function memoryReview(store, { id, version, days = 7 }) {
  if (![1,7,30].includes(days)) fail('复查间隔无效');
  return store.transaction(async tx => {
    const m = await tx.document(id, 'memory'); if (!m || m.status !== 'verified') fail('仅已确认记忆可以复查');
    if (m.version !== version) fail('记忆已更新，请重新载入');
    return tx.putDocument('memory', {...m, version: m.version + 1, reviewedAt: Date.now(), reviewAt: Date.now() + days*86400000, reviewCount: m.reviewCount + 1 });
  });
}
export async function workflowPut(store, input) {
  const template = templates.find(t => t.id === input.templateId); if (!template) fail('工作流模板不存在');
  const title = String(input.title || template.title).trim(); if (!title || title.length > 200) fail('工作流标题无效');
  return store.transaction(async tx => {
    const refs = await validateRefs(tx, input.refs);
    if (input.projectId) await validateRefs(tx, [{type:'project',id:input.projectId}]);
    return tx.putDocument('workflow', {id:randomUUID(),title,templateId:template.id,templateVersion:1,projectId:input.projectId||'',refs,status:'active',version:1,createdAt:Date.now(),steps:template.steps.map(title=>({title,note:'',completedAt:null}))});
  });
}
export async function workflowStep(store, {id, version, step, note, archive = false}) {
  return store.transaction(async tx => {
    const run = await tx.document(id, 'workflow'); if (!run) fail('工作流不存在');
    if (run.version !== version) fail('工作流已更新，请重新载入');
    if (run.status !== 'active') fail('该工作流已结束');
    if (archive) return tx.putDocument('workflow', {...run,status:'archived',version:run.version+1});
    const current = run.steps.findIndex(s => !s.completedAt);
    if (step !== current) fail('请按顺序确认当前步骤');
    const text = String(note || '').trim(); if (!text || text.length > 16000) fail('请记录本步结论或验证结果，最多 16000 字符');
    run.steps[step] = {...run.steps[step],note:text,completedAt:Date.now()};
    return tx.putDocument('workflow', {...run,status:run.steps.every(s=>s.completedAt)?'completed':'active',version:run.version+1});
  });
}
