import { useId, useState, useEffect, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function useLocalToggle(key: string, initial: boolean) {
  const [value,setValue] = useState(() => { try { const saved=localStorage.getItem('agentdock-layout:'+key); return saved===null?initial:saved==='true'; } catch { return initial; } });
  const update = (next: boolean) => { setValue(next);try { localStorage.setItem('agentdock-layout:'+key,String(next)); } catch { /* Layout still works without storage. */ } };
  return [value,update] as const;
}

/** Keep children mounted: folding must never discard an unsaved form. */
export function Disclosure({id,title,caption,initial=false,children,className='',onOpenChange}:{id:string;title:string;caption?:string;initial?:boolean;children:ReactNode;className?:string;onOpenChange?:(open:boolean)=>void}) {
  const [open,setOpen]=useLocalToggle(id,initial), region=useId();
  useEffect(()=>{onOpenChange?.(open);},[open]);
  useEffect(()=>{if(id!=='sidebar-sources')return;const close=()=>setOpen(false);window.addEventListener('agentdock-close-sources',close);return()=>window.removeEventListener('agentdock-close-sources',close);},[id]);
  return <section className={`disclosure ${className} ${open?'is-open':''}`}>
    <button className="disclosure-toggle" aria-expanded={open} aria-controls={region} onClick={()=>setOpen(!open)}><span>{title}</span>{caption&&<small>{caption}</small>}<ChevronDown size={16}/></button>
    <div id={region} className="disclosure-body" hidden={!open}>{children}</div>
  </section>;
}
