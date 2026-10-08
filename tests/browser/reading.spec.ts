import {test,expect,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {section,reveal} from './navigation';

const sizes=[{width:1920,height:1080},{width:1440,height:900},{width:1366,height:768},{width:960,height:600},{width:390,height:844},{width:390,height:600}];
const longText='# 阅读标题\n\n**重点**、*强调*与 `代码`。\n\n1. 第一项\n2. 第二项\n\n- 无序列表\n\n```ts\nconst value = 1;\n```\n\n'+Array.from({length:80},(_,i)=>`段落 ${i}：目标、摘要和报告应在指定阅读区内连续阅读。`).join('\n\n');
const marked='<environment_context>隐藏的系统上下文</environment_context>\n[Image #1]\n<<ImageDisplayed>>\n[图片附件：synthetic.jpg]\n'+longText;

async function bounded(page:Page){
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const overflow=await page.locator('.content').evaluate(root=>{const edge=root.getBoundingClientRect();return [...root.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('[hidden],.reading-body,.chat-stream')).filter(e=>{const r=e.getBoundingClientRect();return r.bottom>edge.bottom+2||r.right>edge.right+2;}).map(e=>e.getAttribute('aria-label')||e.textContent);});
 expect(overflow).toEqual([]);
}
test('六种窗口下来源反复展开完整占位，关闭恢复导航，六来源点击没有穿透',async({page})=>{
 test.setTimeout(60000);
 for(const size of sizes){
  await page.setViewportSize(size);await page.goto('/history?demo=1');
  if(size.width<761)await page.getByLabel('打开导航').click();
  const toggle=page.locator('.sidebar-sources .disclosure-toggle');if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
  const state=()=>page.locator('.nav-group-toggle').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-expanded')));
  const original=await state();
  for(let i=0;i<3;i++){
   await toggle.click();const buttons=page.locator('.source-nav button');await expect(buttons).toHaveCount(6);
   for(const button of await buttons.all()){
    expect(await button.evaluate(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
   }
   await toggle.click();await expect.poll(state).toEqual(original);
  }
  await toggle.click();
  for(const provider of ['codex','claude','cursor','pi','deepseek','workbuddy']){
   await page.locator('.source-nav button').nth(['codex','claude','cursor','pi','deepseek','workbuddy'].indexOf(provider)).click();
   await expect(page).toHaveURL(new RegExp('history.*provider='+provider));
   if(size.width<761)await page.getByLabel('打开导航').click();
  }
  await page.screenshot({path:`artifacts/screenshots/sources-${size.width}-${size.height}.png`});
 }
});

test('居中详情、单项阅读、Markdown、原文和未保存提示适配长内容',async({page,request})=>{
 test.setTimeout(60000);
 const records=await(await request.get('/api/tasks')).json(),task=records.tasks[0];const full=await(await request.get('/api/tasks/'+task.id)).json();
 await page.route('**/api/tasks/'+task.id,route=>route.fulfill({json:{...full,goal:marked,summary:longText}}));
 for(const size of sizes){
  await page.setViewportSize(size);await page.goto('/history?task='+task.id);
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  const box=(await dialog.boundingBox())!;expect(box.width).toBeLessThanOrEqual(1120);expect(box.height).toBeLessThanOrEqual(size.height-48+1);expect(Math.abs(box.x+box.width/2-size.width/2)).toBeLessThan(2);expect(Math.abs(box.y+box.height/2-size.height/2)).toBeLessThan(2);
  await expect(dialog.locator('.reading-expanded:visible')).toHaveCount(1);
  const body=dialog.locator('.reading-body:visible');await expect(body.locator('strong')).toHaveText('重点');await expect(body.locator('em')).toHaveText('强调');await expect(body.locator('ol li')).toHaveCount(2);await expect(body.locator('pre code')).toContainText('const value = 1');
  await expect(body).not.toContainText('隐藏的系统上下文');await expect(body).not.toContainText('Image #1');
  expect(await body.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  const reading=dialog.locator('.reading-accordion');expect((await body.boundingBox())!.height).toBeLessThanOrEqual((await reading.boundingBox())!.height*.45+1);
  await dialog.getByRole('button',{name:'查看原文'}).click();await expect(body).toContainText('隐藏的系统上下文');await expect(body).toContainText('图片附件');
  await dialog.getByRole('button',{name:'提取摘要 来源提取'}).click();await expect(dialog.locator('.reading-expanded:visible')).toHaveCount(1);await expect(body).toContainText('阅读标题');await expect(dialog.locator('.evidence-path:visible')).toHaveCount(0);
  await dialog.getByRole('button',{name:'提取摘要 来源提取'}).click();await expect(dialog.locator('.reading-expanded:visible')).toHaveCount(0);
  await section(page,'会话详情页面','sources');await expect(dialog.locator('.evidence-path:visible').first()).toBeVisible();
  await section(page,'会话详情页面','notes');await (await reveal(page,page.getByLabel('备注',{exact:true}))).fill('未保存验收');
  page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'保存备注'}).focus();await page.keyboard.press('Tab');await expect(dialog.getByLabel('关闭详情')).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'保存备注'})).toBeFocused();
  await page.screenshot({path:`artifacts/screenshots/reading-${size.width}-${size.height}.png`});
  page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 }
});

