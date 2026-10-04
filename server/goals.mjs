import { randomUUID, createHash } from 'node:crypto';
export const goalStates = ['not_started', 'in_progress', 'blocked', 'done', 'archived'];
export async function goalList(store, {project='', status='', q='', attention=false, page=1}={}) {
 const clauses=['1=1'], params=[];
 for(const [v,k] of [[project,'project_id'],[status,'status']])if(v){clauses.push(`${k}=?`);params.push(v);}
 if(q){clauses.push('LOCATE(?,title)>0');params.push(q);}
 if(attention===true||attention==='true')clauses.push("(status='blocked' OR needs_review=1)");const where=clauses.join(' AND '), safe=Math.max(1,Math.floor(Number(page)||1));
 const [count]=await store.rows(`SELECT COUNT(*) total FROM ad_goals WHERE ${where}`,params);
 const goals=await store.rows(`SELECT g.*, (SELECT COUNT(*) FROM ad_goal_sessions l WHERE l.goal_id=g.id) sessionCount FROM ad_goals g WHERE ${where} ORDER BY updated_at DESC LIMIT 30 OFFSET ${(safe-1)*30}`,params);
 return {goals:goals.map(decodeGoal),total:Number(count.total),page:safe};
}
function decodeGoal(r){return r?{id:r.id,title:r.title,projectId:r.project_id,description:r.description,note:r.note,status:r.status,confirmedAt:r.confirmed_at?Number(r.confirmed_at):null,updatedAt:Number(r.updated_at),needsReview:Boolean(r.needs_review),sessionCount:Number(r.sessionCount||0)}:null;}
export async function goalGet(store,id){const [row]=await store.rows('SELECT * FROM ad_goals WHERE id=?',[id]);if(!row)return null;const links=await store.rows('SELECT task_id FROM ad_goal_sessions WHERE goal_id=? ORDER BY linked_at',[id]);return {...decodeGoal(row),sessions:(await Promise.all(links.map(l=>store.get(l.task_id)))).filter(Boolean)};}
export async function goalPut(store,input){return store.transaction(async tx=>{
 if(input.id)await tx.rows('SELECT id FROM ad_goals WHERE id=? FOR UPDATE',[input.id]);const old=input.id?await goalGet(tx,input.id):null;if(input.id&&!old)throw new Error('目标不存在');
 const item=tx.scrub({...old,...input,id:old?.id||randomUUID()});item.status||='not_started';item.projectId||='unassigned';
 if(!item.title?.trim()||item.title.length>200||!goalStates.includes(item.status))throw new Error('请填写目标标题与有效状态');
 if(item.projectId!=='unassigned'){const [p]=await tx.rows('SELECT COUNT(*) n FROM ad_tasks WHERE project_id=?',[item.projectId]);if(!Number(p.n))throw new Error('项目不存在');}
 if(old?.sessions.some(t=>t.projectId!==item.projectId))throw new Error('请先解除其他项目会话的关联');
 const confirmed=item.status==='done'?(old?.status==='done'?old.confirmedAt:Date.now()):null;
 await tx.rows('INSERT INTO ad_goals VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),project_id=VALUES(project_id),description=VALUES(description),note=VALUES(note),status=VALUES(status),confirmed_at=VALUES(confirmed_at),updated_at=VALUES(updated_at),needs_review=VALUES(needs_review)',[item.id,item.title.trim(),item.projectId,String(item.description||'').slice(0,16000),String(item.note||'').slice(0,16000),item.status,confirmed,Date.now(),Boolean(item.needsReview),Date.now()]);return goalGet(tx,item.id);
 });}
export async function goalLink(store,{id,taskId,remove=false}){return store.transaction(async tx=>{
 await tx.rows('SELECT id FROM ad_goals WHERE id=? FOR UPDATE',[id]);const g=await goalGet(tx,id),t=await tx.get(taskId);if(!g||!t)throw new Error('目标或会话不存在');if(g.projectId!==t.projectId)throw new Error('只能关联同项目会话');
 if(remove)await tx.rows('DELETE FROM ad_goal_sessions WHERE goal_id=? AND task_id=?',[id,taskId]);else await tx.rows('INSERT IGNORE INTO ad_goal_sessions VALUES(?,?,?)',[id,taskId,Date.now()]);await tx.rows('UPDATE ad_goals SET updated_at=? WHERE id=?',[Date.now(),id]);return goalGet(tx,id);
 });}
export async function goalDelete(store,id){return store.transaction(async tx=>{await tx.rows('DELETE FROM ad_goal_sessions WHERE goal_id=?',[id]);await tx.rows('DELETE FROM ad_goals WHERE id=?',[id]);return {ok:true};});}
export async function migrateGoalGroups(store){
 const rows=await store.rows("SELECT t.id,t.project_id,JSON_UNQUOTE(JSON_EXTRACT(a.value,'$.goalGroup')) title FROM ad_annotations a JOIN ad_tasks t ON t.id=a.task_id WHERE JSON_UNQUOTE(JSON_EXTRACT(a.value,'$.goalGroup')) IS NOT NULL");
 for(const row of rows){const title=row.title.trim();if(!title)continue;const id='legacy-'+createHash('sha256').update(JSON.stringify([row.project_id,title])).digest('hex').slice(0,32);await store.transaction(async tx=>{await tx.rows('INSERT IGNORE INTO ad_goals VALUES(?,?,?,?,?,?,?,?,?,?)',[id,title,row.project_id,'由旧关联文本迁移，待整理','','not_started',null,Date.now(),true,Date.now()]);await tx.rows('INSERT IGNORE INTO ad_goal_sessions VALUES(?,?,?)',[id,row.id,Date.now()]);});}
}
export async function goalCandidates(store,id){const g=await goalGet(store,id);if(!g)throw new Error('目标不存在');const page=await store.list({project:g.projectId,recent:true});return page.tasks.filter(t=>!g.sessions.some(s=>s.id===t.id));}
