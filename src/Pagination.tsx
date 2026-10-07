import {useEffect,useState,type ReactNode} from 'react';
export const PAGE_SIZE=5;
export function Pagination({total,page,onChange,size=PAGE_SIZE,label='列表'}:{total:number;page:number;onChange:(page:number)=>void;size?:number;label?:string}) {
  const pages=Math.max(1,Math.ceil(total/size));
  useEffect(()=>{if(page>pages)onChange(pages);},[page,pages]);
  if(total<=size)return null;
  return <nav className="pagination" aria-label={`${label}分页`}><span>共 {total} 条 · 每页 {size} 条</span><div><button className="outline-button" disabled={page<=1} onClick={()=>onChange(page-1)}>上一页</button><label>页码 <input aria-label={`${label}页码`} type="number" min="1" max={pages} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=pages)onChange(n);}}/></label><span>/ {pages}</span><button className="outline-button" disabled={page>=pages} onClick={()=>onChange(page+1)}>下一页</button></div></nav>;
}
export function Paged({children,label='列表',size=PAGE_SIZE}:{children:ReactNode[];label?:string;size?:number}) {
  const [page,setPage]=useState(1);const current=Math.min(page,Math.max(1,Math.ceil(children.length/size)));
  return <>{children.slice((current-1)*size,current*size)}<Pagination label={label} size={size} total={children.length} page={current} onChange={setPage}/></>;
}
