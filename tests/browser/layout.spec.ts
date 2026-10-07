import {reveal,section} from './navigation';
import { test, expect } from '@playwright/test';

test('侧边栏与导航分组保持状态，工作台入口和图标栏可导航',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.getByRole('button',{name:/查看跨工具任务流/})).toBeVisible();
 await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'观察与计划',exact:true}))).click();await expect(page.getByRole('navigation',{includeHidden:true,name:'主导航'}).getByRole('button',{includeHidden:true,name:'用量审计',exact:true})).not.toBeVisible();
 await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'折叠侧边栏'}))).click();await expect(page.locator('.sidebar')).toHaveCSS('width','72px');
 await (await reveal(page,page.getByRole('navigation',{includeHidden:true,name:'主导航'}).getByRole('button',{includeHidden:true,name:'用量审计',exact:true}))).click();await expect(page.getByRole('heading',{includeHidden:true,name:'用量审计',exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('.sidebar')).toHaveCSS('width','72px');
 await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'展开侧边栏'}))).click();await expect(page.locator('.sidebar')).toHaveCSS('width','232px');await expect(page.getByRole('navigation',{includeHidden:true,name:'主导航'}).getByRole('button',{includeHidden:true,name:'用量审计',exact:true})).toBeVisible();
 await page.goto('/?demo=1');await (await reveal(page,page.getByLabel('界面主题'))).selectOption('light');await page.screenshot({path:'artifacts/screenshots/compact-home-light.png',fullPage:true,animations:'disabled'});
 await (await reveal(page,page.getByLabel('界面主题'))).selectOption('dark');await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'折叠侧边栏'}))).click();await page.screenshot({path:'artifacts/screenshots/compact-home-dark.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'打开导航'}))).click();await expect(page.getByRole('navigation',{includeHidden:true,name:'主导航'}).getByRole('button',{includeHidden:true,name:'工作台',exact:true})).toBeVisible();await (await reveal(page,page.getByRole('navigation',{includeHidden:true,name:'主导航'}).getByRole('button',{includeHidden:true,name:'工作流',exact:true}))).click();await expect(page.getByRole('heading',{includeHidden:true,name:'把一次工作，推进成一次交付。'})).toBeVisible();
});

test('记忆标签切换保留填写内容与未保存检查',async({page})=>{
 await page.goto('/memories?demo=1');await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'新建记忆',exact:true}))).click();await (await reveal(page,page.getByLabel('记忆标题'))).fill('折叠验收');await (await reveal(page,page.getByLabel('记忆内容',{exact:true}))).fill('正文与补充信息分层');await (await reveal(page,page.getByLabel('记忆标签'))).fill('布局,可复用');
 await section(page,'记忆内容页面','body');await expect(page.getByLabel('记忆标签')).not.toBeVisible();await expect(page.getByLabel('记忆内容',{exact:true})).toHaveValue('正文与补充信息分层');
 const dialog=page.waitForEvent('dialog');const navigation=page.getByRole('navigation',{includeHidden:true,name:'主导航'}).getByRole('button',{includeHidden:true,name:'历史记录',exact:true}).click();await (await dialog).dismiss();await navigation;await expect(page.getByLabel('记忆标题')).toHaveValue('折叠验收');
 await section(page,'记忆内容页面','metadata');await expect(page.getByLabel('记忆标签')).toHaveValue('布局,可复用');await (await reveal(page,page.getByRole('button',{includeHidden:true,name:'保存记忆',exact:true}))).click();await expect(page.locator('.studio-item').filter({hasText:'折叠验收'})).toBeVisible();
});

test('网页标识与 favicon 使用同一矢量，深浅主题保持辨识',async({page,request})=>{
 expect(await(await request.get('/brand.svg')).text()).toBe(await(await request.get('/favicon.svg')).text());
 await page.goto('/?demo=1');await expect(page.locator('.brand-mark').first()).toBeVisible();expect(await page.locator('.brand-mark').first().evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
});