test('多条日报周报保持分页，长摘要和 AI 版本只有一个正文展开',async({page,request})=>{
 test.setTimeout(60000);const records=await(await request.get('/api/tasks')).json(),task=records.tasks[0];
 const reports=Array.from({length:12},(_,i)=>({id:'reading-report-'+i,title:`合成${i%2?'周报':'日报'} ${i}`,date:'2026-10-07',kind:i%2?'weekly':'daily',userText:'',versions:[{model:'synthetic',text:longText},{model:'synthetic-2',text:'短回答'}],facts:{activityCount:24,confirmed:0,reported:0,blocked:1,items:Array.from({length:14},(_,j)=>({taskId:task.id+'-'+j,title:'报告条目 '+j,summary:j?longText:'短正文',todos:[{text:'下一步 '+j,status:'pending'}],confirmed:false,reported:false,blocked:true,evidence:{path:'synthetic/source.jsonl',line:j+1}}))}}));
 await page.route('**/api/reports',r=>r.fulfill({json:reports}));await page.route('**/api/reports/reading-report-*',r=>r.fulfill({json:reports.find(v=>r.request().url().endsWith(v.id))}));
 for(const size of sizes){
  await page.setViewportSize(size);await page.goto('/reports');await page.getByRole('button',{name:/合成日报 0/}).click();await expect(page.getByLabel('报告事实页码')).toBeVisible();await bounded(page);
  const firstBody=page.locator('.reading-body:visible');const shortHeight=(await firstBody.boundingBox())!.height;const second=page.getByRole('button',{name:'报告条目 1 未确认整体完成'});if(await second.isVisible())await second.click();else await page.getByLabel('报告事实页码').fill('2');expect((await firstBody.boundingBox())!.height).toBeGreaterThan(shortHeight);expect(await firstBody.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await page.getByLabel('报告事实页码').fill('2');await expect(page.locator('.reading-expanded:visible')).toHaveCount(1);await bounded(page);
  await section(page,'报告内容页面','versions');await expect(page.locator('.reading-expanded:visible')).toHaveCount(1);await bounded(page);
  await expect(page.locator('.document-body .evidence-path')).toHaveCount(0);await page.screenshot({path:`artifacts/screenshots/reports-${size.width}-${size.height}.png`});
 }
});

test('紧凑记忆索引摘要无 Markdown，状态复查独立，空详情居中',async({page})=>{
 await page.route('**/api/memories?*',r=>r.fulfill({json:{items:[{id:'reading-memory',title:'记忆索引',text:marked,category:'pattern',status:'verified',tags:['验收'],reviewAt:Date.now(),refs:[],version:1}],total:1}}));
 await page.goto('/memories');const card=page.locator('.studio-item');await expect(card).toBeVisible();await expect(card.locator('p')).not.toContainText('*');await expect(card.locator('p')).not.toContainText('#');await expect(card.locator('.studio-item-info')).toContainText('复查');await expect(card.locator('strong')).toHaveCSS('font-size','16px');expect((await card.boundingBox())!.height).toBeLessThan(135);
 for(const view of ['memories','workflows']){await page.goto('/'+view);const pane=page.locator('.studio-editor'),empty=pane.locator('.studio-empty');await expect(empty).toBeVisible();const p=(await pane.boundingBox())!,e=(await empty.boundingBox())!;expect(Math.abs(e.x+e.width/2-p.x-p.width/2)).toBeLessThan(2);expect(Math.abs(e.y+e.height/2-p.y-p.height/2)).toBeLessThan(2);}
});

test('长记忆摘要及多条工作流索引在六种窗口下保持紧凑和完整分页',async({page})=>{
 test.setTimeout(60000);
 for(const kind of ['memories','workflows'])await page.route(`**/api/${kind}?*`,r=>{
  const params=new URL(r.request().url()).searchParams,size=Number(params.get('pageSize')),start=(Number(params.get('page'))-1)*size;
  const items=Array.from({length:12},(_,i)=>kind==='memories'?{id:'reading-memory-'+i,title:'多条记忆 '+i,text:marked,category:'pattern',status:'verified',tags:['分页验收'],reviewAt:Date.now(),refs:[],version:1}:{id:'reading-workflow-'+i,title:'多条工作流 '+i,status:'active',steps:[{title:'验证当前步骤',note:'',completedAt:null}],refs:[],version:1});
  return r.fulfill({json:{items:items.slice(start,start+size),total:items.length}});
 });
 for(const size of sizes){await page.setViewportSize(size);for(const view of ['memories','workflows']){await page.goto('/'+view);await expect(page.locator('.studio-item').first()).toBeVisible();await bounded(page);await page.getByLabel('工作资产页码').fill('2');await bounded(page);expect((await page.locator('.studio-item').first().boundingBox())!.height).toBeLessThan(135);}}
});

test('所有用量分区共用固定筛选，总览及每日图例与日期不裁切',async({page})=>{
 test.setTimeout(60000);
 for(const size of sizes){
  await page.setViewportSize(size);await page.goto('/usage');await page.getByLabel('用量时间范围').selectOption('7');await page.getByLabel('用量工具',{exact:true}).selectOption('codex');
  await expect(page.getByLabel('用量模型',{exact:true}).locator('option').filter({hasText:'synthetic-audit-model'})).toBeAttached();await page.getByLabel('用量模型',{exact:true}).selectOption('synthetic-audit-model');
  const project=await page.getByLabel('用量项目',{exact:true}).locator('option').nth(1).getAttribute('value');await page.getByLabel('用量项目',{exact:true}).selectOption(project!);
  for(const value of ['overview','daily','models','ledger','supplement','prices','coverage']){await section(page,'用量页面',value);await expect(page.getByLabel('用量时间范围')).toHaveValue('7');await expect(page.getByLabel('用量工具',{exact:true})).toHaveValue('codex');await expect(page.getByLabel('用量模型',{exact:true})).toHaveValue('synthetic-audit-model');await expect(page.getByLabel('用量项目',{exact:true})).toHaveValue(project!);await bounded(page);}
  await section(page,'用量页面','overview');await expect(page.getByText('累计 Token',{exact:true})).toBeVisible();await expect(page.getByText('当前范围总 Token',{exact:true})).toBeVisible();await expect(page.locator('.heatmap-grid')).toBeVisible();
  await section(page,'用量页面','daily');const chart=page.locator('.token-chart');await chart.locator('g').last().focus();await expect(chart.locator('.chart-tooltip strong')).toContainText(/\d{4}-\d{2}-\d{2}/);await expect(page.locator('.daily-token-panel .chart-labels')).toContainText(/\d{2}\/\d{2}/);await expect(page.locator('.usage-legend')).toBeVisible();await bounded(page);
  await page.screenshot({path:`artifacts/screenshots/usage-daily-${size.width}-${size.height}.png`});
  await page.getByRole('button',{name:'清除筛选'}).click();await expect(page.getByLabel('用量工具',{exact:true})).toHaveValue('');
  await page.getByLabel('用量时间范围').selectOption('custom');await section(page,'用量页面','overview');await expect(page.locator('.heatmap-grid')).toBeVisible();await bounded(page);
 }
});

test('聊天读取失败可重试，发送失败保留问题草稿',async({page,request})=>{
 let fail=true;await page.route('**/api/assistant/chats/reading-chat/messages',async r=>{if(fail)await r.fulfill({status:503,json:{error:'合成网络故障'}});else await r.continue();});
 await page.goto('/assistant');await section(page,'助手页面','history');await page.getByRole('button',{name:'合成长聊天',exact:true}).click();await expect(page.getByRole('alert')).toContainText('合成网络故障');fail=false;await page.getByRole('button',{name:'重新读取聊天'}).click();await expect(page.locator('.chat-message')).toHaveCount(20);
 const tasks=await(await request.get('/api/tasks')).json();await section(page,'助手页面','context');await page.locator('.context-row').filter({hasText:tasks.tasks[0].title}).first().getByRole('checkbox').first().check();await expect(page.locator('.context-preview')).toContainText(tasks.tasks[0].title);await section(page,'助手页面','chat');
 await page.route('**/api/assistant/generate',r=>r.fulfill({status:503,json:{error:'合成发送失败'}}));await page.getByLabel('助手问题').fill('保留这个问题以便重新发送');await page.getByRole('button',{name:'确认内容并发送'}).click();await expect(page.getByRole('alert')).toContainText('合成发送失败');await expect(page.getByLabel('助手问题')).toHaveValue('保留这个问题以便重新发送');await expect(page.getByRole('button',{name:'确认内容并发送'})).toBeEnabled();
});

test('聊天分页接口只读、有边界校验且保留原完整接口',async({request,browser})=>{
 const full=await(await request.get('/api/assistant/chats/reading-chat')).json();const recent=await(await request.get('/api/assistant/chats/reading-chat/messages')).json();expect(recent.total).toBe(140);expect(recent.start).toBe(120);expect(recent.nextBefore).toBe(120);expect(recent.messages).toHaveLength(20);expect(JSON.stringify(recent)).not.toContain('private snapshot');expect(recent.messages.every((m:Record<string,unknown>)=>!('preview'in m))).toBe(true);
 const older=await(await request.get('/api/assistant/chats/reading-chat/messages?before=120')).json();expect(older.start).toBe(100);expect(older.messages[0].text).toContain('消息 100');
 expect((await request.get('/api/assistant/chats/reading-chat/messages?limit=101')).status()).toBe(400);expect((await request.get('/api/assistant/chats/reading-chat/messages?before=-1')).status()).toBe(400);expect((await request.get('/api/assistant/chats/missing/messages')).status()).toBe(404);
 expect(await(await request.get('/api/assistant/chats/reading-chat')).json()).toEqual(full);
 const anonymous=await browser.newContext({storageState:{cookies:[],origins:[]}});try{expect((await anonymous.request.get('http://127.0.0.1:4318/api/assistant/chats/reading-chat/messages')).status()).toBe(401);}finally{await anonymous.close();}
});

test('聊天连续加载每次 20 条、最多 100 条并保持锚点与左右对齐',async({page})=>{
 await page.goto('/assistant');await section(page,'助手页面','history');await page.getByRole('button',{name:'合成长聊天',exact:true}).click();const stream=page.getByRole('log',{name:'聊天消息'});await expect(stream.locator('.chat-message')).toHaveCount(20);
 expect(await stream.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2)).toBe(true);
 for(let i=0;i<6;i++){
  await stream.getByRole('button',{name:'加载更早的消息'}).scrollIntoViewIfNeeded();const anchor=stream.locator('[data-position]').first(),position=await anchor.getAttribute('data-position'),before=(await anchor.boundingBox())!.y;
  await stream.getByRole('button',{name:'加载更早的消息'}).click();await expect(stream.locator('.chat-message')).toHaveCount(Math.min(100,40+i*20));expect(Math.abs((await stream.locator(`[data-position="${position}"]`).boundingBox())!.y-before)).toBeLessThan(2);
 }
 const user=(await stream.locator('.user').first().boundingBox())!,ai=(await stream.locator('.assistant').first().boundingBox())!;expect(user.x).toBeGreaterThan(ai.x);
 await expect(stream.getByRole('button',{name:'加载后续消息'})).toBeAttached();await stream.getByRole('button',{name:'加载后续消息'}).click();await expect(stream.locator('.chat-message')).toHaveCount(100);await bounded(page);
});

