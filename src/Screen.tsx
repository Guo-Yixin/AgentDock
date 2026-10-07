import {Children,createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {Pagination} from './Pagination';

type Choice={id:string;label:string};
/** Only non-secret navigation state belongs in the URL. Apply a filter change atomically. */
export function useQueryFields<T extends Record<string,string>>(key:string,defaults:T){
 const location=useLocation(),navigate=useNavigate(),params=new URLSearchParams(location.search);
 const fields=Object.fromEntries(Object.entries(defaults).map(([name,value])=>[name,params.get(`filter-${key}-${name}`)??value])) as T;
 const update=(patch:Partial<T>,replace=false)=>{const p=new URLSearchParams(window.location.search);for(const [name,value] of Object.entries(patch)){const param=`filter-${key}-${name}`;if(value===defaults[name])p.delete(param);else p.set(param,String(value));}navigate({pathname:location.pathname,search:p.toString()},{replace});};
 return [fields,update] as const;
}
export function useSection(key:string,fallback:string){
 const location=useLocation(),navigate=useNavigate(),param='section-'+key;
 const value=new URLSearchParams(location.search).get(param)||fallback;
 const set=(next:string)=>{const p=new URLSearchParams(window.location.search);if(next===fallback)p.delete(param);else p.set(param,next);navigate({pathname:location.pathname,search:p.toString()});};
 return [value,set] as const;
}
export function Switcher({label,choices,value,onChange}:{label:string;choices:Choice[];value:string;onChange:(v:string)=>void}){
 return <div className="screen-switcher"><nav aria-label={label}>{choices.map(c=><button type="button" key={c.id} className={value===c.id?'active':''} aria-current={value===c.id?'page':undefined} onClick={()=>onChange(c.id)}>{c.label}</button>)}</nav><label className="screen-select">{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label></div>;
}
const ScreenContext=createContext('');
export function Screens({id,choices,children,initial=choices[0].id}:{id:string;choices:Choice[];children:ReactNode;initial?:string}){
 const [section,setSection]=useSection(id,initial);const active=choices.some(c=>c.id===section)?section:initial;
 return <div className="screens"><Switcher label={id+'页面'} choices={choices} value={active} onChange={setSection}/><ScreenContext.Provider value={active}>{children}</ScreenContext.Provider></div>;
}
export function Pane({id,children,className=''}:{id:string;children:ReactNode;className?:string}){const active=useContext(ScreenContext);return <section className={'screen-pane '+className} hidden={active!==id} aria-label={id}>{children}</section>;}
// Fields remain mounted while switching steps, preserving local drafts and credential inputs.
export function Steps({children,label='编辑步骤',count=3}:{children:ReactNode;label?:string;count?:number}){
 const fields=Children.toArray(children),[step,setStep]=useState(1),size=useListSize(count,180),pages=Math.ceil(fields.length/size),prior=useRef(size);
 useEffect(()=>{if(prior.current!==size){const first=(step-1)*prior.current;prior.current=size;setStep(Math.floor(first/size)+1);}},[size]);
 return <div className="form-steps"><div className="step-fields">{fields.map((field,i)=><div className="step-field" data-step={Math.floor(i/size)+1} key={i} hidden={Math.floor(i/size)!==Math.min(step,pages)-1}>{field}</div>)}</div><Pagination label={label} total={fields.length} size={size} page={Math.min(step,pages)||1} onChange={setStep}/></div>;
}
export function useListSize(max=5,row=95){const [height,setHeight]=useState(window.innerHeight);useEffect(()=>{const update=()=>setHeight(window.innerHeight);window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);return Math.max(1,Math.min(max,Math.floor((height-300)/row)));}
export function ProjectPages({children,revision}:{children:ReactNode[];revision:number}){
 const root=useRef<HTMLDivElement>(null),[shape,setShape]=useState({cols:4,rows:2}),[snapshot,setSnapshot]=useState(children),[pending,setPending]=useState(false);
 const location=useLocation(),navigate=useNavigate(),page=Math.max(1,Number(new URLSearchParams(location.search).get('projectPage'))||1),size=shape.cols*shape.rows,previousSize=useRef(size);
 function select(n:number,replace=false){const p=new URLSearchParams(window.location.search);if(n===1)p.delete('projectPage');else p.set('projectPage',String(n));navigate({pathname:location.pathname,search:p.toString()},{replace});}
 useEffect(()=>{if(page===1){setSnapshot(children);setPending(false);}else setPending(true);},[revision,children.length]);
 useEffect(()=>{const node=root.current;if(!node)return;const observer=new ResizeObserver(([e])=>{const cols=Math.min(4,Math.max(1,Math.floor((e.contentRect.width+16)/296)));const rows=Math.min(cols===1?3:2,Math.max(1,Math.floor((e.contentRect.height-48)/180)));setShape(v=>v.cols===cols&&v.rows===rows?v:{cols,rows});});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(previousSize.current!==size){const first=(page-1)*previousSize.current;previousSize.current=size;select(Math.floor(first/size)+1,true);}},[size]);
 return <div ref={root} className="project-pages"><div className="project-grid" style={{gridTemplateColumns:`repeat(${shape.cols},minmax(0,1fr))`,gridTemplateRows:`repeat(${shape.rows},minmax(0,1fr))`}}>{snapshot.slice((page-1)*size,page*size)}</div><div className="project-pagination">{pending&&<button className="text-button" onClick={()=>{setSnapshot(children);setPending(false);}}>更新项目顺序</button>}<Pagination label="项目空间" total={snapshot.length} size={size} page={page} onChange={select}/></div></div>;
}
export const quotes:Record<string,string>={overview:'先看清下一步，再开始今天。',goals:'让目标清晰，让行动有序。',projects:'每个项目，都值得一个完整的视角。',history:'留下过程，才能看见成长。',memories:'把有用的经验，留给下一次行动。',workflows:'一步一步，让想法成为结果。',assistant:'好的问题，让下一步更清楚。',usage:'看清投入，才能做出更好的选择。',reports:'记录真实进展，看见持续积累。',calendar:'为重要的事，留出明确的位置。',sources:'连接分散的工具，汇成清晰的工作。',settings:'合适的配置，让工作更从容。',account:'照顾好自己的工作空间。'};
