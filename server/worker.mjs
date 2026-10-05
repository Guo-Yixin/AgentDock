import {usageOverview,usageRecords,saveAssistantUsage,validatePrice} from './usage.mjs';
import {authStatus,createOwner,login,account} from './auth.mjs';
import {claimReminder,acknowledgeReminder} from './reminders.mjs';
import {migrateGoalGroups} from './goals.mjs';
import { goalList, goalGet, goalPut, goalLink, goalDelete, goalCandidates } from './goals.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { openStore, databaseError,canInitialize } from './store.mjs';
import { Collector } from './collector.mjs';
import { generateReport, refreshReports, reportMarkdown, validateSchedule, migrateLegacy, buildContext } from './workspace.mjs';
let store=null,collector=null, switching=false;let config=workerData;
let database={configured:Boolean(config.mysql),connected:false,message:config.issue||'请先配置 MySQL'};
let paused=false;let reportIssue='';let reportTimer, reporting=false, historyPending=true;const dirtyDates=new Set();
const collectionFailed=e=>{database.connected=false;database.message=databaseError(e);const active=collector;collector=null;void active?.stop();notify();};
const notify=(hint={type:'all'})=>parentPort.postMessage({event:'update',...hint});
const collectionUpdated=hint=>{if(hint?.dates)for(const date of hint.dates)if(Date.parse(date+'T00:00:00+08:00')>=Date.now()-30*86400000)dirtyDates.add(date);notify({type:'collection'});if(!reportTimer)reportTimer=setTimeout(()=>{reportTimer=null;void reportRefresh();},8000);};
function sourceList(){return config.sources.map(s=>({...s,state:paused?'paused':'missing',message:s.enabled?(paused?'采集已暂停':database.connected?'等待恢复采集':'数据库未连接，采集暂停'):'用户已停用采集',locations:[s.root],syncAt:null,count:0}));}
function collectionConfig(){return {...Object.fromEntries(config.sources.map(s=>[s.id,s.root])),home:config.home,disabled:config.sources.filter(s=>!s.enabled).map(s=>s.id)};}
async function reportRefresh(){if(!store||!database.connected||reporting||switching)return;reporting=true;try{await refreshReports(store,historyPending);if(!collector?.progress.active)historyPending=false;const pending=[...dirtyDates];for(const date of pending){await generateReport(store,{date});await generateReport(store,{date,kind:'weekly'});dirtyDates.delete(date);}reportIssue='';}catch{reportIssue='报告更新失败，可稍后重试';}finally{reporting=false;notify({type:'reports'});}}
async function connect(mysql,initialize=false){
 switching=true;const previousStore=store;await collector?.stop();collector=null;
 try{const candidate=await openStore(mysql,initialize);store=candidate;await previousStore?.close();config.mysql=mysql;historyPending=true;dirtyDates.clear();database={configured:true,connected:true,message:'MySQL 已连接'};collector=paused?null:new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);if(collector)void collector.start().catch(collectionFailed);}
 catch(e){store=previousStore;database={configured:Boolean(config.mysql),connected:false,message:e.message};if(store){try{await store.rows('SELECT 1');database.connected=true;database.message='已恢复原数据库连接';collector=paused?null:new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);if(collector)void collector.start().catch(collectionFailed);}catch{}}throw e;}
 finally{switching=false;notify();}
}
const handlers={
 usageOverview:args=>usageOverview(store,args),usageRecords:args=>usageRecords(store,args),usageAssistant:args=>saveAssistantUsage(store,args),pricePut:async args=>{const prices=await store.documents('price');if(prices.length>=200)throw new Error('单价规则最多 200 条，请整理旧规则');return store.putDocument('price',validatePrice(args));},priceDelete:id=>store.deleteDocument(id,'price'),
 authStatus:async token=>({...await authStatus(database.connected?store:null,token),initializeAllowed:!database.connected&&await canInitialize(config.mysql),message:database.message}),authCreate:args=>createOwner(store,args),authLogin:args=>login(store,args),authAccount:args=>account(store,args),
 pause:async value=>{if(value===paused)return {paused};paused=value;if(paused){await collector?.stop();collector=null;}else if(store&&database.connected){collector=new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);void collector.start().catch(collectionFailed);}notify();return {paused};},
 reportRefresh:async()=>{await reportRefresh();if(reportIssue)throw new Error(reportIssue);return {ok:true};},
 health:()=>({...database,paused,reportIssue,switching,legacyAvailable:existsSync(path.join(config.dataDir,'agentdock.sqlite'))}),
 overview:async()=>store&&database.connected&&!switching?{...await store.overview(collector?.sources||sourceList(),collector?.progress||{active:false,completed:0,total:0}),database}:{total:0,recent:0,needsAttention:0,today:0,doneToday:0,projects:[],sources:sourceList(),hourly:Array(24).fill(0),importing:false,importProgress:{completed:0,total:0},database,updatedAt:Date.now()},
 list:args=>store&&database.connected?store.list(args):{tasks:[],total:0,page:1,pageSize:30},
 goals:args=>goalList(store,args),goalGet:id=>goalGet(store,id),goalPut:args=>goalPut(store,args),goalLink:args=>goalLink(store,args),goalDelete:id=>goalDelete(store,id),goalCandidates:id=>goalCandidates(store,id),timeline:args=>store.timeline(args),taskGoals:id=>store.rows('SELECT goal_id id FROM ad_goal_sessions WHERE task_id=?',[id]),
 get:id=>store.get(id),patch:({id,patch})=>store.patch(id,patch),export:id=>store.export(id),
 configure:args=>connect(args.mysql,args.initialize),
 sources:async args=>{const previous=config.sources;await collector?.stop();config.sources=args;try{collector=store&&!paused?new Collector(store,collectionConfig(),collectionUpdated,collectionFailed):null;if(collector)if(!paused)void collector.start().catch(collectionFailed);}catch(e){config.sources=previous;throw e;}return true;},
 scan:async()=>{if(!paused&&collector)void collector.scan().catch(collectionFailed);return true;},
 reports:()=>store.documents('report'), reportGenerate:args=>generateReport(store,args),
 reportGet:id=>store.document(id,'report'), reportExport:async id=>{const r=await store.document(id,'report');if(!r)throw new Error('报告不存在');return reportMarkdown(r);},
 reportPatch:async({id,userText})=>store.transaction(async tx=>{const r=await tx.document(id,'report');if(!r)throw new Error('报告不存在');return tx.putDocument('report',{...r,userText:String(userText||'').slice(0,64000)});}),
 reportAI:async({id,text,model,usage})=>store.transaction(async tx=>{const r=await tx.document(id,'report');if(!r)throw new Error('报告不存在');return tx.putDocument('report',{...r,versions:[...(r.versions||[]),{text,model,usage,createdAt:Date.now()}].slice(-20)});}),
 schedules:()=>store.documents('schedule'),
 schedulePut:async input=>{if(input.taskId&&!await store.get(input.taskId))throw new Error('关联会话不存在');if(input.projectId){const [p]=await store.rows('SELECT COUNT(*) n FROM ad_tasks WHERE project_id=?',[input.projectId]);if(!Number(p.n))throw new Error('关联项目不存在');}const old=input.id?await store.document(input.id,'schedule'):null;const record=validateSchedule(input);record.notifiedAt=old?.start===record.start&&old?.reminderMinutes===record.reminderMinutes?old.notifiedAt:null;return store.putDocument('schedule',record);},
 scheduleDelete:id=>store.deleteDocument(id,'schedule'),
 reminders:async()=>{const now=Date.now();return(await store.documents('schedule')).filter(s=>!s.done&&!s.notifiedAt&&s.start-s.reminderMinutes*60000<=now&&s.end>now);},
 reminderClaim:args=>claimReminder(store,args),reminderAck:args=>acknowledgeReminder(store,args),
 events:args=>store.events(args),activityDays:args=>store.activityDays(args),
 migrate:async()=>{await collector?.stop();try{const result=await migrateLegacy(store,path.join(config.dataDir,'agentdock.sqlite'));await migrateGoalGroups(store);return result;}finally{collector=paused?null:new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);if(collector)void collector.start().catch(collectionFailed);}},
 migration:()=>store.document('legacy-migration','migration'),
 context:async args=>({...await buildContext(store,args.refs,args.range),title:'上下文预览'}),
 preview:id=>store.document(id,'preview'),previewSave:record=>store.putDocument('preview',record),
 chats:()=>store.documents('chat'),chatGet:id=>store.document(id,'chat'),chatPut:record=>store.putDocument('chat',record),chatDelete:id=>store.deleteDocument(id,'chat'),
 stop:async()=>{clearTimeout(reportTimer);clearInterval(healthTimer);await collector?.stop();await store?.close();return true;}
};
parentPort.on('message',async({id,method,args})=>{
 try{if(!handlers[method])throw new Error('未知接口');if((!store||!database.connected)&&!['authStatus','health','overview','list','configure','sources','pause','stop'].includes(method))throw new Error('请先配置并初始化 MySQL');if(switching&&!['health','overview'].includes(method))throw new Error('数据库正在切换，请稍后重试');const result=await handlers[method](args);parentPort.postMessage({id,result});if(['patch','configure','migrate','reportGenerate','reportPatch','reportAI','schedulePut','scheduleDelete','reminderAck','goalPut','goalLink','goalDelete'].includes(method))notify({type:method.startsWith('goal')?'goals':method.startsWith('report')?'reports':method.startsWith('schedule')||method.startsWith('reminder')?'schedules':method==='patch'?'tasks':'all',ids:args?.id?[args.id]:[]});}
 catch(e){parentPort.postMessage({id,error:e.code?databaseError(e):e.message});}
});
const healthTimer=setInterval(async()=>{
 if(switching)return;
 if(store){try{await store.rows('SELECT 1');database.connected=true;}catch(e){database.connected=false;database.message=databaseError(e);await collector?.stop();collector=null;notify();}}
 if(!database.connected&&config.mysql){try{await connect(config.mysql);}catch{}}
 else if(database.connected&&!collector&&!paused){collector=paused?null:new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);if(collector)void collector.start().catch(collectionFailed);}
 void reportRefresh();
},60000);
if(config.mysql){try{await connect(config.mysql);}catch{}}
parentPort.postMessage({event:'ready'});
