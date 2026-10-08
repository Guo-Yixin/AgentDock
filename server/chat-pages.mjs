export function chatPage(chat,{before,limit=20}={}){
 const total=chat.messages.length,end=before===undefined?total:Math.min(before,total),start=Math.max(0,end-limit);
 return {id:chat.id,title:chat.title,total,start,end,nextBefore:start||null,messages:chat.messages.slice(start,end).map(({preview,...message})=>message)};
}
