import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {request} from '../api';
import {ReadingText} from '../Reading';
import type {Chat,Preview} from './shared';

type MessageWindow=Chat&{total:number;start:number;end:number;nextBefore:number|null};
type Anchor={position:string|undefined;offset:number;top:number};
export function ChatThread({chat,revision,pending,busy,demo,onSource}:{chat?:Chat;revision:number;pending?:{question:string;answer:string};busy:boolean;demo:boolean;onSource:(source:Preview['sources'][number])=>void}){
 const [messages,setMessages]=useState<MessageWindow>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[newContent,setNewContent]=useState(false),root=useRef<HTMLDivElement>(null),follow=useRef(true),anchor=useRef<Anchor|undefined>(undefined),generation=useRef(0),current=useRef(messages),selected=useRef<string|undefined>(undefined);current.current=messages;
 const [retry,setRetry]=useState(0);
 function capture(){const el=root.current;if(!el)return;const first=[...el.querySelectorAll<HTMLElement>('[data-position]')].find(n=>n.getBoundingClientRect().bottom>el.getBoundingClientRect().top);anchor.current={position:first?.dataset.position,offset:first?first.getBoundingClientRect().top-el.getBoundingClientRect().top:0,top:el.scrollTop};}
 function page(before?:number):Promise<MessageWindow>{
  if(demo){const end=Math.min(before??chat!.messages.length,chat!.messages.length),start=Math.max(0,end-20);return Promise.resolve({...chat!,messages:chat!.messages.slice(start,end),total:chat!.messages.length,start,end,nextBefore:start||null});}
  return request<MessageWindow>(`/api/assistant/chats/${encodeURIComponent(chat!.id)}/messages${before===undefined?'':`?before=${before}&limit=20`}`);
 }
 useEffect(()=>{
  const run=++generation.current,changed=selected.current!==chat?.id;selected.current=chat?.id;setLoading(false);setError('');
  if(changed){setMessages(undefined);setNewContent(false);if(!pending)follow.current=true;}
  if(!chat)return;
  void page().then(r=>{if(generation.current!==run)return;
   if(!changed&&!follow.current)capture();
   setMessages(v=>{
    if(changed||!v||v.id!==r.id)return r;
    if(v.end<v.total||(!follow.current&&r.end-v.start>100))return {...v,total:r.total};
    const start=Math.max(v.start,r.end-100),combined=[...v.messages.slice(0,Math.max(0,r.start-v.start)),...r.messages];
    return {...r,start,messages:combined.slice(start-v.start)};
   });
  }).catch(e=>{if(generation.current===run)setError(e.message);});
  return()=>{generation.current++;};
 },[chat?.id,revision,demo,retry]);
 useLayoutEffect(()=>{
  const el=root.current;if(!el)return;
  if(anchor.current){const a=anchor.current,node=a.position===undefined?null:el.querySelector<HTMLElement>(`[data-position="${a.position}"]`);el.scrollTop=node?el.scrollTop+node.getBoundingClientRect().top-el.getBoundingClientRect().top-a.offset:a.top;anchor.current=undefined;return;}
  if(follow.current){el.scrollTop=el.scrollHeight;setNewContent(false);}else setNewContent(true);
 },[messages,pending?.answer,pending?.question]);
 async function load(older:boolean){
  const v=current.current;if(!v||loading)return;const run=generation.current;setLoading(true);setError('');
  try{const r=await page(older?v.start:Math.min(v.total,v.end+20));if(run!==generation.current)return;capture();follow.current=false;
   const combined=older?[...r.messages,...v.messages]:[...v.messages,...r.messages],start=older?r.start:Math.max(v.start,r.end-100),end=older?Math.min(v.end,r.start+100):r.end;
   setMessages({...r,total:Math.max(v.total,r.total),start,end,messages:older?combined.slice(0,100):combined.slice(-100)});
  }catch(e){if(run===generation.current)setError((e as Error).message);}finally{if(run===generation.current)setLoading(false);}
 }
 async function jump(){
  const run=generation.current;
  if(messages&&messages.end<messages.total){try{const latest=await page();if(run!==generation.current)return;setMessages(latest);}catch(e){if(run===generation.current)setError((e as Error).message);return;}}
  follow.current=true;const el=root.current;if(el)el.scrollTop=el.scrollHeight;setNewContent(false);
 }
 const last=messages?.messages.at(-1),savedQuestion=Boolean(pending&&last?.role==='user'&&last.text===pending.question),savedAnswer=Boolean(pending&&last?.role==='assistant'&&last.text===pending.answer);
 const reserved=pending&&!savedAnswer?(savedQuestion?1:2):0,capacity=100-reserved,offset=follow.current?Math.max(0,(messages?.messages.length||0)-capacity):0,shown=messages?.messages.slice(offset,offset+capacity);
 return <div className="chat-stream-wrap"><div className="chat-thread chat-stream" ref={root} role="log" aria-label="聊天消息" onScroll={()=>{const el=root.current!;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<40;if(follow.current)setNewContent(false);}}>
  {messages&&messages.start>0&&<button className="outline-button chat-load" disabled={loading} onClick={()=>void load(true)}>加载更早的消息</button>}
  {error&&<div><p role="alert">{error}</p><button className="outline-button" onClick={()=>setRetry(v=>v+1)}>重新读取聊天</button></div>}
  {shown?.map((m,i)=><article className={`chat-message ${m.role}`} data-position={messages!.start+offset+i} key={messages!.start+offset+i}><strong>{m.role==='user'?'你':'AgentDock'}</strong><ReadingText text={m.text}/>{m.error&&<small>{m.error}</small>}{m.sources?.map(s=><button className="text-button" key={s.number} onClick={()=>onSource(s)}>[{s.number}] {s.title} ↗</button>)}</article>)}
  {messages&&messages.end<messages.total&&<button className="outline-button chat-load" disabled={loading} onClick={()=>void load(false)}>加载后续消息</button>}
  {pending&&!savedQuestion&&!savedAnswer&&<article className="chat-message user"><strong>你</strong><ReadingText text={pending.question}/></article>}
  {pending&&!savedAnswer&&<article className="chat-message assistant"><strong>{demo?'模拟回答':'AgentDock'}</strong>{pending.answer?<ReadingText text={pending.answer}/>:<p role="status">{busy?'正在思考…':'等待保存的回答…'}</p>}</article>}
  {!chat&&!pending&&<div className="chat-welcome"><strong>从一个问题开始</strong><p>选择工作记录作为上下文，再开始分析。</p></div>}
 </div>{newContent&&<button className="outline-button chat-new" onClick={()=>void jump()}>有新消息 ↓</button>}</div>;
}
