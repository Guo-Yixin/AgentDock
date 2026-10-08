// Estimates live outside ad_usage. Generated weekdays are explicitly estimates,
// never request evidence, input/output splits or billable usage.
const id = 'usage-history-owner';
const providers = new Set(['codex','claude','cursor','pi','deepseek','workbuddy','agentdock','unknown']);
const dateIndex = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('请填写有效历史日期');
  const parsed = Date.parse(value+'T00:00:00Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10)!==value) throw new Error('历史日期无效');
  return parsed/86400000;
};
export function validateHistory(input) {
  if (!['target','amount'].includes(input.mode) || !Number.isSafeInteger(input.tokens) || input.tokens < 0) throw new Error('请填写非负整数 Token');
  const note = String(input.note || '').trim();
  if (!note || note.length > 4000) throw new Error('请填写历史估算依据（最多 4000 字）');
  const distribution=input.distribution||'weekdays';if(!['weekdays','flexible'].includes(distribution))throw new Error('请选择有效分布方式');
  const start = dateIndex(input.start), end = dateIndex(input.end);
  if(end<start || end-start>1826 || end>=Math.floor((Date.now()+28800000)/86400000)) throw new Error('历史区间须结束于今天以前，且不超过五年');
  if (!Array.isArray(input.allocations) || !input.allocations.length || input.allocations.length > 40) throw new Error('模型分配须为 1–40 项');
  const seen = new Set();
  const allocations = input.allocations.map(r => {
    const model = String(r.model || '').trim();
    if (!providers.has(r.provider) || !model || model.length > 128 || !Number.isInteger(r.weight) || r.weight <= 0 || r.weight > 10000) throw new Error('请填写有效工具、模型和分配比例');
    const key = JSON.stringify([r.provider,model]);
    if (seen.has(key)) throw new Error('同工具模型不可重复');
    const since = r.since || input.start;
    const first = dateIndex(since);
    if(first<start || first>end || (distribution==='weekdays'&&!weekdays(first,end).length)) throw new Error('模型起始日期须在历史区间内且包含工作日');
    seen.add(key); return {provider:r.provider,model,weight:r.weight,since};
  });
  if (allocations.reduce((s,r)=>s+r.weight,0) !== 10000) throw new Error('模型分配比例须合计 100%');
  return {distribution,mode:input.mode,tokens:input.tokens,note,allocations,start:input.start,end:input.end};
}
function weekdays(start,end){const days=[];for(let d=start;d<=end;d++){const w=new Date(d*86400000).getUTCDay();if(w>0&&w<6)days.push(d);}return days;}
export function distributeHistoryDays(allocations,start,end,distribution='weekdays'){
  const totals=new Map();
  for(const row of allocations){
    const first=Math.max(dateIndex(start),dateIndex(row.since||start)),last=dateIndex(end);
    const dates=distribution==='flexible'?Array.from({length:last-first+1},(_,i)=>first+i):weekdays(first,last);
    const weights=dates.map(d=>{
      if(distribution==='weekdays')return [0,8,10,9,10,7,0][new Date(d*86400000).getUTCDay()]*(8+Math.floor(d/7)%5);
      // Stable variation is only an estimate. It never creates measured requests.
      let h=2166136261;for(const c of `${row.provider}:${row.model}:${d}`)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
      const weekend=[0,6].includes(new Date(d*86400000).getUTCDay());return weekend?(h%4===0?0:1+h%35):10+h%130;
    });
    if(!weights.some(w=>w>0))weights.fill(1);
    const denominator=weights.reduce((s,w)=>s+w,0);let assigned=0;
    dates.forEach((day,i)=>{const total=i===dates.length-1?row.total-assigned:Number(BigInt(row.total)*BigInt(weights[i])/BigInt(denominator));assigned+=total;totals.set(day,(totals.get(day)||0)+total);});
  }
  return [...totals].map(([day,total])=>({day,total})).sort((a,b)=>a.day-b.day);
}
export function allocateHistory(total, allocations) {
  let assigned = 0;
  return allocations.map((r,i) => {
    // BigInt avoids losing units for large, safe integer token totals.
    const tokens = i === allocations.length - 1 ? total - assigned : Number(BigInt(total)*BigInt(r.weight)/10000n);
    assigned += tokens; return {...r,total:tokens};
  });
}
export async function saveHistory(store, input, ownerId) {
  const value = validateHistory(input);
  if (ownerId !== 'owner') throw new Error('仅工作空间所有者可补录历史');
  return store.transaction(async tx => {
    // Stable owner lock serializes first creation and subsequent edits.
    await tx.rows('SELECT id FROM ad_users WHERE id=? FOR UPDATE',[ownerId]);
    const previous = await tx.document(id,'usage-history');
    const anchorAt = Date.now();
    const [counts] = await tx.rows("SELECT COALESCE(SUM(total_tokens),0) total,COALESCE(SUM(IF(recorded_at<=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode')),'')<>'manual',total_tokens,0)),0) beforeAnchor FROM ad_usage",[anchorAt]);
    const measured = Number(counts.total);
    const supplementedTotal = value.mode === 'target' ? value.tokens - measured : value.tokens;
    if (supplementedTotal < 0 || !Number.isSafeInteger(supplementedTotal + measured)) throw new Error('累计基准不能小于已采集用量或超过安全整数范围');
    const versions = previous ? [...(previous.versions||[]),{...previous,versions:undefined}].slice(-20) : [];
    return tx.putDocument('usage-history',{id,ownerId,title:'历史用量补录',enabled:true,anchorAt,measuredAtAnchor:measured,measuredBeforeAnchor:Number(counts.beforeAnchor),targetAtAnchor:measured+supplementedTotal,supplementedTotal,note:value.note,allocations:value.allocations,start:value.start,end:value.end,distribution:value.distribution,versions});
  });
}
export async function disableHistory(store,ownerId) {
  if (ownerId !== 'owner') throw new Error('仅工作空间所有者可修改历史');
  return store.transaction(async tx=>{await tx.rows('SELECT id FROM ad_users WHERE id=? FOR UPDATE',[ownerId]);const previous=await tx.document(id,'usage-history');if(!previous)return {ok:true};return tx.putDocument('usage-history',{...previous,enabled:false,versions:[...(previous.versions||[]),{...previous,versions:undefined}].slice(-20)});});
}
export async function historyOverview(store,args) {
  const config = await store.document(id,'usage-history');
  let recovered = 0, availableTotal = 0;
  if (config?.enabled) {
    const [current] = await store.rows("SELECT COALESCE(SUM(total_tokens),0) total FROM ad_usage WHERE recorded_at<=? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode')),'')<>'manual'",[config.anchorAt]);
    recovered = Math.min(config.supplementedTotal,Math.max(0,Number(current.total)-config.measuredBeforeAnchor));
    availableTotal = config.supplementedTotal-recovered;
  }
  const allocations = config?.enabled ? allocateHistory(availableTotal,config.allocations).filter(r=>(!args.provider||r.provider===args.provider)&&(!args.model||r.model===args.model)&&!args.project) : [];
  const days=config?.enabled?distributeHistoryDays(allocations,config.start,config.end,config.distribution):[];
  const periodDays=days.filter(d=>(d.day*86400000-28800000)>=(Number(args.start)||0)&&(d.day*86400000-28800000)<(Number(args.end)||Date.now()+86400000));
  const periodIndices=new Set(periodDays.map(d=>d.day));
  const periodAllocations=allocations.map(r=>({...r,total:distributeHistoryDays([r],config.start,config.end,config.distribution).filter(d=>periodIndices.has(d.day)).reduce((s,d)=>s+d.total,0)}));
  return {config:config||null,recovered,availableTotal,allocations,periodAllocations,days,periodTotal:periodDays.reduce((s,d)=>s+d.total,0),total:allocations.reduce((s,r)=>s+r.total,0),projectExcluded:Boolean(args.project&&config?.enabled)};
}
