import {test,expect} from '@playwright/test';

test('项目每页五条并支持页码跳转',async({page})=>{
 await page.route('**/api/overview',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({json:{...data,projects:Array.from({length:12},(_,i)=>({id:'page-project-'+i,name:'分页项目 '+i,root:'synthetic/project/'+i,count:1,providers:['codex'],updatedAt:Date.now()}))}});});
 await page.goto('/projects');await expect(page.locator('.project-card')).toHaveCount(5);
 const nav=page.getByRole('navigation',{name:'项目空间分页'});await nav.getByRole('button',{name:'下一页'}).click();await expect(page.getByRole('heading',{name:'分页项目 5',exact:true})).toBeVisible();
 await page.getByLabel('项目空间页码').fill('3');await expect(page.locator('.project-card')).toHaveCount(2);await expect(nav.getByRole('button',{name:'下一页'})).toBeDisabled();
 await page.screenshot({path:'artifacts/screenshots/projects-paged.png',animations:'disabled'});
});

test('精确补录包含输入输出秒级时间，缓存未提供，刷新和删除一致',async({page,request})=>{
 await page.goto('/usage');await page.getByText('精确用量补录 · 输入、输出与时间点',{exact:true}).click();await page.getByRole('button',{name:'新增精确补录'}).click();
 await page.getByLabel('补录模型',{exact:true}).fill('synthetic-precise-model');await page.getByLabel('补录输入 Token',{exact:true}).fill('800');await page.getByLabel('补录输出 Token',{exact:true}).fill('200');
 const when=new Date(Date.now()+28800000-86400000).toISOString().slice(0,19);await page.getByLabel('补录日期时间').fill(when);await page.getByLabel('精确补录依据').fill('合成精确用量样本');
 await page.getByLabel('界面主题').selectOption('light');expect(await page.getByLabel('补录输入 Token').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
 await page.getByRole('button',{name:'保存精确补录'}).click();await expect(page.locator('details').filter({has:page.locator('summary').filter({hasText:'精确用量补录'})}).getByText('Codex · synthetic-precise-model',{exact:true})).toBeVisible();
 const entries=await (await request.get('/api/usage/manual')).json();const entry=entries.find((e:{model:string})=>e.model==='synthetic-precise-model');expect(entry.timestamp).toBe(Date.parse(when+'+08:00'));
 try{const records=await(await request.get(`/api/usage/records?start=${Date.now()-2*86400000}&end=${Date.now()+86400000}&model=synthetic-precise-model`)).json();expect(records.records[0].mode).toBe('manual');expect(records.records[0].total).toBe(1000);expect(records.records[0].cacheRead).toBeNull();await page.reload();await page.getByText('精确用量补录 · 输入、输出与时间点',{exact:true}).click();await expect(page.locator('details').filter({has:page.locator('summary').filter({hasText:'精确用量补录'})}).getByText('Codex · synthetic-precise-model',{exact:true})).toBeVisible();}finally{expect((await request.delete('/api/usage/manual',{data:{id:entry.id.replace(/^manual-/,''),version:entry.version}})).ok()).toBe(true);}
});

test('账号头像上传后持久化并可恢复默认',async({page,request})=>{
 await page.goto('/');await page.getByLabel('打开账号中心').click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;const ctx=c.getContext('2d')!;ctx.fillStyle='#159c89';ctx.fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1];});
 try{await page.getByLabel('更换头像').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.getByRole('status')).toContainText('头像已保存');await expect(page.locator('.user .avatar img')).toBeVisible();await page.reload();await expect(page.locator('.user .avatar img')).toBeVisible();const auth=await(await request.get('/api/auth/status')).json();expect(auth.user.avatar).toMatch(/^data:image\/png;base64,/);await page.getByRole('button',{name:'恢复默认头像'}).click();await expect(page.locator('.user .avatar img')).toHaveCount(0);}finally{await request.patch('/api/account/avatar',{data:{avatar:''}});}
});

test('采集配置不会延长当前轮次，暂停恢复和非法配置处理',async({page,request})=>{
 const previous=await(await request.get('/api/collection')).json();
 try{await page.goto('/settings');await page.getByLabel('每次采集时长',{exact:true}).fill('1');await page.getByLabel('采集检查间隔').selectOption('120');await page.getByRole('button',{name:'保存采集设置'}).click();await expect(page.getByRole('status')).toContainText('采集设置已保存');const saved=await(await request.get('/api/collection')).json();expect(saved.deadline).toBe(previous.deadline);expect(saved.intervalSeconds).toBe(120);
 await page.getByRole('button',{name:'暂停采集',exact:true}).click();await expect(page.getByRole('button',{name:'恢复采集',exact:true})).toBeVisible();expect((await(await request.get('/api/collection')).json()).paused).toBe(true);
 await page.getByRole('button',{name:'恢复采集',exact:true}).click();await expect(page.getByRole('button',{name:'暂停采集',exact:true})).toBeVisible();const resumed=await(await request.get('/api/collection')).json();expect(resumed.deadline-Date.now()).toBeGreaterThan(55000);expect(resumed.deadline-Date.now()).toBeLessThanOrEqual(60000);
 expect((await request.patch('/api/collection',{data:{durationMinutes:999,intervalSeconds:3}})).status()).toBe(400);
 }finally{await request.patch('/api/collection',{data:{durationMinutes:previous.durationMinutes,intervalSeconds:previous.intervalSeconds}});await request.post('/api/collection/pause',{data:{paused:true}});if(!previous.paused)await request.post('/api/collection/pause',{data:{paused:false}});}
});
