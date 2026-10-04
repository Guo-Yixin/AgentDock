import {randomUUID} from 'node:crypto';
export async function claimReminder(store,{id,owner}){
 return store.transaction(async tx=>{
  const s=await tx.document(id,'schedule'),now=Date.now();
  if(!s||s.done||s.notifiedAt||s.end<=now||s.start-s.reminderMinutes*60000>now||s.claimUntil>now)return {claimed:false};
  const token=randomUUID();await tx.putDocument('schedule',{...s,claimToken:token,claimOwner:owner,claimUntil:now+90000});return {claimed:true,token};
 });
}
export async function acknowledgeReminder(store,{id,claim}){
 return store.transaction(async tx=>{
  const s=await tx.document(id,'schedule');if(!s)throw new Error('日程不存在');
  if(claim&&(s.claimToken!==claim||s.claimUntil<Date.now()))throw new Error('提醒领取已过期');
  const next={...s,notifiedAt:Date.now()};delete next.claimToken;delete next.claimOwner;delete next.claimUntil;return tx.putDocument('schedule',next);
 });
}
