import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function useLocalToggle(key: string, initial: boolean) {
  const [value,setValue] = useState(() => { try { const saved=localStorage.getItem('agentdock-layout:'+key); return saved===null?initial:saved==='true'; } catch { return initial; } });
  const update = (next: boolean) => { setValue(next);try { localStorage.setItem('agentdock-layout:'+key,String(next)); } catch { /* Layout still works without storage. */ } };
  return [value,update] as const;
}

/** Keep children mounted: folding must never discard an unsaved form. */
export function Disclosure({id,title,caption,initial=false,children,className=''}:{id:string;title:string;caption?:string;initial?:boolean;children:ReactNode;className?:string}) {
  const [open,setOpen]=useLocalToggle(id,initial), region=useId();
  return <section className={`disclosure ${className} ${open?'is-open':''}`}>
    <button className="disclosure-toggle" aria-expanded={open} aria-controls={region} onClick={()=>setOpen(!open)}><span>{title}</span>{caption&&<small>{caption}</small>}<ChevronDown size={16}/></button>
    <div id={region} className="disclosure-body" hidden={!open}>{children}</div>
  </section>;
}
