import {randomUUID} from 'node:crypto';
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
const pending=new Map(),streams=new Set(),activeChats=new Set();let sequence=0,workerError;
const ready=new Promise(resolve=>worker.on('message',m=>{if(m.event==='ready')resolve();if(m.event==='update')notify();if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}}));
worker.on('error',e=>{workerError=e;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('后台服务异常'));}pending.clear();});
function notify(){for(const s of streams)if(!s.destroyed)s.write(`event: update\ndata: ${Date.now()}\n\n`);}
function rpc(method,args,timeout=60000){if(workerError)return Promise.reject(new Error('后台服务异常'));return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('后台操作超时，请检查状态后重试'));},timeout);pending.set(id,{resolve,reject,timer});worker.postMessage({id,method,args});});}
const app=Fastify({logger:false,bodyLimit:256*1024});
const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173']);
app.addHook('onRequest',async(req,reply)=>{if(!['127.0.0.1','localhost'].includes(req.headers.host?.split(':')[0])||(req.headers.origin&&!origins.has(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site')return reply.code(403).send({error:'仅允许本机可信来源访问'});});
app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode||400).send({error:e.validation?'请求参数格式错误':redact(e.message,['passwordEncrypted','keyEncrypted'])}));
const body=(properties,required=[])=>({body:{type:'object',additionalProperties:false,properties,required}});
const str=(maxLength=16000)=>({type:'string',maxLength});const integer={type:'integer'};const boolean={type:'boolean'};
const dbSchema=body({host:str(255),port:{type:'integer',minimum:1,maximum:65535},user:str(128),password:str(4096),database:str(64),tls:boolean,ca:str(16000)},['host','port','user','database']);
function candidate(input){return validateDatabase({...input,password:input.password||mysqlConfig()?.password||''});}
function modelClient(key){const s=loadSettings();const database=mysqlConfig();const test=process.env.AGENTDOCK_TEST_MODE==='synthetic'&&dataDir.includes(path.join('artifacts','e2e'))&&/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.AGENTDOCK_TEST_MODEL_URL||'');return new ModelClient({key:key||modelKey(s),model:s.model||'deepseek-flash',secrets:[database?.password],...(test?{base:process.env.AGENTDOCK_TEST_MODEL_URL}:{})});}
app.get('/api/health',async()=>({ok:!workerError,version:'0.2.0',database:await rpc('health')}));
app.get('/api/settings',async()=>({...publicSettings(),health:await rpc('health')}));
app.post('/api/settings/database/test',{schema:dbSchema},async req=>testDatabase(candidate(req.body)));
app.post('/api/settings/database',{schema:dbSchema},async req=>{
 if(process.env.AGENTDOCK_MYSQL_HOST)throw new Error('数据库由环境变量配置，请先移除环境变量再使用页面设置');
 const c=candidate(req.body),encrypted=protect(c.password);await rpc('configure',{mysql:c,initialize:true});const s=loadSettings();s.database={...c,passwordEncrypted:encrypted};delete s.database.password;saveSettings(s);return publicSettings(s);
});
app.post('/api/settings/database/initialize',async()=>{const c=mysqlConfig();if(!c)throw new Error('请先填写数据库配置');await rpc('configure',{mysql:c,initialize:true});return {ok:true};});
app.get('/api/migration',async()=>({available:existsSync(path.join(dataDir,'agentdock.sqlite')),status:(await rpc('health')).connected?await rpc('migration'):null}));
app.post('/api/migration',async()=>rpc('migrate',null,180000));
app.post('/api/settings/model',{schema:body({key:str(4096),model:str(100)},[])},async req=>{if(req.body.key!==undefined&&!req.body.key.trim())throw new Error('API Key 不能为空');const s=loadSettings();if(req.body.key)s.keyEncrypted=protect(req.body.key.trim());if(req.body.model)s.model=req.body.model;saveSettings(s);return publicSettings(s);});
app.delete('/api/settings/model/key',async()=>{const s=loadSettings();delete s.keyEncrypted;saveSettings(s);return publicSettings(s);});
app.post('/api/settings/model/test',{schema:body({key:str(4096)})},async req=>({models:await modelClient(req.body.key).models()}));
app.get('/api/sources/discover',()=>discoverSources());
app.patch('/api/sources/:id',{schema:body({root:str(4096),enabled:boolean})},async req=>{if(!discoverSources().some(s=>s.id===req.params.id))throw new Error('未知来源');const s=loadSettings();s.sources||={};const old=s.sources[req.params.id]||{};s.sources[req.params.id]={...old,...req.body};if(req.body.root&&!path.isAbsolute(req.body.root))throw new Error('请填写绝对数据目录');await rpc('sources',discoverSources(s));saveSettings(s);return discoverSources(s);});
app.post('/api/sources/scan',async()=>rpc('scan'));
app.get('/api/overview',async()=>rpc('overview'));
app.get('/api/projects',async()=>(await rpc('overview')).projects);
app.get('/api/sources',async()=>(await rpc('overview')).sources);
app.get('/api/tasks',{schema:{querystring:{type:'object',properties:{q:str(1000),provider:str(32),project:str(128),status:str(32),page:{type:'integer',minimum:1,maximum:100000},recent:{type:'string',enum:['true','false']}}}}},async req=>rpc('list',{...req.query,recent:req.query.recent==='true'}));
app.get('/api/tasks/:id',async(req,reply)=>(await rpc('get',req.params.id))||reply.code(404).send({error:'未找到会话'}));
app.patch('/api/tasks/:id',{schema:body({note:str(),summaryOverride:{anyOf:[str(),{type:'null'}]},manualStatus:{anyOf:[{type:'string',enum:['unconfirmed','in_progress','blocked','done']},{type:'null'}]},goalGroup:str(200),pinned:boolean,branchId:str(128)})},async(req,reply)=>(await rpc('patch',{id:req.params.id,patch:req.body}))||reply.code(404).send({error:'未找到会话'}));
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
app.post('/api/reminders/:id/ack',async req=>rpc('reminderAck',req.params.id));
app.get('/api/calendar',{schema:{querystring:{type:'object',properties:{start:integer,end:integer,project:str(128),provider:str(32)},required:['start','end']}}},async req=>{if(req.query.end<=req.query.start||req.query.end-req.query.start>62*86400000)throw new Error('请查询最多 62 天的有效范围');return {days:await rpc('activityDays',req.query),events:await rpc('events',req.query),schedules:await rpc('schedules')};});
app.post('/api/assistant/context',{schema:body({refs:{type:'array',minItems:1,maxItems:40,items:{type:'object',additionalProperties:false,properties:{id:str(128),type:{type:'string',enum:['task','project','report','schedule']},includeTranscript:boolean,branchId:str(128)},required:['id','type']}},range:{type:'object',additionalProperties:false,properties:{start:integer,end:integer}}},['refs'])},async req=>{const preview=await rpc('context',req.body);const c=mysqlConfig();const safe=sealPreview(preview,[modelKey(),c?.password]);await rpc('previewSave',safe);return safe;});
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
 const send=(event,data)=>{if(!stream.destroyed)stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};send('chat',{id:chat.id});const controller=new AbortController();stream.on('close',()=>controller.abort());let text='';const heartbeat=setInterval(()=>{if(!stream.destroyed)stream.write(': heartbeat\n\n');},10000);
 try{const result=await client.generate({question,preview,history,signal:controller.signal,onDelta:delta=>{text+=delta;send('delta',{text:delta});}});chat.messages.push({role:'assistant',...result,sources:preview.sources,createdAt:Date.now(),status:'complete'});await rpc('chatPut',chat);if(req.body.reportId){if(!preview.sources.some(s=>s.type==='report'&&s.id===req.body.reportId))throw new Error('报告必须包含在预览中');await rpc('reportAI',{id:req.body.reportId,...result});}send('done',result);}
 catch(e){const error=controller.signal.aborted?'已停止生成':redact(e.message,client.secrets);chat.messages.push({role:'assistant',text,sources:preview.sources,status:'interrupted',error,createdAt:Date.now()});await rpc('chatPut',chat).catch(()=>{});send('error',{error});}finally{activeChats.delete(chat.id);clearInterval(heartbeat);stream.end();}
});
app.get('/api/events',async(req,reply)=>{reply.hijack();const stream=reply.raw;stream.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});stream.write('retry: 3000\nevent: update\ndata: connected\n\n');streams.add(stream);const timer=setInterval(()=>{if(!stream.destroyed)stream.write(': heartbeat\n\n');},15000);stream.on('close',()=>{clearInterval(timer);streams.delete(stream);});});
const client=path.join(root,'dist','client');if(existsSync(client)){await app.register(fastifyStatic,{root:client});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'未知接口'}):reply.sendFile('index.html'));}else app.get('/',(_,reply)=>reply.type('text/plain').send('请先运行 npm run build，或打开开发服务器。'));
await ready;try{await app.listen({host:'127.0.0.1',port});console.log(`AgentDock is ready at http://127.0.0.1:${port}`);}catch(e){await worker.terminate();console.error(e.code==='EADDRINUSE'?'端口占用，请修改 AGENTDOCK_PORT':'服务无法启动');process.exitCode=1;}
async function shutdown(){for(const s of streams)s.end();await app.close();await rpc('stop').catch(()=>{});await worker.terminate();}process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
