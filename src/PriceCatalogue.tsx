import {useEffect,useState} from 'react';
import {request} from './api';
import {Paged} from './Pagination';
type Rate={id:string;vendor:string;model:string;input:number;output:number;cacheRead:number;cacheWrite:number;cacheWriteLong:number;source:string;tier:string;currency:string;note:string;verifiedAt:string};
export function PriceCatalogue({demo,onApply}:{demo:boolean;onApply:(r:Rate)=>void}){
 const [rows,setRows]=useState<Rate[]>([]),[q,setQ]=useState('');useEffect(()=>{if(!demo)void request<Rate[]>('/api/usage/catalogue').then(setRows).catch(()=>{});},[demo]);
 return <section className="source-panel"><h3>官方参考单价 · 提供商与模型</h3><p className="muted">单位：每百万 Token。核查日期 2026-10-07；按公开 API 刊例价区分等级。未知别名不自动匹配，历史价格须按账单日期核对；订阅费用与账单由平台确定。</p><label className="field-label">搜索提供商、模型或等级<input aria-label="搜索官方单价" value={q} onChange={e=>setQ(e.target.value)}/></label><Paged key={q} label="官方单价">{rows.filter(r=>(r.vendor+' '+r.model+' '+r.tier).toLowerCase().includes(q.toLowerCase())).map(r=><div className="report-fact" key={r.id}><strong>{r.vendor} · {r.model} · {r.tier}</strong><p>输入 {r.input} · 输出 {r.output} · 缓存读取 {r.cacheRead} · 缓存写入 {r.cacheWrite} / 长缓存 {r.cacheWriteLong} {r.currency}/M</p><small>{r.note} <a href={r.source} target="_blank" rel="noreferrer">官方依据 ↗</a></small><button className="text-button" onClick={()=>onApply(r)}>填入单价配置</button></div>)}</Paged></section>;
}
