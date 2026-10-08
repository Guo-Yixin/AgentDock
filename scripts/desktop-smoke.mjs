import {spawn,execFileSync} from 'node:child_process';
import electronExe from 'electron';
import {_electron,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
import path from 'node:path';
process.env.NO_PROXY=[process.env.NO_PROXY,'127.0.0.1','localhost'].filter(Boolean).join(',');
const data=path.resolve('artifacts/desktop-test',String(Date.now()));await mkdir(data,{recursive:true});
const env={...process.env,AGENTDOCK_DESKTOP_TEST:'synthetic',AGENTDOCK_DESKTOP_TEST_DATA:data,NO_PROXY:'127.0.0.1,localhost'};
for(const key of Object.keys(env))if(key.startsWith('AGENTDOCK_MYSQL_')||['AGENTDOCK_DEEPSEEK_API_KEY','DEEPSEEK_API_KEY','AGENTDOCK_SESSION_TOKEN'].includes(key))delete env[key];
const accountTest=process.env.AGENTDOCK_DESKTOP_ACCOUNT_TEST==='1';
if(accountTest){
 const {testStore}=await import('../tests/mysql-helper.mjs');const {createOwner}=await import('../server/auth.mjs');const {testAccount}=await import('../tests/account-fixture.mjs');
 const {store,config}=await testStore('agentdock_e2e_desktop');try{await createOwner(store,testAccount);}finally{await store.close();}
 for(const key of ['host','port','user','password','database'])env['AGENTDOCK_MYSQL_'+key.toUpperCase()]=String(config[key]);env.AGENTDOCK_MYSQL_TLS=String(config.tls);
}
const exe=process.env.AGENTDOCK_DESKTOP_EXE;if(exe&&!['release','artifacts'].some(dir=>path.resolve(exe).startsWith(path.resolve(dir)+path.sep)))throw new Error('只允许测试工作区内的桌面程序');
let desktop,url;
// Navigate through the visible group toggle on small CI desktops as a user would.
async function navigate(window,name){
 await window.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const nav=window.getByRole('navigation',{name:'主导航'}),target=nav.getByRole('button',{name,exact:true,includeHidden:true});
 if(!await target.isVisible())await target.locator('xpath=ancestor::section[contains(@class,"nav-group")]').locator('.nav-group-toggle').click();
 await target.click();
}
try{
 console.log('启动桌面应用');desktop=await _electron.launch({...(exe?{executablePath:exe,args:[]}:{args:['desktop/main.cjs']}),env,timeout:60000});
 console.log('桌面进程已连接');const window=await desktop.firstWindow();await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,740));await window.waitForURL('http://127.0.0.1:*/**',{timeout:60000});url=new URL(window.url()).origin;
 await expect(window.getByText(accountTest?'登录你的工作空间':'配置数据库',{exact:true})).toBeVisible();
 const prefs=await window.evaluate(()=>window.agentdock.preferences());expect(prefs).toEqual({autoStart:false,notifications:false});
 expect(await window.evaluate(()=>typeof window.require)).toBe('undefined');
 const security=await desktop.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
 expect(security).toEqual({sandbox:true,contextIsolation:true,nodeIntegration:false});
 expect((await fetch(url+'/api/health')).status).toBe(403);
 expect((await window.evaluate(async()=> (await fetch('/api/health')).json())).version).toBe(version);
 if(accountTest){
  await window.getByLabel('登录账号').fill('audit_test_owner');
  const password=window.getByLabel('登录密码',{exact:true});
  await password.fill('Synthetic-only-pass!');await window.getByRole('button',{name:'登录工作空间',exact:true}).click();
  await window.getByLabel('打开账号中心').click();const input=window.getByLabel('更换头像');
  for(let i=0;i<2;i++){await input.setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('broken image')});await expect(window.getByRole('alert')).toContainText('图片无法解码');expect(await input.inputValue()).toBe('');}
  const file=process.env.AGENTDOCK_AVATAR_FILE||path.join(homedir(),'Desktop','WallPaper','头像.jpg');if(!existsSync(file))throw new Error('真实头像验收文件不存在');
  await input.setInputFiles(file);await expect(window.getByRole('status')).toContainText('头像已保存');await window.reload();
  const avatar=window.locator('.user .avatar img');await expect(avatar).toBeVisible();expect(await avatar.evaluate(e=>[e.naturalWidth,e.naturalHeight])).toEqual([128,128]);
  expect(await window.evaluate(async()=> (await (await fetch('/api/auth/status')).json()).user.avatar.startsWith('data:image/png;base64,'))).toBe(true);
  await window.screenshot({path:'artifacts/screenshots/desktop-avatar.png'});
  console.log('真实 JPEG、损坏图片重复选择、128×128 PNG 保存与刷新恢复验证通过（隔离 MySQL）');
  await navigate(window,'工作台');
 }
 await window.getByRole('button',{name:'查看演示体验',exact:true}).click();await expect(window.getByText(/演示模式 · 所有任务/)).toBeVisible();
 await window.getByLabel('界面主题').selectOption('dark');await expect(window.locator('html')).toHaveAttribute('data-theme','dark');
 await window.getByRole('button',{name:/查看跨工具任务流/}).click();await expect.poll(()=>window.locator('.task-row').first().evaluate(el=>getComputedStyle(el).backgroundColor===getComputedStyle(document.querySelector('.topbar')).backgroundColor)).toBe(true);await window.screenshot({path:'artifacts/screenshots/desktop-smoke.png',animations:'disabled'});
 for(const [width,height] of [[1440,960],[1200,740],[960,600],[390,600]]){
  await desktop.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
  await window.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect.poll(()=>window.locator('.sidebar nav').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  if(width<761)await window.getByLabel('打开导航').click();const toggle=window.locator('.sidebar-sources .disclosure-toggle');if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
  const state=()=>window.locator('.nav-group-toggle').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-expanded'))),original=await state();
  for(let repeat=0;repeat<2;repeat++){await toggle.click();for(const button of await window.locator('.source-nav button').all())expect(await button.evaluate(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);await toggle.click();await expect.poll(state).toEqual(original);}
  if(width<761){const backdrop=window.getByLabel('关闭导航'),box=await backdrop.boundingBox();await backdrop.click({position:{x:box.width-10,y:10}});}
  await window.locator('.task-main').first().click();const dialog=window.getByRole('dialog');await expect(dialog).toBeVisible();const box=await dialog.boundingBox(),viewport=await window.evaluate(()=>({width:innerWidth,height:innerHeight}));expect(box.width).toBeLessThanOrEqual(1120);expect(box.height).toBeLessThanOrEqual(viewport.height-47);expect(Math.abs(box.x+box.width/2-viewport.width/2)).toBeLessThan(2);await window.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  expect(await window.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,740));
 await window.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await navigate(window,'记忆库');await window.getByRole('button',{name:'新建记忆',exact:true}).click();await window.getByLabel('记忆标题').fill('桌面演示记忆');await window.getByLabel('记忆内容',{exact:true}).fill('桌面与网页使用同一套交互');await window.getByRole('button',{name:'保存记忆',exact:true}).click();await expect(window.locator('.studio-item').filter({hasText:'桌面演示记忆'})).toBeVisible();
 await navigate(window,'工作流');await window.getByRole('button',{name:'启动工作流',exact:true}).click();await window.getByRole('button',{name:'确认启动'}).click();await window.getByLabel('工作流步骤结论').fill('桌面步骤验收通过');await window.getByRole('button',{name:'确认本步'}).click();await window.getByRole('navigation',{name:'工作流内容页面'}).getByRole('button',{name:'已保存步骤'}).click();await expect(window.locator('.workflow-step:visible').first()).toContainText('桌面步骤验收通过');await window.screenshot({path:'artifacts/screenshots/desktop-workflow.png',animations:'disabled'});
 await window.getByRole('button',{name:'折叠侧边栏'}).click();await expect(window.locator('.sidebar')).toHaveCSS('width','72px');await navigate(window,'工作台');await expect(window.locator('.brand-mark').first()).toBeVisible();await window.reload();await expect(window.locator('.sidebar')).toHaveCSS('width','72px');await window.getByRole('button',{name:'展开侧边栏'}).click();await expect(window.locator('.sidebar')).toHaveCSS('width','232px');
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
 expect(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
 expect((await window.evaluate(async()=> (await fetch('/api/health')).json())).ok).toBe(true);
 const second=spawn(exe||electronExe,exe?[]:['desktop/main.cjs'],{env,windowsHide:true,stdio:'ignore'});const secondExit=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{second.kill();reject(new Error('第二实例未退出'));},10000);second.once('error',reject);second.once('exit',code=>{clearTimeout(timeout);resolve(code);});});expect(secondExit).toBe(0);await expect.poll(()=>desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
 const reloaded=window.waitForEvent('framenavigated',{predicate:frame=>frame===window.mainFrame()&&frame.url().startsWith('http://127.0.0.1:'),timeout:30000});const parent=await desktop.evaluate(()=>process.pid);execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ParentProcessId -eq [int]$env:AD_TEST_PARENT -and $_.CommandLine -match 'server.index.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],{env:{...process.env,AD_TEST_PARENT:String(parent)},windowsHide:true});
 await reloaded;url=new URL(window.url()).origin;await expect(window.locator('html')).toHaveAttribute('data-theme','dark');expect((await fetch(url+'/api/health')).status).toBe(403);

 await desktop.close();desktop=null;
 await expect.poll(async()=>{try{await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});return false;}catch{return true;}},{timeout:10000}).toBe(true);
 console.log('桌面沙箱、会话认证、演示、主题、折叠布局与标识、记忆工作流、单实例、故障恢复、托盘隐藏与独立服务退出验证通过');
}finally{await desktop?.close();}
