import {historyOverview} from './usage-history.mjs';
import {digest} from './store.mjs';
export function validateManual(input) {
  const {id,provider,model,input:tokensIn,output,timestamp,note,version=0,refine=false}=input;
  if(!/^[A-Za-z0-9-]{8,64}$/.test(id||'')||!['codex','claude','cursor','pi','deepseek','workbuddy','agentdock','unknown'].includes(provider)||typeof model!=='string'||!model.trim()||model.length>128||!Number.isSafeInteger(tokensIn)||tokensIn<0||!Number.isSafeInteger(output)||output<0||!Number.isSafeInteger(tokensIn+output)||tokensIn+output<=0||!Number.isSafeInteger(timestamp)||timestamp<946684800000||timestamp>Date.now()||typeof note!=='string'||!note.trim()||note.length>4000||!Number.isInteger(version)||version<0||typeof refine!=='boolean')throw new Error('请填写有效模型、整数输入输出 Token、过去的日期时间和补录依据');
  return {id,provider,model:model.trim(),input:tokensIn,output,timestamp,note,version,refine,total:tokensIn+output};
}
export async function manualPut(store,input,ownerId,remove=false){
  if(ownerId!=='owner')throw new Error('仅工作空间所有者可管理补录');
  const value=remove?input:validateManual(input);const key='manual-'+value.id;
  return store.transaction(async tx=>{
    await tx.rows("SELECT id FROM ad_users WHERE id='owner' FOR UPDATE");
    const old=await tx.document(key,'usage-manual');if((old?.version||0)!==value.version)throw new Error('补录已更新，请重新加载后修改');if(remove&&(!old||old.deleted))throw new Error('补录不存在');
    const [sum]=await tx.rows('SELECT COALESCE(SUM(total_tokens),0) total FROM ad_usage');if(!remove&&!Number.isSafeInteger(Number(sum.total)-(old&&!old.deleted?old.total:0)+value.total))throw new Error('累计 Token 超出安全整数范围');
    const history=await tx.document('usage-history-owner','usage-history');
    let balance=history?.supplementedTotal||0;const refund=old?.refine&&!old.deleted&&old.anchorAt===history?.anchorAt?old.total:0;balance+=refund;
    if(!remove&&value.refine){if(!history?.enabled)throw new Error('请先建立历史补录余额，或选择单独追加');const available=(await historyOverview(tx,{})).availableTotal+refund;if(available<value.total)throw new Error('历史余额不足，请减少数量或单独追加');balance-=value.total;}
    if(history&&(refund||(!remove&&value.refine)))await tx.putDocument('usage-history',{...history,supplementedTotal:balance,versions:[...(history.versions||[]),{...history,versions:undefined,changedAt:Date.now(),action:'精确补录调整余额'}].slice(-20)});
    const record=tx.scrub({...old,...value,id:key,title:'手动补录',mode:'manual',ownerId,anchorAt:!remove&&value.refine?history.anchorAt:null,version:value.version+1,deleted:remove,versions:[...(old?.versions||[]),...(old?[{...old,versions:undefined,changedAt:Date.now()}]:[])].slice(-20)});
    await tx.putDocument('usage-manual',record);
    const usageId=digest(key);if(remove)await tx.rows('DELETE FROM ad_usage WHERE id=?',[usageId]);else await tx.rows('INSERT INTO ad_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),model=VALUES(model),recorded_at=VALUES(recorded_at),input_tokens=VALUES(input_tokens),output_tokens=VALUES(output_tokens),total_tokens=VALUES(total_tokens),record=VALUES(record),cache_read_tokens=NULL,cache_write_tokens=NULL',[usageId,key,value.provider,value.model,'unassigned',value.timestamp,value.input,null,null,value.output,value.total,JSON.stringify({...record,versions:undefined,id:usageId,evidence:{locator:`AgentDock 手动补录 ${key} · 版本 ${record.version}`}})]);
    return record;
  });
}
