import {useLocation,useNavigate} from 'react-router';
import {useEffect,useRef,useState,type ReactNode} from 'react';
export const PAGE_SIZE=5;
export function Pagination({total,page,onChange,size=PAGE_SIZE,label='列表'}:{total:number;page:number;onChange:(page:number)=>void;size?:number;label?:string}) {
  const pages=Math.max(1,Math.ceil(total/size));
  useEffect(()=>{if(page>pages)onChange(pages);},[page,pages]);
  if(total<=size)return null;
  return <nav className="pagination" aria-label={`${label}分页`}><span>共 {total} 条 · 每页 {size} 条</span><div><button type="button" className="outline-button" disabled={page<=1} onClick={()=>onChange(page-1)}>上一页</button><label>页码 <input aria-label={`${label}页码`} type="number" min="1" max={pages} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=pages)onChange(n);}}/></label><span>/ {pages}</span><button type="button" className="outline-button" disabled={page>=pages} onClick={()=>onChange(page+1)}>下一页</button></div></nav>;
}
export function Paged({children,label='列表',size}:{children:ReactNode[];label?:string;size?:number}) {
 const location=useLocation(),navigate=useNavigate(),[height,setHeight]=useState(window.innerHeight),key='pg-'+label;
 useEffect(()=>{const update=()=>setHeight(window.innerHeight);window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);
 const capacity=size??Math.max(1,Math.min(5,Math.floor((height-340)/112))),page=Math.max(1,Number(new URLSearchParams(location.search).get(key))||1),current=Math.min(page,Math.max(1,Math.ceil(children.length/capacity))),prior=useRef(capacity);
 function select(n:number,replace=false){const p=new URLSearchParams(window.location.search);if(n===1)p.delete(key);else p.set(key,String(n));navigate({pathname:location.pathname,search:p.toString()},{replace});}
 useEffect(()=>{if(prior.current!==capacity){const first=(page-1)*prior.current;prior.current=capacity;select(Math.floor(first/capacity)+1,true);}},[capacity]);
 if(capacity>8)return <>{children}</>;
 return <div className="paged"><div className="paged-items">{children.slice((current-1)*capacity,current*capacity)}</div><Pagination label={label} size={capacity} total={children.length} page={current} onChange={select}/></div>;
}
