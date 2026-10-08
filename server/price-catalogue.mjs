// Public API reference rates, verified 2026-10-08. Never infer an IDE subscription bill.
const openai='https://developers.openai.com/api/docs/pricing';
const anthropic='https://platform.claude.com/docs/en/about-claude/pricing';
const deepseek='https://api-docs.deepseek.com/quick_start/pricing/';
const cursor='https://cursor.com/docs/models-and-pricing';
const tencent='https://cloud.tencent.com/document/product/1729/97731';
const rows=[];
function add(vendor,model,input,output,cacheRead,cacheWrite,cacheWriteLong,source,tier='标准',note='',currency='USD'){
 rows.push({id:`${vendor}:${model}:${tier}`,vendor,model,input,output,cacheRead,cacheWrite,cacheWriteLong,source,tier,note,currency,verifiedAt:'2026-10-08'});
}
for(const [model,i,o,c,w] of [['gpt-6-astra',10,50,1,12.5],['gpt-6.1-sol',2,10,.1,2.5],['gpt-6-luna',.1,.5,.01,.125],['gpt-5.6-sol',4,20,.4,5]]){
 add('OpenAI',model,i,o,c,w,w,openai,'标准 · 短上下文','须核对请求上下文、服务等级和地区，不能套用订阅账单');
 add('OpenAI',model,i*2,o*1.5,c*2,w*2,w*2,openai,'标准 · 长上下文','上下文阈值依官方模型页；缺少请求上下文时请核实等级');
}
add('OpenAI','gpt-5.5',5,30,.5,5,5,'https://developers.openai.com/api/docs/models/gpt-5.5','标准 · ≤272K','无独立缓存写入价，暂按普通输入');
add('OpenAI','gpt-5.5',10,45,1,10,10,'https://developers.openai.com/api/docs/models/gpt-5.5','标准 · >272K','完整会话适用长上下文倍率');
for(const [model,i,o,c] of [['claude-opus-5-5',4,20,.2],['claude-sonnet-5-5',2,10,.1],['claude-haiku-4-5',1,5,.1],['claude-fable-5-1',10,50,.25],['claude-mythos-5-1',10,50,.25],['claude-fable-5',10,50,1],['claude-mythos-5',10,50,1],['claude-opus-5',5,25,.5],['claude-opus-4-8',5,25,.5],['claude-opus-4-7',5,25,.5],['claude-opus-4-6',5,25,.5],['claude-opus-4-5',5,25,.5],['claude-opus-4-1',15,75,1.5],['claude-opus-4',15,75,1.5],['claude-sonnet-5',2,10,.2],['claude-sonnet-4-6',3,15,.3],['claude-sonnet-4-5',3,15,.3],['claude-sonnet-4',3,15,.3],['claude-haiku-3-5',.8,4,.08]])add('Anthropic',model,i,o,c,i*1.25,i*2,anthropic,'标准','缓存写入分 5 分钟与 1 小时；Fast/Batch/区域另计');
for(const [model,i,o,c] of [['deepseek-flash',.3,1.2,.006],['deepseek-v4-pro',1.32,3.96,.044]]){
 add('DeepSeek',model,i,o,c,i,i,deepseek,'高峰','UTC 工作日 01–04、06–10 点；中国法定节假日除外');
 add('DeepSeek',model,i/2,o/2,c/2,i/2,i/2,deepseek,'非高峰','其他时段及中国法定节假日；不是自动校验节假日后的实际账单');
}
for(const [model,i,o,c] of [['composer-2.5',.5,2.5,.2],['grok-4.7',2,6,.5],['grok-4.6',2,6,.5],['grok-4.5',2,6,.5],['gemini-3.1-pro',2,12,.2],['gemini-3.8-flash',.75,3.5,.075],['gpt-5.6-luna',.2,1.2,.02],['gpt-5.6-terra',2,12,.2],['muse-spark-1.3',1.25,4.25,.15]])add('Cursor 路由',model,i,o,c,i,i,cursor,'标准','仅适用于 Cursor 公示路由；Teams/Enterprise 第三方额外 $0.25/M，地区及 Max 模式另计');
for(const [model,i,o] of [['hunyuan-a13b',.5,2],['hunyuan-role-latest',2.4,9.6],['hunyuan-translation',1.2,3.6],['hunyuan-translation-lite',1,3],['hunyuan-turbos-vision',3,9],['hunyuan-t1-vision',3,9],['hunyuan-turbos-vision-video',3,9]])add('腾讯云',model,i,o,i,i,i,tencent,'后付费','旧平台公开刊例价；未公开缓存折扣，按输入计。Hy4 preview 无此页报价','CNY');
export const catalogue=rows;
for(const [model,i,o,c,w] of [['gpt-6-sol',2,10,.2,2.5],['gpt-5.6-luna',.2,1.2,.02,.25]]){
 const source=`https://developers.openai.com/api/docs/models/${model}`;
 add('OpenAI',model,i,o,c,w,w,source,'标准 · ≤272K');add('OpenAI',model,i*2,o*1.5,c*2,w*2,w*2,source,'标准 · >272K');
}
for(const [model,i,o,c,w,long] of [['gpt-5.6-terra',2,12,.2,2.5,true],['gpt-5.4',2.5,15,.25,2.5,true],['gpt-5.3-codex',1.75,14,.175,1.75,false],['gpt-5.2',1.75,14,.175,1.75,false]]){
 const source=`https://developers.openai.com/api/docs/models/${model}`;
 add('OpenAI',model,i,o,c,w,w,source,'标准 · 短上下文','未公开独立缓存写入价时按普通输入；历史记录按当前价格参考换算');
 if(long)add('OpenAI',model,i*2,o*1.5,c*2,w*2,w*2,source,'标准 · 长上下文','超过 272K 输入；不是累计会话 Token 阈值');
}
add('Anthropic','claude-haiku-5-5',.1,.5,.01,.125,.2,anthropic,'标准 · ≤100K');
add('Anthropic','claude-haiku-5-5',.5,2.5,.05,.625,1,anthropic,'标准 · >100K');
add('Google','gemini-3.8-flash',.75,3.75,.075,.75,.75,'https://ai.google.dev/gemini-api/docs/pricing','标准','2026-12-31 前促销价；缓存存储、工具费用不含在 Token 估算');
add('Google','gemini-3.5-flash',1.5,9,.15,1.5,1.5,'https://ai.google.dev/gemini-api/docs/pricing','标准','缓存存储、工具费用另计');
add('Google','gemini-3.5-flash-lite',.3,2.5,.03,.3,.3,'https://ai.google.dev/gemini-api/docs/pricing','标准','缓存存储、工具费用另计');
add('SpaceXAI','grok-4.7',2,6,2,2,2,'https://docs.x.ai/developers/models','标准','此页未公开缓存价，缓存暂按普通输入估算');
const tokenhub='https://cloud.tencent.com/document/product/1823/130055';
for(const [model,i,o,c] of [['Hy3',1,4,.25],['Hy4 preview',6,18,.3]])add('腾讯 TokenHub',model,i,o,c,i,i,tokenhub,'广州 · 后付费','API 等值参考；WorkBuddy 积分和订阅独立，不是平台实际账单','CNY');
add('腾讯 TokenHub','DeepSeek-V4.1-Flash',2,8,.04,2,2,tokenhub,'广州 · 高峰','API 等值参考；峰谷与地区、WorkBuddy 积分独立','CNY');
add('腾讯 TokenHub','DeepSeek-V4.1-Flash',1,4,.02,1,1,tokenhub,'广州 · 非高峰','API 等值参考；不是 WorkBuddy 实际账单','CNY');
for(const r of rows.filter(r=>r.vendor==='DeepSeek'&&r.model==='deepseek-flash'))r.aliases=['deepseek-v4-flash','deepseek-v4-flash-vision-exp'];
// Only exact model IDs are matched. A virtual tariff is read-only and never seeds user data.
export function defaultPrices(options){
 return options.flatMap(({provider,model})=>{
  const matches=rows.filter(r=>(r.model.toLowerCase()===model.toLowerCase()||r.aliases?.includes(model.toLowerCase()))&&(provider==='cursor'||r.vendor!=='Cursor 路由'));
  const r=(provider==='cursor'?matches.find(x=>x.vendor==='Cursor 路由'):provider==='workbuddy'?matches.find(x=>x.vendor==='腾讯 TokenHub'):undefined)||matches[0];
  if(!r)return [];
  return [{...r,id:`default:${provider}:${model}`,title:`${provider} / ${model}`,provider,model,date:r.verifiedAt,effectiveAt:0,updatedAt:0,default:true,note:`官方默认：${r.tier}；当前价格换算，非历史账单。${r.note}`}];
 });
}
export function referenceBudgets(tools){
 return tools.map(t=>{
  const model=String(t.model).toLowerCase();
  const matches=rows.filter(r=>(r.model.toLowerCase()===model||r.aliases?.includes(model))&&(r.vendor!=='Cursor 路由'||t.provider==='cursor'));
  const costs=matches.flatMap(r=>[r.cacheWrite,r.cacheWriteLong].map(w=>({rate:r,cost:(Math.max(0,Number(t.input)-Number(t.cacheRead)-Number(t.cacheWrite))*r.input+Number(t.cacheRead)*r.cacheRead+Number(t.cacheWrite)*w+Number(t.output)*r.output)/1e6})));
  if(!costs.length||Number(t.incomplete))return {provider:t.provider,model:t.model,available:false,records:Number(t.records),reason:costs.length?'输入或输出字段缺失':'未核验此型号公开价'};
  return {provider:t.provider,model:t.model,available:true,records:Number(t.records),currency:costs[0].rate.currency,min:Math.min(...costs.map(c=>c.cost)),max:Math.max(...costs.map(c=>c.cost)),source:costs[0].rate.source};
 });
}
