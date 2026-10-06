import { test, expect } from '@playwright/test';

test('会话 → 记忆 → 工作流 → 助手上下文 → 复盘与日程',async({page,request})=>{
 const tasks=await(await request.get('/api/tasks?provider=codex')).json();const source=tasks.tasks.find((t:{title:string})=>t.title==='实现本地任务搜索');
 await page.goto('/history');await page.getByRole('heading',{name:'实现本地任务搜索',exact:true}).click();
 await page.getByRole('button',{name:'沉淀为记忆',exact:true}).click();await expect(page.getByLabel('记忆内容')).toHaveValue(source.annotation.summaryOverride||source.summary||source.goal);
 await page.getByLabel('记忆标题').fill('浏览器交付经验');await page.getByLabel('记忆确认状态').selectOption('verified');await page.getByRole('button',{name:'保存记忆',exact:true}).click();await expect(page.getByText('已复查 0 次')).toBeVisible();
 await page.getByRole('button',{name:'带入助手',exact:true}).click();await page.getByRole('button',{name:'预览实际发送内容',exact:true}).click();await expect(page.locator('.context-preview')).toContainText('浏览器交付经验');await expect(page.locator('.context-preview')).toContainText('verified');
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作流',exact:true}).click();await page.getByRole('button',{name:'启动工作流',exact:true}).click();await page.getByLabel('工作流名称').fill('浏览器交付流程');await page.getByRole('button',{name:'确认启动',exact:false}).click();await expect(page.getByRole('heading',{name:'浏览器交付流程',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'用助手分析本步'}).click();await expect(page.getByLabel('助手问题')).toHaveValue(/对齐目标与依据/);await page.getByRole('button',{name:'预览实际发送内容'}).click();await expect(page.locator('.context-preview')).toContainText('浏览器交付流程');
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作流',exact:true}).click();await page.locator('.studio-item').filter({hasText:'浏览器交付流程'}).click();
 for(let i=0;i<4;i++){await page.getByLabel('工作流步骤结论').fill(`第 ${i+1} 步：浏览器已验证`);await page.getByRole('button',{name:'确认本步'}).click();if(i<3)await expect(page.getByLabel('工作流步骤结论')).toHaveValue('');}
 await expect(page.locator('.studio-editor .section-heading')).toContainText('已完成');await page.getByRole('button',{name:'结论沉淀为记忆'}).click();await expect(page.getByLabel('记忆内容')).toHaveValue(/第 4 步：浏览器已验证/);await expect(page.getByLabel('记忆确认状态')).toHaveValue('draft');await page.getByRole('button',{name:'保存记忆',exact:true}).click();
 await page.reload();await expect(page.locator('.studio-item').filter({hasText:'浏览器交付流程 · 复盘'})).toBeVisible();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作流',exact:true}).click();await page.locator('.studio-item').filter({hasText:'浏览器交付流程'}).click();await page.getByRole('button',{name:'创建跟进日程草稿'}).click();await expect(page.getByLabel('日程标题')).toHaveValue('跟进：浏览器交付流程');
});

test('浅深主题与窄窗口、独立演示不调用真实接口',async({page})=>{
 let calls=0;page.on('request',r=>{if(r.url().includes('/api/memories')||r.url().includes('/api/workflows'))calls++;});await page.goto('/memories?demo=1');await page.getByRole('button',{name:'新建记忆',exact:true}).click();await page.getByLabel('记忆标题').fill('演示记忆');await page.getByLabel('记忆内容').fill('只保存在演示模式');await page.getByRole('button',{name:'保存记忆',exact:true}).click();expect(calls).toBe(0);
 for(const theme of ['light','dark']){
  await page.getByLabel('界面主题').selectOption(theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect.poll(()=>page.getByLabel('记忆内容').evaluate(el=>getComputedStyle(el).backgroundColor===getComputedStyle(document.querySelector('.studio-editor')!).backgroundColor)).toBe(true);
  const contrast=await page.getByLabel('记忆内容').evaluate(el=>{const s=getComputedStyle(el);const luminance=(rgb:string)=>{const v=rgb.match(/\d+/g)!.slice(0,3).map(n=>{const c=Number(n)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};const a=luminance(s.backgroundColor),b=luminance(s.color);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});expect(contrast).toBeGreaterThanOrEqual(4.5);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`artifacts/studio-${theme}.png`,fullPage:true,animations:'disabled'});
 }
 await page.setViewportSize({width:390,height:844});await expect(page.getByLabel('记忆内容')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/studio-narrow.png',fullPage:true});
});
