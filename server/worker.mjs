import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { openStore, databaseError } from './store.mjs';
import { Collector } from './collector.mjs';
import { generateReport, refreshReports, reportMarkdown, validateSchedule, migrateLegacy, buildContext } from './workspace.mjs';
let store=null,collector=null, switching=false;let config=workerData;
let database={configured:Boolean(config.mysql),connected:false,message:config.issue||'请先配置 MySQL'};
let reportTimer, reporting=false, historyPending=true;const dirtyDates=new Set();
const collectionFailed=e=>{database.connected=false;database.message=databaseError(e);const active=collector;collector=null;void active?.stop();notify();};
const notify=()=>parentPort.postMessage({event:'update'});
const collectionUpdated=hint=>{if(hint?.dates)for(const date of hint.dates)if(Date.parse(date+'T00:00:00+08:00')>=Date.now()-30*86400000)dirtyDates.add(date);notify();if(!reportTimer)reportTimer=setTimeout(()=>{reportTimer=null;void reportRefresh();},8000);};
function sourceList(){return config.sources.map(s=>({...s,state:'missing',message:s.enabled?'数据库未连接，采集暂停':'用户已停用采集',locations:[s.root],syncAt:null,count:0}));}
function collectionConfig(){return {...Object.fromEntries(config.sources.map(s=>[s.id,s.root])),home:config.home,disabled:config.sources.filter(s=>!s.enabled).map(s=>s.id)};}
async function reportRefresh(){if(!store||!database.connected||reporting||switching)return;reporting=true;try{await refreshReports(store,historyPending);if(!collector?.progress.active)historyPending=false;const pending=[...dirtyDates];dirtyDates.clear();for(const date of pending){await generateReport(store,{date});await generateReport(store,{date,kind:'weekly'});}}catch{}finally{reporting=false;notify();}}
async function connect(mysql,initialize=false){
 switching=true;const previousStore=store;await collector?.stop();collector=null;
 try{const candidate=await openStore(mysql,initialize);store=candidate;await previousStore?.close();config.mysql=mysql;historyPending=true;dirtyDates.clear();database={configured:true,connected:true,message:'MySQL 已连接'};collector=new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);void collector.start().catch(collectionFailed);}
 catch(e){store=previousStore;database={configured:Boolean(config.mysql),connected:false,message:e.message};if(store){try{await store.rows('SELECT 1');database.connected=true;database.message='已恢复原数据库连接';collector=new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);void collector.start().catch(collectionFailed);}catch{}}throw e;}
 finally{switching=false;notify();}
}
const handlers={
 health:()=>({...database,switching,legacyAvailable:existsSync(path.join(config.dataDir,'agentdock.sqlite'))}),
 overview:async()=>store&&database.connected&&!switching?{...await store.overview(collector?.sources||sourceList(),collector?.progress||{active:false,completed:0,total:0}),database}:{total:0,recent:0,needsAttention:0,today:0,doneToday:0,projects:[],sources:sourceList(),hourly:Array(24).fill(0),importing:false,importProgress:{completed:0,total:0},database,updatedAt:Date.now()},
 list:args=>store&&database.connected?store.list(args):{tasks:[],total:0,page:1,pageSize:30},
 get:id=>store.get(id),patch:({id,patch})=>store.patch(id,patch),export:id=>store.export(id),
 configure:args=>connect(args.mysql,args.initialize),
 sources:async args=>{const previous=config.sources;await collector?.stop();config.sources=args;try{collector=store?new Collector(store,collectionConfig(),collectionUpdated,collectionFailed):null;if(collector)void collector.start().catch(collectionFailed);}catch(e){config.sources=previous;throw e;}return true;},
 scan:async()=>{if(collector)void collector.scan().catch(collectionFailed);return true;},
 reports:()=>store.documents('report'), reportGenerate:args=>generateReport(store,args),
 reportGet:id=>store.document(id,'report'), reportExport:async id=>{const r=await store.document(id,'report');if(!r)throw new Error('报告不存在');return reportMarkdown(r);},
 reportPatch:async({id,userText})=>store.transaction(async tx=>{const r=await tx.document(id,'report');if(!r)throw new Error('报告不存在');return tx.putDocument('report',{...r,userText:String(userText||'').slice(0,64000)});}),
 reportAI:async({id,text,model,usage})=>store.transaction(async tx=>{const r=await tx.document(id,'report');if(!r)throw new Error('报告不存在');return tx.putDocument('report',{...r,versions:[...(r.versions||[]),{text,model,usage,createdAt:Date.now()}].slice(-20)});}),
 schedules:()=>store.documents('schedule'),
 schedulePut:async input=>{if(input.taskId&&!await store.get(input.taskId))throw new Error('关联会话不存在');if(input.projectId){const [p]=await store.rows('SELECT COUNT(*) n FROM ad_tasks WHERE project_id=?',[input.projectId]);if(!Number(p.n))throw new Error('关联项目不存在');}const old=input.id?await store.document(input.id,'schedule'):null;const record=validateSchedule(input);record.notifiedAt=old?.start===record.start&&old?.reminderMinutes===record.reminderMinutes?old.notifiedAt:null;return store.putDocument('schedule',record);},
 scheduleDelete:id=>store.deleteDocument(id,'schedule'),
 reminders:async()=>{const now=Date.now();return(await store.documents('schedule')).filter(s=>!s.done&&!s.notifiedAt&&s.start-s.reminderMinutes*60000<=now&&s.end>now);},
 reminderAck:async id=>{const s=await store.document(id,'schedule');if(!s)throw new Error('日程不存在');return store.putDocument('schedule',{...s,notifiedAt:Date.now()});},
 events:args=>store.events(args),activityDays:args=>store.activityDays(args),
 migrate:async()=>{await collector?.stop();try{return await migrateLegacy(store,path.join(config.dataDir,'agentdock.sqlite'));}finally{collector=new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);void collector.start().catch(collectionFailed);}},
 migration:()=>store.document('legacy-migration','migration'),
 context:async args=>({...await buildContext(store,args.refs,args.range),title:'上下文预览'}),
 preview:id=>store.document(id,'preview'),previewSave:record=>store.putDocument('preview',record),
 chats:()=>store.documents('chat'),chatGet:id=>store.document(id,'chat'),chatPut:record=>store.putDocument('chat',record),chatDelete:id=>store.deleteDocument(id,'chat'),
 stop:async()=>{clearTimeout(reportTimer);clearInterval(healthTimer);await collector?.stop();await store?.close();return true;}
};
parentPort.on('message',async({id,method,args})=>{
 try{if(!handlers[method])throw new Error('未知接口');if((!store||!database.connected)&&!['health','overview','list','configure','sources','stop'].includes(method))throw new Error('请先配置并初始化 MySQL');if(switching&&!['health','overview'].includes(method))throw new Error('数据库正在切换，请稍后重试');const result=await handlers[method](args);parentPort.postMessage({id,result});if(['patch','configure','migrate','reportGenerate','reportPatch','reportAI','schedulePut','scheduleDelete','reminderAck'].includes(method))notify();}
 catch(e){parentPort.postMessage({id,error:e.code?databaseError(e):e.message});}
});
const healthTimer=setInterval(async()=>{
 if(switching)return;
 if(store){try{await store.rows('SELECT 1');database.connected=true;}catch(e){database.connected=false;database.message=databaseError(e);await collector?.stop();collector=null;notify();}}
 if(!database.connected&&config.mysql){try{await connect(config.mysql);}catch{}}
 else if(database.connected&&!collector){collector=new Collector(store,collectionConfig(),collectionUpdated,collectionFailed);void collector.start().catch(collectionFailed);}
 void reportRefresh();
},60000);
if(config.mysql){try{await connect(config.mysql);}catch{}}
parentPort.postMessage({event:'ready'});
