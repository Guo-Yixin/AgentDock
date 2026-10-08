import {useRef,useState} from 'react';
import {Activity,ChevronDown,MessageSquare,Terminal,UserRound} from 'lucide-react';
import {Pagination} from './Pagination';
import {ReadingText,snippet} from './Reading';
import type {TaskEvent} from './types';

const kinds:Record<string,{name:string;hint:string;icon:typeof Activity}>={
 user:{name:'用户请求',hint:'提出目标或补充要求',icon:UserRound},
 assistant:{name:'助手回复',hint:'模型的回复与进展陈述',icon:MessageSquare},
 tool:{name:'工具操作',hint:'记录中的命令、调用或结果',icon:Terminal},
};
export function ActivityTimeline({events,complete,error,more,onMore}:{events:TaskEvent[];complete:boolean;error:string;more:boolean;onMore:()=>Promise<void>}){
 const [page,setPage]=useState(1),[open,setOpen]=useState<number|null>(null),[raw,setRaw]=useState(false),[busy,setBusy]=useState(false);
 const list=useRef<HTMLDivElement>(null);
 const size=4,shown=events.slice((page-1)*size,page*size);
 return <section className="activity-reader" aria-label="会话活动记录"><div className="section-heading"><h3><Activity size={17}/>活动时间线</h3><span>{complete?'完整历史 · 分页读取':'近期缓存'}</span></div><p className="muted activity-guide">按记录顺序 · 点击卡片展开 · 助手陈述需核实。</p>{error&&<p role="alert" className="error-banner">{error}</p>}<div ref={list} className="activity-list" tabIndex={0}>{shown.map((event,i)=>{
  const index=(page-1)*size+i,kind=kinds[event.kind]||{name:'会话事件',hint:'会话状态或系统记录',icon:Activity},Icon=kind.icon,expanded=open===index;
  return <article className={'activity-card activity-'+event.kind} key={index}><div className="activity-marker" aria-hidden="true"><Icon size={15}/></div><div className="activity-content"><button className="activity-toggle" aria-expanded={expanded} onClick={()=>{setOpen(expanded?null:index);setRaw(false);}}><span className="activity-heading"><strong>{kind.name}</strong><time>{new Date(event.timestamp).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</time></span><span className="activity-summary">{snippet(event.text).slice(0,180)||kind.hint}</span><ChevronDown size={15}/></button>{expanded&&<div className="activity-expanded"><div className="reading-tools"><span>{kind.hint}</span><button className="text-button" onClick={()=>setRaw(!raw)}>{raw?'格式化正文':'查看原文'}</button></div><div className="activity-body" tabIndex={0}><ReadingText text={event.text||'此事件没有文本正文。'} raw={raw}/></div>{event.evidence&&<details className="activity-evidence"><summary>来源定位</summary><p>{event.evidence.path}{event.evidence.line?` · 第 ${event.evidence.line} 行`:''}{event.evidence.locator?` · ${event.evidence.locator}`:''}</p></details>}</div>}</div></article>;
 })}{!events.length&&<p className="muted">未找到可读取的活动正文。</p>}</div><div className="activity-pagination"><Pagination label="会话活动" total={events.length} page={page} size={size} onChange={n=>{setPage(n);setOpen(null);if(list.current)list.current.scrollTop=0;}}/>{more&&<button className="outline-button" disabled={busy} onClick={()=>{setBusy(true);void onMore().finally(()=>setBusy(false));}}>{busy?'正在读取…':'加载更多活动'}</button>}</div></section>;
}
