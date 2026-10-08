import {useLayoutEffect,useRef,useState} from 'react';
import {Activity,BookOpen,ChevronDown,Clock3,FolderGit2,GitBranch,History,Layers3,LayoutDashboard,Plug,ShieldCheck,Sparkles} from 'lucide-react';

const groups=[
 {id:'work',label:'工作空间',items:[{id:'overview',label:'工作台',icon:LayoutDashboard},{id:'goals',label:'工作目标',icon:Layers3},{id:'projects',label:'项目空间',icon:FolderGit2},{id:'history',label:'历史记录',icon:History}]},
 {id:'assets',label:'记忆与协作',items:[{id:'memories',label:'记忆库',icon:BookOpen},{id:'workflows',label:'工作流',icon:GitBranch},{id:'assistant',label:'内置助手',icon:Sparkles}]},
 {id:'insights',label:'观察与计划',items:[{id:'usage',label:'用量审计',icon:Activity},{id:'reports',label:'报告中心',icon:History},{id:'calendar',label:'日历日程',icon:Clock3}]},
 {id:'system',label:'连接与设置',items:[{id:'sources',label:'工具接入',icon:Plug},{id:'settings',label:'设置',icon:ShieldCheck}]}
];

export function SidebarNavigation({view,compact,sourcesExpanded,total,navigate}:{view:string;compact:boolean;sourcesExpanded:boolean;total:number|string;navigate:(view:string)=>unknown}){
 const root=useRef<HTMLElement>(null),[open,setOpen]=useState<Record<string,boolean>>(()=>Object.fromEntries(groups.map(g=>{
  try{return [g.id,localStorage.getItem('agentdock-layout:nav-'+g.id)!=='false'];}catch{return [g.id,true];}
 }))),[suspended,setSuspended]=useState<string[]>([]);
 const active=groups.find(g=>g.items.some(i=>i.id===view))?.id;
 function update(next:Record<string,boolean>){setOpen(next);try{for(const [id,value] of Object.entries(next))localStorage.setItem('agentdock-layout:nav-'+id,String(value));}catch{/* Preferences are optional. */}}
 useLayoutEffect(()=>{if(active)update({...open,[active]:true});},[active]);
 useLayoutEffect(()=>{
  const nav=root.current!;
  const fit=()=>{
   const gap=parseFloat(getComputedStyle(nav).gap)||0;
   const sizes=groups.map(g=>{
    const section=nav.querySelector<HTMLElement>(`[data-group="${g.id}"]`)!;
    const toggle=section.querySelector<HTMLElement>('.nav-group-toggle')!;
    const buttons=[...section.querySelectorAll<HTMLElement>('.nav-item')];
    const content=buttons.reduce((sum,b)=>{const s=getComputedStyle(b);return sum+parseFloat(s.height)+(parseFloat(s.marginTop)||0)+(parseFloat(s.marginBottom)||0);},0);
    return {id:g.id,base:toggle.getBoundingClientRect().height,content:(compact||open[g.id])?content:0};
   });
   let height=sizes.reduce((sum,g)=>sum+g.base+g.content,0)+gap*(groups.length-1);
   const folded:string[]=[];
   for(const g of [...sizes.filter(g=>g.id!==active).reverse(),...sizes.filter(g=>g.id===active)]){
    if(height<=nav.clientHeight)break;
    if(g.content){folded.push(g.id);height-=g.content;}
   }
   setSuspended(v=>v.join()===folded.join()?v:folded);
  };
  fit();const observer=new ResizeObserver(fit);observer.observe(nav);window.addEventListener('resize',fit);
  return()=>{observer.disconnect();window.removeEventListener('resize',fit);};
 },[open,active,compact,sourcesExpanded]);
 return <nav ref={root} aria-label="主导航">{groups.map(g=>{
  const expanded=!suspended.includes(g.id)&&(compact||open[g.id]),region='nav-'+g.id;
  return <section className="nav-group" data-group={g.id} key={g.id}><button className="nav-group-toggle" aria-expanded={expanded} aria-controls={region} onClick={()=>{
   if(suspended.includes(g.id)&&sourcesExpanded)window.dispatchEvent(new CustomEvent('agentdock-close-sources'));
   const next={...open,[g.id]:!expanded};
   if(!expanded&&window.innerHeight<780)for(const other of groups)if(other.id!==g.id)next[other.id]=false;
   update(next);
  }}><span>{g.label}</span><ChevronDown size={13}/></button><div id={region} hidden={!expanded}>{g.items.map(i=><button className={`nav-item ${view===i.id?'active':''}`} key={i.id} title={i.label} aria-label={i.label} aria-current={view===i.id?'page':undefined} onClick={()=>navigate(i.id)}><i.icon size={18}/><span className="nav-label">{i.label}</span>{i.id==='overview'&&<span className="nav-count">{total}</span>}</button>)}</div></section>;
 })}</nav>;
}
