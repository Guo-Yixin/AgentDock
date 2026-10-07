import { test, expect } from '@playwright/test';

test('侧边栏、导航分组和首页折叠保持状态，图标栏仍可导航',async({page})=>{
 await page.goto('/?demo=1');
 const assets=page.getByRole('button',{name:'记忆与工作流 经验沉淀 · 协作推进 · 上下文分析',exact:true});
 await expect(assets).toHaveAttribute('aria-expanded','false');
 await assets.click();await expect(page.getByRole('button',{name:/长期积累.*记忆库/})).toBeVisible();
 await page.reload();await expect(assets).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'观察与计划',exact:true}).click();await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'用量审计',exact:true})).not.toBeVisible();
 await page.getByRole('button',{name:'折叠侧边栏'}).click();await expect(page.locator('.sidebar')).toHaveCSS('width','72px');
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'用量审计',exact:true}).click();await expect(page.getByRole('heading',{name:'用量审计',exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('.sidebar')).toHaveCSS('width','72px');
 await page.getByRole('button',{name:'展开侧边栏'}).click();await expect(page.locator('.sidebar')).toHaveCSS('width','232px');await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'用量审计',exact:true})).toBeVisible();
 await page.goto('/?demo=1');await page.getByLabel('界面主题').selectOption('light');await page.screenshot({path:'artifacts/screenshots/compact-home-light.png',fullPage:true,animations:'disabled'});
 await page.getByLabel('界面主题').selectOption('dark');await page.getByRole('button',{name:'折叠侧边栏'}).click();await page.screenshot({path:'artifacts/screenshots/compact-home-dark.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'打开导航'}).click();await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作台',exact:true})).toBeVisible();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作流',exact:true}).click();await expect(page.getByRole('heading',{name:'把一次工作，推进成一次交付。'})).toBeVisible();
});

test('折叠记忆补充信息不丢失填写内容或绕过未保存检查',async({page})=>{
 await page.goto('/memories?demo=1');await page.getByRole('button',{name:'新建记忆',exact:true}).click();await page.getByLabel('记忆标题').fill('折叠验收');await page.getByLabel('记忆内容').fill('正文与补充信息分层');await page.getByLabel('记忆标签').fill('布局,可复用');
 const fold=page.getByRole('button',{name:'分类、确认与来源 项目 · 标签 · 依据',exact:true});await fold.click();await expect(page.getByLabel('记忆标签')).not.toBeVisible();await expect(page.getByLabel('记忆内容')).toHaveValue('正文与补充信息分层');
 const dialog=page.waitForEvent('dialog');const navigation=page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'历史记录',exact:true}).click();await (await dialog).dismiss();await navigation;await expect(page.getByLabel('记忆标题')).toHaveValue('折叠验收');
 await fold.click();await expect(page.getByLabel('记忆标签')).toHaveValue('布局,可复用');await page.getByRole('button',{name:'保存记忆',exact:true}).click();await expect(page.locator('.studio-item').filter({hasText:'折叠验收'})).toBeVisible();
});

test('网页标识与 favicon 使用同一矢量，深浅主题保持辨识',async({page,request})=>{
 expect(await(await request.get('/brand.svg')).text()).toBe(await(await request.get('/favicon.svg')).text());
 await page.goto('/?demo=1');await expect(page.locator('.brand-mark').first()).toBeVisible();expect(await page.locator('.brand-mark').first().evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
});
