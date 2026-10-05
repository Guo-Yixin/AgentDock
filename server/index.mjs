import {validateSource} from './sources.mjs';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {Worker} from 'node:worker_threads';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {dataDir,loadSettings,saveSettings,protect,mysqlConfig,validateDatabase,publicSettings,discoverSources,modelKey} from './config.mjs';
import {testDatabase} from './store.mjs';
import {ModelClient,sealPreview,redact} from './model.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),port=Number(process.env.AGENTDOCK_PORT||4317);
let mysql=null,issue='';try{mysql=mysqlConfig();}catch(e){issue=e.message;}
const worker=new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{home:process.env.AGENTDOCK_HOME||homedir(),dataDir,mysql,issue,sources:discoverSources()}});
const pending=new Map(),streams=new Set(),activeChats=new Set(),modelStreams=new Set();let sequence=0,workerError;
const ready=new Promise(resolve=>worker.on('message',m=>{if(m.event==='ready')resolve();if(m.event==='update')notify(m);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}}));
worker.on('error',e=>{workerError=e;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('后台服务异常'));}pending.clear();});
function notify(hint={type:'all'}){for(const s of streams)if(!s.destroyed)s.write(`event: update\ndata: ${JSON.stringify({type:hint.type||'all',ids:hint.ids||[],revision:Date.now()})}\n\n`);}
function rpc(method,args,timeout=60000){if(workerError)return Promise.reject(new Error('后台服务异常'));return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('后台操作超时，请检查状态后重试'));},timeout);pending.set(id,{resolve,reject,timer});worker.postMessage({id,method,args});});}
const app=Fastify({logger:false,bodyLimit:256*1024});
const sessionToken=process.env.AGENTDOCK_SESSION_TOKEN||'';
const cookieName=sessionToken?'ad_desktop_session':'ad_session';
const cookieToken=req=>{const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';return /^[A-Za-z0-9_-]{43}$/.test(value)?value:'';};
const setCookie=(reply,token='',maxAge=0)=>reply.header('Set-Cookie',`${cookieName}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
const attempts=new Map();let authInFlight=0;
async function authRPC(method,args){if(authInFlight>=2)throw Object.assign(new Error('登录操作繁忙，请稍后重试'),{statusCode:429});authInFlight++;try{return await rpc(method,args);}finally{authInFlight--;}}
const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173']);
app.addHook('onRequest',async(req,reply)=>{if(sessionToken){const supplied=Buffer.from(String(req.headers['x-agentdock-session']||'')),expected=Buffer.from(sessionToken);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply.code(403).send({error:'桌面会话认证失败'});}if(!['127.0.0.1','localhost'].includes(req.headers.host?.split(':')[0])||(req.headers.origin&&!origins.has(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'仅允许本机可信来源访问'});});
app.addHook('onRequest',async(req,reply)=>{
 if(!req.url.startsWith('/api/'))return;
 reply.header('Cache-Control','no-store');
 const pathname=req.url.split('?')[0];
 if(['/api/health','/api/auth/status','/api/auth/login','/api/auth/create'].includes(pathname))return;
 const state=await rpc('authStatus',cookieToken(req));
 if(state.user){req.account=state.user;return;}
 // First-install database configuration is available only before a target has been saved.
 if(state.initializeAllowed&&['/api/settings','/api/settings/database/initialize'].includes(pathname))return;
 if(!mysqlConfig()&&['/api/settings','/api/settings/database','/api/settings/database/test','/api/settings/database/initialize','/api/settings/import'].includes(pathname))return;
 return reply.code(401).send({error:'请先登录工作空间'});
});
app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode||400).send({error:e.validation?'请求参数格式错误':redact(e.message,['passwordEncrypted','keyEncrypted'])}));
const body=(properties,required=[])=>({body:{type:'object',additionalProperties:false,properties,required}});
const str=(maxLength=16000)=>({type:'string',maxLength});const integer={type:'integer'};const boolean={type:'boolean'};
const dbSchema=body({host:str(255),port:{type:'integer',minimum:1,maximum:65535},user:str(128),password:str(4096),database:str(64),tls:boolean,ca:str(16000)},['host','port','user','database']);
function candidate(input){return validateDatabase({...input,password:input.password||mysqlConfig()?.password||''});}
function modelClient(key){const s=loadSettings();const database=mysqlConfig();const test=process.env.AGENTDOCK_TEST_MODE==='synthetic'&&dataDir.includes(path.join('artifacts','e2e'))&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.AGENTDOCK_TEST_MODEL_URL||'');return new ModelClient({key:key||modelKey(s),model:s.model||'deepseek-flash',secrets:[database?.password],...(test?{base:process.env.AGENTDOCK_TEST_MODEL_URL}:{})});}
app.get('/api/auth/status',async req=>{const state=await rpc('authStatus',cookieToken(req));return {...state,setupAllowed:!mysqlConfig()||state.initializeAllowed};});
const credentials=body({username:str(64),password:{type:'string',minLength:6,maxLength:128},displayName:str(100),remember:boolean},['username','password']);
function throttle(req){const key=req.ip,now=Date.now(),value=attempts.get(key);if(value&&value.until>now&&value.count>=8)throw Object.assign(new Error('尝试过于频繁，请 5 分钟后重试'),{statusCode:429});if(!value||value.until<=now)attempts.set(key,{count:1,until:now+300000});else value.count++;}
app.post('/api/auth/create',{schema:credentials},async req=>{throttle(req);return authRPC('authCreate',req.body);});
app.post('/api/auth/login',{schema:credentials},async(req,reply)=>{throttle(req);try{const result=await authRPC('authLogin',{...req.body,desktop:Boolean(sessionToken)});attempts.delete(req.ip);setCookie(reply,result.token,result.maxAge);return {user:result.user};}catch(e){if(e.statusCode===429)throw e;return reply.code(401).send({error:'账号或密码错误'});}});
app.post('/api/auth/logout',async(req,reply)=>{await rpc('authAccount',{token:cookieToken(req),action:'logout'});setCookie(reply);for(const stream of [...streams,...modelStreams])if(stream.authToken===cookieToken(req))stream.end();return {ok:true};});
app.get('/api/account/sessions',async req=>rpc('authAccount',{token:cookieToken(req),action:'sessions'}));
app.post('/api/account/revoke',async req=>{const result=await rpc('authAccount',{token:cookieToken(req),action:'revoke'});for(const stream of [...streams,...modelStreams])if(stream.authToken!==cookieToken(req))stream.end();return result;});
app.patch('/api/account/profile',{schema:body({displayName:str(100)},['displayName'])},async req=>rpc('authAccount',{token:cookieToken(req),action:'profile',...req.body}));
app.post('/api/account/password',{schema:body({currentPassword:str(128),password:{type:'string',minLength:6,maxLength:128}},['currentPassword','password'])},async(req,reply)=>{throttle(req);const result=await authRPC('authAccount',{token:cookieToken(req),action:'password',...req.body});setCookie(reply);for(const stream of [...streams,...modelStreams])stream.end();return result;});
app.get('/api/health',async()=>({ok:!workerError,version:'0.5.0',database:await rpc('health')}));
app.get('/api/settings',async req=>{const settings=publicSettings();return {...settings,...(!req.account?{sources:[],hasKey:false,keyFromEnv:true}:{}),health:await rpc('health')};});
app.post('/api/settings/database/test',{schema:dbSchema},async req=>testDatabase(candidate(req.body)));
app.post('/api/settings/database',{schema:dbSchema},async req=>{
 if(process.env.AGENTDOCK_MYSQL_HOST)throw new Error('数据库由环境变量配置，请先移除环境变量再使用页面设置');
 const c=candidate(req.body),encrypted=protect(c.password);await rpc('configure',{mysql:c,initialize:true});const s=loadSettings();s.database={...c,passwordEncrypted:encrypted};delete s.database.password;saveSettings(s);return publicSettings(s);
});
app.post('/api/settings/database/initialize',async()=>{const c=mysqlConfig();if(!c)throw new Error('请先填写数据库配置');await rpc('configure',{mysql:c,initialize:true});return {ok:true};});
app.post('/api/settings/import',{schema:body({settings:{type:'object'}},['settings'])},async(req,reply)=>{
 if(!sessionToken||process.env.AGENTDOCK_DESKTOP!=='1')return reply.code(404).send({error:'仅桌面版可导入配置'});
 const current=loadSettings();if(current.database||current.keyEncrypted||Object.keys(current.sources||{}).length)throw new Error('已有配置，请先保留现有设置；导入不会覆盖已有配置');
 const input=req.body.settings;const next={model:typeof input.model==='string'?input.model.slice(0,100):'deepseek-flash',sources:{}};
 for(const id of ['codex','claude','cursor','pi','deepseek','workbuddy']){const value=input.sources?.[id];if(value){if(typeof value.root!=='string'||!path.isAbsolute(value.root))throw new Error('来源目录无效');next.sources[id]={root:value.root,enabled:value.enabled!==false};}}
 if(input.keyEncrypted)next.keyEncrypted=protect(protect(String(input.keyEncrypted),true));
 if(input.database?.passwordEncrypted){const c=mysqlConfig({database:input.database});next.database={...c,passwordEncrypted:protect(c.password)};delete next.database.password;await rpc('configure',{mysql:c,initialize:true});}
 saveSettings(next);await rpc('sources',discoverSources(next));return {ok:true};
});
app.get('/api/migration',async()=>({available:existsSync(path.join(dataDir,'agentdock.sqlite')),status:(await rpc('health')).connected?await rpc('migration'):null}));
app.post('/api/migration',async()=>rpc('migrate',null,180000));
app.post('/api/settings/model',{schema:body({key:str(4096),model:str(100)},[])},async req=>{if(req.body.key!==undefined&&!req.body.key.trim())throw new Error('API Key 不能为空');const s=loadSettings();if(req.body.key)s.keyEncrypted=protect(req.body.key.trim());if(req.body.model)s.model=req.body.model;saveSettings(s);return publicSettings(s);});
app.delete('/api/settings/model/key',async()=>{const s=loadSettings();delete s.keyEncrypted;saveSettings(s);return publicSettings(s);});
app.post('/api/settings/model/test',{schema:body({key:str(4096)})},async req=>({models:await modelClient(req.body.key).models()}));
app.get('/api/diagnostics',async()=>{const health=await rpc('health'),o=await rpc('overview');return {version:'0.5.0',platform:process.platform,database:{configured:health.configured,connected:health.connected,reportIssue:health.reportIssue},sources:o.sources.map(s=>({id:s.id,state:s.state,retained:s.count,discovered:s.discoveredCount??null,syncAt:s.syncAt}))};});
app.get('/api/sources/discover',()=>discoverSources());
app.post('/api/sources/:id/validate',{schema:body({root:str(4096)},['root'])},async req=>{if(!discoverSources().some(s=>s.id===req.params.id))throw new Error('未知来源');return validateSource(req.params.id,req.body.root);});
app.patch('/api/sources/:id',{schema:body({root:str(4096),enabled:boolean})},async req=>{if(!discoverSources().some(s=>s.id===req.params.id))throw new Error('未知来源');const s=loadSettings();s.sources||={};const old=s.sources[req.params.id]||{};s.sources[req.params.id]={...old,...req.body};if(req.body.root){const v=await validateSource(req.params.id,req.body.root);if(v.message.includes('安装目录')||v.message.includes('不能填写'))throw new Error(v.message);}await rpc('sources',discoverSources(s));saveSettings(s);return discoverSources(s);});
app.post('/api/sources/scan',async()=>rpc('scan'));
const usageQuery={querystring:{type:'object',additionalProperties:false,properties:{start:integer,end:integer,provider:str(32),model:str(128),project:str(128),page:{type:'integer',minimum:1,maximum:100000}},required:['start','end']}};
function usageRange(args){if(args.end<=args.start||args.end-args.start>366*86400000)throw new Error('请选择最多 366 天的有效范围');return args;}
app.post('/api/usage/history',{schema:body({mode:{type:'string',enum:['target','amount']},tokens:{type:'integer',minimum:0,maximum:9007199254740991},note:str(4000),start:str(10),end:str(10),allocations:{type:'array',minItems:1,maxItems:40,items:{type:'object',additionalProperties:false,properties:{provider:str(32),model:str(128),since:str(10),weight:{type:'integer',minimum:1,maximum:10000}},required:['provider','model','weight']}}},['mode','tokens','note','start','end','allocations'])},async req=>rpc('historyPut',{input:req.body,ownerId:req.account.id}));
app.delete('/api/usage/history',async req=>rpc('historyDisable',{ownerId:req.account.id}));
app.get('/api/usage',{schema:usageQuery},async req=>rpc('usageOverview',usageRange(req.query)));
app.get('/api/usage/records',{schema:usageQuery},async req=>rpc('usageRecords',usageRange(req.query)));
app.post('/api/usage/prices',{schema:body({provider:str(32),model:str(128),currency:{type:'string',enum:['CNY','USD']},date:str(10),input:{type:'number'},cacheRead:{type:'number'},cacheWrite:{type:'number'},cacheWriteLong:{type:'number'},output:{type:'number'}},['provider','model','currency','date','input','cacheRead','cacheWrite','cacheWriteLong','output'])},async req=>rpc('pricePut',req.body));
app.delete('/api/usage/prices/:id',async req=>rpc('priceDelete',req.params.id));
app.get('/api/overview',async()=>rpc('overview'));
app.get('/api/projects',async()=>(await rpc('overview')).projects);
app.get('/api/sources',async()=>(await rpc('overview')).sources);
app.get('/api/tasks',{schema:{querystring:{type:'object',properties:{q:str(1000),provider:str(32),project:str(128),status:str(32),page:{type:'integer',minimum:1,maximum:100000},recent:{type:'string',enum:['true','false']},pinned:{type:'string',enum:['true','false']},attention:{type:'string',enum:['true','false']}}}}},async req=>rpc('list',{...req.query,recent:req.query.recent==='true',attention:req.query.attention==='true',pinned:req.query.pinned==='true'}));
app.get('/api/tasks/:id',async(req,reply)=>(await rpc('get',req.params.id))||reply.code(404).send({error:'未找到会话'}));
app.patch('/api/tasks/:id',{schema:body({note:str(),summaryOverride:{anyOf:[str(),{type:'null'}]},manualStatus:{anyOf:[{type:'string',enum:['unconfirmed','in_progress','blocked','done']},{type:'null'}]},goalGroup:str(200),pinned:boolean,needsReview:boolean,branchId:str(128)})},async(req,reply)=>(await rpc('patch',{id:req.params.id,patch:req.body}))||reply.code(404).send({error:'未找到会话'}));
const goalSchema=body({title:str(200),projectId:str(128),description:str(),note:str(),status:{type:'string',enum:['not_started','in_progress','blocked','done','archived']},needsReview:boolean});
app.get('/api/goals',async req=>rpc('goals',req.query));
app.post('/api/goals',{schema:goalSchema},async req=>rpc('goalPut',req.body));
app.get('/api/goals/:id',async(req,reply)=>(await rpc('goalGet',req.params.id))||reply.code(404).send({error:'目标不存在'}));
app.patch('/api/goals/:id',{schema:goalSchema},async req=>rpc('goalPut',{...req.body,id:req.params.id}));
app.delete('/api/goals/:id',async req=>rpc('goalDelete',req.params.id));
app.get('/api/goals/:id/events',async req=>rpc('timeline',{goalId:req.params.id,cursor:req.query.cursor}));
app.get('/api/tasks/:id/goals',async req=>rpc('taskGoals',req.params.id));
app.get('/api/goals/:id/candidates',async req=>rpc('goalCandidates',req.params.id));
app.post('/api/goals/:id/sessions',{schema:body({taskId:str(128)},['taskId'])},async req=>rpc('goalLink',{id:req.params.id,...req.body}));
app.delete('/api/goals/:id/sessions/:taskId',async req=>rpc('goalLink',{...req.params,remove:true}));
app.get('/api/tasks/:id/events',async req=>rpc('timeline',{id:req.params.id,cursor:req.query.cursor,limit:req.query.limit}));
const markdown=(reply,text,filename)=>reply.type('text/markdown; charset=utf-8').header('Content-Disposition',`attachment; filename="${filename}"`).send(redact(text,[modelKey(),mysqlConfig()?.password]));
app.get('/api/export',async(req,reply)=>{const text=await rpc('export',req.query.task||null);return text===null?reply.code(404).send({error:'未找到会话'}):markdown(reply,text,'agentdock-summary.md');});
app.get('/api/reports',async()=>rpc('reports'));
app.post('/api/reports',{schema:body({kind:{type:'string',enum:['daily','weekly']},date:str(10),project:str(128),provider:str(32)},['date'])},async req=>rpc('reportGenerate',req.body));
app.get('/api/reports/:id',async(req,reply)=>(await rpc('reportGet',req.params.id))||reply.code(404).send({error:'报告不存在'}));
app.patch('/api/reports/:id',{schema:body({userText:str(64000)},['userText'])},async req=>rpc('reportPatch',{id:req.params.id,...req.body}));
app.post('/api/reports/:id/analysis',{schema:body({chatId:str(128)},['chatId'])},async req=>{const chat=await rpc('chatGet',req.body.chatId);const message=chat?.messages.filter(m=>m.role==='assistant'&&m.status==='complete').at(-1);if(!message)throw new Error('请先完成助手分析');return rpc('reportAI',{id:req.params.id,text:message.text,model:message.model,usage:message.usage});});
app.get('/api/reports/:id/export',async(req,reply)=>markdown(reply,await rpc('reportExport',req.params.id),'agentdock-report.md'));
app.get('/api/schedules',async()=>rpc('schedules'));
app.post('/api/schedules',{schema:body({id:str(128),title:str(200),note:str(),start:integer,end:integer,allDay:boolean,projectId:str(128),taskId:str(128),done:boolean,reminderMinutes:{type:'integer',enum:[0,5,15,30,60,1440]}},['title','start','end'])},async req=>rpc('schedulePut',req.body));
app.delete('/api/schedules/:id',async req=>rpc('scheduleDelete',req.params.id));
app.get('/api/reminders',async()=>rpc('reminders'));
app.post('/api/reminders/:id/claim',{schema:body({owner:{type:'string',enum:['desktop','browser']}},['owner'])},async req=>rpc('reminderClaim',{id:req.params.id,...req.body}));
app.post('/api/reminders/:id/ack',{schema:body({claim:str(128)})},async req=>rpc('reminderAck',{id:req.params.id,...req.body}));
app.post('/api/collection/pause',{schema:body({paused:boolean},['paused'])},async req=>rpc('pause',req.body.paused));
app.post('/api/reports/refresh',async()=>rpc('reportRefresh'));
app.get('/api/calendar',{schema:{querystring:{type:'object',properties:{start:integer,end:integer,project:str(128),provider:str(32)},required:['start','end']}}},async req=>{if(req.query.end<=req.query.start||req.query.end-req.query.start>62*86400000)throw new Error('请查询最多 62 天的有效范围');return {days:await rpc('activityDays',req.query),events:await rpc('events',req.query),schedules:await rpc('schedules')};});
app.post('/api/assistant/context',{schema:body({refs:{type:'array',minItems:1,maxItems:40,items:{type:'object',additionalProperties:false,properties:{id:str(128),type:{type:'string',enum:['task','project','report','schedule','goal']},includeTranscript:boolean,branchId:str(128)},required:['id','type']}},range:{type:'object',additionalProperties:false,properties:{start:integer,end:integer}}},['refs'])},async req=>{const preview=await rpc('context',req.body);const c=mysqlConfig();const safe=sealPreview(preview,[modelKey(),c?.password]);await rpc('previewSave',safe);return safe;});
app.get('/api/assistant/chats',async()=>rpc('chats'));
app.get('/api/assistant/chats/:id',async(req,reply)=>(await rpc('chatGet',req.params.id))||reply.code(404).send({error:'聊天不存在'}));
app.delete('/api/assistant/chats/:id',async req=>rpc('chatDelete',req.params.id));
app.post('/api/assistant/generate',{schema:body({previewId:str(128),fingerprint:str(64),question:str(8000),chatId:str(128),reportId:str(128)},['previewId','fingerprint','question'])},async(req,reply)=>{
 const preview=await rpc('preview',req.body.previewId);if(!preview||preview.expiresAt<Date.now()||preview.fingerprint!==req.body.fingerprint)throw new Error('预览已过期或发生变化，请重新预览');
 if(!req.body.question.trim())throw new Error('请输入问题');const client=modelClient();if(!client.key)throw new Error('请先配置 DeepSeek API Key');
 let chat=req.body.chatId?await rpc('chatGet',req.body.chatId):null;if(req.body.chatId&&!chat)throw new Error('聊天不存在');chat||={id:randomUUID(),title:redact(req.body.question,client.secrets).slice(0,60),messages:[]};if(activeChats.has(chat.id))throw new Error('该聊天正在生成，请先停止或等待完成');
 if(req.body.reportId&&!preview.sources.some(s=>s.type==='report'&&s.id===req.body.reportId))throw new Error('报告必须包含在预览中');
 const history=chat.messages;const question=redact(req.body.question,client.secrets);chat.messages=[...history,{role:'user',text:question,preview,createdAt:Date.now()}];activeChats.add(chat.id);try{chat=await rpc('chatPut',chat);}catch(e){activeChats.delete(chat.id);throw e;}
 reply.hijack();const stream=reply.raw;stream.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
 const send=(event,data)=>{if(!stream.destroyed)stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};send('chat',{id:chat.id});stream.authToken=cookieToken(req);modelStreams.add(stream);const controller=new AbortController();stream.on('close',()=>controller.abort());let text='';const heartbeat=setInterval(()=>{if(!stream.destroyed)stream.write(': heartbeat\n\n');},10000);
 try{const result=await client.generate({question,preview,history,signal:controller.signal,onDelta:delta=>{text+=delta;send('delta',{text:delta});}});const usageId=randomUUID(),createdAt=Date.now();await rpc('usageAssistant',{id:usageId,model:result.model,usage:result.usage,timestamp:createdAt});chat.messages.push({role:'assistant',...result,usageId,sources:preview.sources,createdAt,status:'complete'});await rpc('chatPut',chat);if(req.body.reportId){if(!preview.sources.some(s=>s.type==='report'&&s.id===req.body.reportId))throw new Error('报告必须包含在预览中');await rpc('reportAI',{id:req.body.reportId,...result});}send('done',result);}
 catch(e){const error=controller.signal.aborted?'已停止生成':redact(e.message,client.secrets);chat.messages.push({role:'assistant',text,sources:preview.sources,status:'interrupted',error,createdAt:Date.now()});await rpc('chatPut',chat).catch(()=>{});send('error',{error});}finally{modelStreams.delete(stream);activeChats.delete(chat.id);clearInterval(heartbeat);stream.end();}
});
app.get('/api/events',async(req,reply)=>{reply.hijack();const stream=reply.raw;stream.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});stream.write('retry: 3000\nevent: update\ndata: connected\n\n');stream.authToken=cookieToken(req);streams.add(stream);const timer=setInterval(async()=>{try{if(!(await rpc('authStatus',stream.authToken)).user){stream.end();return;}if(!stream.destroyed)stream.write(': heartbeat\n\n');}catch{stream.end();}},15000);stream.on('close',()=>{clearInterval(timer);streams.delete(stream);});});
const client=path.join(root,'dist','client');if(existsSync(client)){await app.register(fastifyStatic,{root:client});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'未知接口'}):reply.sendFile('index.html'));}else app.get('/',(_,reply)=>reply.type('text/plain').send('请先运行 npm run build，或打开开发服务器。'));
await ready;try{await app.listen({host:'127.0.0.1',port});const actualPort=app.server.address().port;origins.add(`http://127.0.0.1:${actualPort}`);origins.add(`http://localhost:${actualPort}`);if(process.send)process.send({event:'ready',port:actualPort});else console.log(`AgentDock is ready at http://127.0.0.1:${actualPort}`);}catch(e){await worker.terminate();console.error(e.code==='EADDRINUSE'?'端口占用，请修改 AGENTDOCK_PORT':'服务无法启动');process.exitCode=1;}
let stopping=false;async function shutdown(){if(stopping)return;stopping=true;for(const s of [...streams,...modelStreams])s.end();await app.close();await rpc('stop').catch(()=>{});await worker.terminate();}process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());

if(process.send){process.on('message',m=>{if(m?.event==='shutdown')void shutdown().finally(()=>process.disconnect());});process.once('disconnect',()=>void shutdown());}
