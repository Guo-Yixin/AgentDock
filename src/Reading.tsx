import {createElement,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {Pagination} from './Pagination';
import {useListSize} from './Screen';

// Only explicit context/attachment markers are hidden. Never rewrite stored records.
export function readingText(text:string){
 const clean=(part:string)=>part
  .replace(/<(system[-_]reminder|user_info|identity_context|project_context|project_instructions|environment_context|instructions|app-context|skills_instructions|permissions instructions|external_codex_apps_open_page|image|local_image)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
  .replace(/<(?:image|local_image)\b[^>]*\/\s*>/gi,'')
  .replace(/<<ImageDisplayed>>/g,'')
  .replace(/^\s*(?:\[(?:Image(?:\s*#?\d+|Displayed)?|图片附件|附件图片|Attachment)(?:\s*[:：][^\]\n]*)?\]|!\[[^\]\n]*\]\([^\n)]*\))\s*$/gmi,'');
 // Keep literal examples inside fenced code intact.
 return text.replace(/\r\n/g,'\n').split(/(^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\2\s*$)/gm).filter((_,i)=>i%3!==2).map((part,i)=>i%2?part:clean(part)).join('').trim();
}
export function snippet(text:string){return readingText(text).replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/(?:^|\n)\s*(?:#{1,6}\s+|[-*+>]\s+|\d+[.)]\s+)/g,' ').replace(/[*`_~]/g,'').replace(/\s+/g,' ').trim();}
function inline(text:string):ReactNode[]{
 return text.split(/(\\[\\`*_\[\]]|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part,i)=>{
  if(/^\\/.test(part))return part.slice(1);
  if(part.startsWith('`')&&part.endsWith('`'))return <code key={i}>{part.slice(1,-1)}</code>;
  if((part.startsWith('**')&&part.endsWith('**'))||(part.startsWith('__')&&part.endsWith('__')))return <strong key={i}>{inline(part.slice(2,-2))}</strong>;
  if((part.startsWith('*')&&part.endsWith('*'))||(part.startsWith('_')&&part.endsWith('_')))return <em key={i}>{part.slice(1,-1)}</em>;
  const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);return link?<a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>:part;
 });
}
export function ReadingText({text,raw=false}:{text:string;raw?:boolean}){
 if(raw)return <pre className="reading-original">{text}</pre>;
 const lines=readingText(text).split('\n'),blocks:ReactNode[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  const fence=line.match(/^\s*(```|~~~)/);
  if(fence){const code:string[]=[];while(++i<lines.length&&!lines[i].trim().startsWith(fence[1]))code.push(lines[i]);blocks.push(<pre key={i}><code>{code.join('\n')}</code></pre>);continue;}
  const heading=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);
  if(heading){blocks.push(createElement('h'+heading[1].length,{key:i},inline(heading[2])));continue;}
  const list=line.match(/^\s*([-*+]|\d+[.)])\s+(.+)/);
  if(list){const ordered=/^\d/.test(list[1]),items:ReactNode[]=[];let next=list;
   do{items.push(<li key={i}>{inline(next[2])}</li>);next=lines[i+1]?.match(/^\s*([-*+]|\d+[.)])\s+(.+)/)!;if(!next||/^\d/.test(next[1])!==ordered)break;i++;}while(true);
   blocks.push(ordered?<ol key={i} start={parseInt(list[1])}>{items}</ol>:<ul key={i}>{items}</ul>);continue;
  }
  blocks.push(line.startsWith('>')?<blockquote key={i}>{inline(line.replace(/^>\s?/,''))}</blockquote>:<p key={i}>{inline(line)}</p>);
 }
 return <div className="reading-markdown">{blocks.length?blocks:<p>正文仅包含系统上下文或附件标记，可切换原文查看。</p>}</div>;
}
export interface ReadingItem{id:string;title:string;text:string;caption?:string;actions?:ReactNode}
export function ReadAccordion({items,label,pageSize}:{items:ReadingItem[];label:string;pageSize?:number}){
 const capacity=useListSize(5,180),size=pageSize||capacity,[page,setPage]=useState(1),[open,setOpen]=useState(items[0]?.id||''),[raw,setRaw]=useState(false),[bounds,setBounds]=useState({height:0,overhead:0}),root=useRef<HTMLDivElement>(null),prefix=useId();
 const pages=Math.max(1,Math.ceil(items.length/size)),current=Math.min(page,pages),shown=items.slice((current-1)*size,current*size);
 useEffect(()=>{const node=root.current;if(!node)return;const measure=()=>{
  const height=node.clientHeight,rows=[...node.querySelectorAll<HTMLElement>('.reading-toggle')].reduce((sum,e)=>sum+e.getBoundingClientRect().height+2,0),tools=node.querySelector<HTMLElement>('.reading-expanded:not([hidden]) .reading-tools')?.getBoundingClientRect().height||0,pagination=node.querySelector<HTMLElement>(':scope > .pagination')?.getBoundingClientRect().height||0;
  const overhead=rows+Math.max(0,shown.length-1)*6+tools+12+(pagination?pagination+8:0);
  setBounds(v=>v.height===height&&v.overhead===overhead?v:{height,overhead});
 };measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();},[shown.length,open,pages]);
 const bodyHeight=Math.max(0,Math.min(bounds.height*.45,bounds.height-bounds.overhead));
 return <div className="reading-accordion" ref={root} aria-label={label}><div className="reading-items">{shown.map((item,i)=><section className="reading-item" key={item.id}><button className="reading-toggle" aria-expanded={open===item.id} aria-controls={prefix+i} onClick={()=>{setOpen(open===item.id?'':item.id);setRaw(false);}}><strong>{item.title}</strong>{item.caption&&<small>{item.caption}</small>}<ChevronDown size={16}/></button><div id={prefix+i} hidden={open!==item.id} className="reading-expanded"><div className="reading-tools"><button className="text-button" aria-pressed={raw} onClick={()=>setRaw(!raw)}>{raw?'格式化正文':'查看原文'}</button>{item.actions}</div><div className="reading-body" tabIndex={0} aria-label={item.title+'正文'} style={{maxHeight:bodyHeight}}><ReadingText text={item.text} raw={raw}/></div></div></section>)}</div><Pagination label={label} total={items.length} size={size} page={current} onChange={n=>{setPage(n);setOpen(items[(n-1)*size]?.id||'');setRaw(false);}}/></div>;
}
