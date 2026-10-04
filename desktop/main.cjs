const {app,BrowserWindow,Tray,Menu,ipcMain,dialog,shell,Notification,nativeImage}=require('electron');
const {fork}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
let win,tray,child,origin='',lastRoute='/',token='',quitting=false,quitPending=false,restarting=false,retries=0,reminderTimer;
const testing=process.env.AGENTDOCK_DESKTOP_TEST==='synthetic';
if(testing&&process.env.AGENTDOCK_DESKTOP_TEST_DATA){
 const target=path.resolve(process.env.AGENTDOCK_DESKTOP_TEST_DATA);
 if(!target.includes(path.join('artifacts','desktop-test')))throw new Error('测试目录无效');
 app.setPath('userData',target);
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>show());
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();if(quitPending)return;quitPending=true;void requestQuit();});
 app.on('window-all-closed',()=>{});
 app.whenReady().then(start).catch(()=>void showFailure());
}
async function requestQuit(){try{const dirty=await win?.webContents.executeJavaScript("Boolean(document.querySelector('[data-dirty=\"true\"]'))").catch(()=>false);if(dirty){const r=await dialog.showMessageBox(win,{type:'question',message:'修改尚未保存，仍要退出？',buttons:['返回保存','放弃修改并退出'],defaultId:0,cancelId:0});if(r.response!==1){show();return;}}quitting=true;clearInterval(reminderTimer);await stopBackend();app.quit();}finally{quitPending=false;}}
function preferences(){try{return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'desktop-preferences.json'),'utf8'));}catch{return {autoStart:false,notifications:false};}}
function show(){if(win){win.show();win.focus();}}
function trayMenu(paused=false){tray?.setContextMenu(Menu.buildFromTemplate([
 {label:'打开 AgentDock',click:show},
 {label:paused?'恢复采集':'暂停采集',click:async()=>{try{const r=await backend('/api/collection/pause',{paused:!paused});trayMenu(r.paused);}catch{void dialog.showMessageBox(win,{message:'服务暂不可用，请在设置中检查连接。'});}}},
 {type:'separator'},{label:'退出',click:()=>app.quit()}
]));}
async function backend(url,body,method='POST'){
 const response=await fetch(origin+url,{method:body===undefined?'GET':method,headers:{'X-AgentDock-Session':token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'本地服务不可用');return data;
}
function trusted(event){if(event.sender!==win?.webContents||!origin||new URL(event.senderFrame.url).origin!==origin)throw new Error('不可信的桌面请求');}
function handle(channel,fn){ipcMain.handle(channel,async(event,...args)=>{trusted(event);return fn(...args);});}
async function start(){
 app.setAppUserModelId('com.guoyixin.agentdock');
 win=new BrowserWindow({width:1440,height:960,minWidth:390,minHeight:600,show:false,title:'AgentDock',icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 win.webContents.on('will-prevent-unload',event=>{if(quitting)event.preventDefault();});win.removeMenu();win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(!origin||new URL(url).origin!==origin)event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_,permission,callback)=>callback(permission==='notifications'&&preferences().notifications===true));
 win.webContents.session.webRequest.onBeforeSendHeaders((details,callback)=>{
  if(origin&&details.url.startsWith(origin+'/'))details.requestHeaders['X-AgentDock-Session']=token;
  callback({requestHeaders:details.requestHeaders});
 });
 win.webContents.session.webRequest.onHeadersReceived((details,callback)=>{
  const headers={...details.responseHeaders};if(origin&&details.url.startsWith(origin+'/'))headers['Content-Security-Policy']=["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"];
  callback({responseHeaders:headers});
 });
 tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'icon.png')));tray.setToolTip('AgentDock · 智能体任务坞');tray.on('double-click',show);trayMenu();
 handle('ad:preferences',()=>preferences());
 handle('ad:set-preferences',value=>{
  if(!value||Object.entries(value).some(([k,v])=>k==='theme'?!['system','light','dark'].includes(v):!['autoStart','notifications','onboardingDone'].includes(k)||typeof v!=='boolean'))throw new Error('桌面设置无效');
  const p={...preferences(),...value};fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(path.join(app.getPath('userData'),'desktop-preferences.json'),JSON.stringify(p));
  if(!testing&&value.autoStart!==undefined)app.setLoginItemSettings({openAtLogin:p.autoStart,path:process.execPath});return p;
 });
 handle('ad:choose-source',async id=>{
  if(!['codex','claude','cursor','pi','deepseek','workbuddy'].includes(id))throw new Error('未知来源');
  const r=await dialog.showOpenDialog(win,{title:'选择工具数据目录（不是安装目录）',properties:['openDirectory']});return r.canceled?null:r.filePaths[0];
 });
 handle('ad:import-settings',async()=>{
  const r=await dialog.showOpenDialog(win,{title:'导入同一 Windows 用户的旧 AgentDock 配置',properties:['openFile'],filters:[{name:'AgentDock 本地配置',extensions:['json']}]});
  if(r.canceled)return {cancelled:true};const file=r.filePaths[0];if(fs.statSync(file).size>256*1024)throw new Error('配置文件过大');
  const result=await backend('/api/settings/import',{settings:JSON.parse(fs.readFileSync(file,'utf8'))});
  const oldIndex=path.join(path.dirname(file),'agentdock.sqlite'),target=path.join(app.getPath('userData'),'agentdock.sqlite');
  if(fs.existsSync(oldIndex)&&!fs.existsSync(target)&&fs.statSync(oldIndex).size<=256*1024*1024){
   const choice=await dialog.showMessageBox(win,{type:'question',message:'同时复制旧 AgentDock SQLite 索引用于迁移？',detail:'只复制索引到当前用户配置目录，保留原文件。随后可在数据库设置中手动迁移；原始 IDE 数据库不会复制。',buttons:['保留原处，稍后处理','复制索引'],defaultId:0,cancelId:0});
   if(choice.response===1)fs.copyFileSync(oldIndex,target,fs.constants.COPYFILE_EXCL);
  }
  return result;
 });
 handle('ad:check-update',async()=>{
  const r=await fetch('https://api.github.com/repos/Guo-Yixin/AgentDock/releases/latest',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
  if(r.status===404)return {current:app.isPackaged?app.getVersion():require('../package.json').version,latest:null};if(!r.ok)throw new Error('版本检查失败，请稍后重试');
  const release=await r.json();return {current:app.isPackaged?app.getVersion():require('../package.json').version,latest:String(release.tag_name).replace(/^v/,''),url:'https://github.com/Guo-Yixin/AgentDock/releases'};
 });
 handle('ad:open-downloads',()=>shell.openExternal('https://github.com/Guo-Yixin/AgentDock/releases'));
 // Retry is also available on the local error screen, which has no API access.
 ipcMain.handle('ad:retry',async event=>{if(event.sender!==win.webContents)throw new Error('无效请求');await launchBackend();return true;});
 await launchBackend();reminderTimer=setInterval(()=>void remind(),15000);
}
function rememberRoute(){const url=win?.webContents.getURL();if(origin&&url?.startsWith(origin+'/')){const u=new URL(url);lastRoute=(u.pathname+u.search).slice(0,32000);}}
async function launchBackend(){
 if(restarting||quitting)return;rememberRoute();restarting=true;await stopBackend();
 try{
  token=randomBytes(32).toString('hex');origin='';
  const root=app.isPackaged?path.join(process.resourcesPath,'backend'):path.resolve(__dirname,'..');
  const runtime=app.isPackaged?path.join(process.resourcesPath,'runtime','node.exe'):path.join(__dirname,'runtime','node.exe');
  if(!fs.existsSync(runtime))throw new Error('缺少独立运行时');
  const data=app.getPath('userData');fs.mkdirSync(data,{recursive:true});
  child=fork(path.join(root,'server','index.mjs'),[],{execPath:runtime,cwd:data,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'',AGENTDOCK_PORT:'0',AGENTDOCK_DATA:data,AGENTDOCK_SESSION_TOKEN:token,AGENTDOCK_DESKTOP:'1',...(testing?{AGENTDOCK_HOME:path.join(data,'empty-home')}:{} )}});
  const owned=child;await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('服务启动超时')),30000);
   owned.once('error',()=>{clearTimeout(timeout);reject(new Error('无法启动独立运行时'));});
   owned.once('exit',()=>{clearTimeout(timeout);reject(new Error('服务启动失败'));});
   owned.on('message',m=>{if(m?.event==='ready'&&Number.isInteger(m.port)&&m.port>0&&m.port<=65535){clearTimeout(timeout);origin=`http://127.0.0.1:${m.port}`;resolve();}});
  });
  owned.on('exit',()=>{if(child===owned&&!quitting&&!restarting){rememberRoute();child=null;origin='';if(retries++<2)setTimeout(()=>void launchBackend(),1000);else void showFailure();}});
  await win.loadURL(origin+lastRoute);show();
 }catch{await stopBackend();void showFailure();}finally{restarting=false;}
}
async function stopBackend(){
 const owned=child;child=null;if(!owned||owned.exitCode!==null)return;
 await new Promise(resolve=>{const timer=setTimeout(()=>{owned.kill();resolve();},5000);owned.once('exit',()=>{clearTimeout(timer);resolve();});if(owned.connected)owned.send({event:'shutdown'});else owned.kill();});
}
async function showFailure(){if(!win||quitting)return;await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<meta charset="utf-8"><title>AgentDock</title><body style="font:18px system-ui;padding:48px"><h1>本地服务暂不可用</h1><p>配置与 MySQL 数据均已保留。请重试或重新启动应用。</p><button onclick="window.agentdock.retry()">重新启动服务</button></body>'));show();}
async function remind(){
 if(!origin||!preferences().notifications||!Notification.isSupported())return;
 try{for(const s of await backend('/api/reminders')){
  const claim=await backend(`/api/reminders/${encodeURIComponent(s.id)}/claim`,{owner:'desktop'});if(!claim.claimed)continue;
  const n=new Notification({title:'AgentDock 日程提醒',body:s.title});
  n.on('click',()=>{if(origin)void win.loadURL(origin+'/calendar?schedule='+encodeURIComponent(s.id));show();});
  n.once('show',()=>void backend(`/api/reminders/${encodeURIComponent(s.id)}/ack`,{claim:claim.token}).catch(()=>{}));n.show();
 }}catch{ /* Connection state remains visible in the application. */ }
}