test('流式回答在底部跟随，向上阅读时提示新消息，停止后保留位置',async({page,request})=>{
 const tasks=await(await request.get('/api/tasks')).json();await page.goto('/assistant');await section(page,'助手页面','context');await page.locator('.context-row').filter({hasText:tasks.tasks[0].title}).first().getByRole('checkbox').first().check();await expect(page.locator('.context-preview')).toContainText(tasks.tasks[0].title);
 await section(page,'助手页面','history');await page.getByRole('button',{name:'合成长聊天',exact:true}).click();await page.getByLabel('助手问题').fill('慢速验证：滚动阅读验收');await page.getByRole('button',{name:'确认内容并发送'}).click();const stream=page.getByRole('log',{name:'聊天消息'});await expect(stream).toContainText('根据所选事实');expect(await stream.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight)).toBeLessThan(40);
 await stream.evaluate(e=>{e.scrollTop=250;e.dispatchEvent(new Event('scroll'));});const before=await stream.evaluate(e=>e.scrollTop);await expect(page.getByRole('button',{name:'有新消息 ↓'})).toBeVisible();expect(await stream.evaluate(e=>e.scrollTop)).toBeCloseTo(before,0);await page.getByRole('button',{name:'停止生成'}).click();await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);await expect(stream).toContainText('已停止生成');expect(await stream.evaluate(e=>e.scrollTop)).toBeCloseTo(before,0);
 await page.getByRole('button',{name:'有新消息 ↓'}).click();expect(await stream.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight)).toBeLessThan(40);
});

test('真实 JPEG 头像与损坏图片可重复选择，保存为 128×128 PNG 并刷新恢复',async({page,request})=>{
 await page.goto('/account');const input=page.getByLabel('更换头像');const broken={name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('broken image')};
 for(let i=0;i<2;i++){await input.setInputFiles(broken);await expect(page.getByRole('alert')).toContainText('图片无法解码');expect(await input.inputValue()).toBe('');}
 const file=process.env.AGENTDOCK_AVATAR_FILE||path.join(homedir(),'Desktop','WallPaper','头像.jpg');const synthetic=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=220;c.height=180;return c.toDataURL('image/png').split(',')[1];});
 try{await input.setInputFiles(existsSync(file)?file:{name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(synthetic,'base64')});await expect(page.getByRole('status')).toContainText('头像已保存');await page.reload();const image=page.locator('.user .avatar img');await expect(image).toBeVisible();expect(await image.evaluate((e:HTMLImageElement)=>[e.naturalWidth,e.naturalHeight])).toEqual([128,128]);expect((await(await request.get('/api/auth/status')).json()).user.avatar).toMatch(/^data:image\/png;base64,/);}finally{await request.patch('/api/account/avatar',{data:{avatar:''}});}
});
