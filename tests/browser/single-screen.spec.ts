import {test,expect} from '@playwright/test';
import {section,reveal} from './navigation';

async function fits(page:import('@playwright/test').Page){
 await expect.poll(()=>page.evaluate(()=>{
  const root=document.querySelector('.content')!,edge=root.getBoundingClientRect();
  return [...root.querySelectorAll('button,input,textarea,select,.pagination,.project-card,.metric')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')&&getComputedStyle(e).visibility!=='hidden').filter(e=>{const r=e.getBoundingClientRect();return r.bottom>edge.bottom+2||r.right>edge.right+2||r.top<edge.top-2||r.left<edge.left-2;}).map(e=>e.getAttribute('aria-label')||e.textContent?.slice(0,35)||e.className);
 })).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const footer=page.locator('.footer');await expect(footer).toContainText('本地工作空间');expect((await footer.boundingBox())!.y+(await footer.boundingBox())!.height).toBeLessThanOrEqual((await page.viewportSize())!.height+1);
}

test('六种窗口下页面与分页保持一屏，内容通过标签与跳转访问',async({page})=>{
 test.setTimeout(150000);
 const views=['','history','projects','usage','assistant','sources','settings','goals','memories','workflows','reports','calendar','account'];
 for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[960,600],[390,844],[390,600]]){
  await page.setViewportSize({width,height});
  for(const view of views){await page.goto('/'+view+'?demo=1');await expect(page.locator('.content')).toBeVisible();await fits(page);}
  await page.goto('/usage?demo=1');
  for(const value of ['activity','models','ledger','supplement','prices','coverage']){await section(page,'用量页面',value);await fits(page);}
  await page.goto('/assistant?demo=1');await section(page,'助手页面','context');await fits(page);
 }
});

test('固定工作台入口、标签与浏览器返回保持状态',async({page})=>{
 await page.goto('/?demo=1');await page.getByRole('button',{name:/查看跨工具任务流/}).click();await expect(page).toHaveURL(/history.*recent=true/);await expect(page.getByLabel('搜索任务')).toBeVisible();await page.goBack();await expect(page.getByRole('heading',{name:'工作台',exact:true})).toBeVisible();
 await page.goto('/usage?demo=1');await section(page,'用量页面','models');await section(page,'用量页面','activity');await page.goBack();await expect(page.getByRole('navigation',{name:'用量页面'}).getByRole('button',{name:'工具与模型'})).toHaveAttribute('aria-current','page');
});

test('短窗口分步编辑不丢失草稿，保存按钮无需页面滚动',async({page})=>{
 await page.setViewportSize({width:390,height:600});await page.goto('/memories?demo=1');await page.getByRole('button',{name:'新建记忆',exact:true}).click();await page.getByLabel('记忆标题').fill('一屏草稿');await page.getByLabel('记忆内容',{exact:true}).fill('保留正文');await fits(page);
 await (await reveal(page,page.getByLabel('记忆标签'))).fill('测试');await fits(page);await section(page,'记忆内容页面','body');await expect(page.getByLabel('记忆内容',{exact:true})).toHaveValue('保留正文');await page.getByRole('button',{name:'保存记忆',exact:true}).click();await fits(page);
 await page.goto('/calendar?demo=1');await page.getByRole('button',{name:'新建日程'}).click();await (await reveal(page,page.getByLabel('日程开始'))).fill('2026-10-08T10:00');await fits(page);await (await reveal(page,page.getByLabel('日程标题'))).fill('分步填写');await page.getByRole('button',{name:'保存日程'}).click();await fits(page);
});

test('小窗口补录、合同单价、助手对象与编辑操作保持可达',async({page})=>{
 for(const viewport of [{width:960,height:600},{width:390,height:600}]){
  await page.setViewportSize(viewport);await page.goto('/usage');await section(page,'用量页面','supplement');await page.getByRole('button',{name:'管理历史补录'}).click();await fits(page);
  await section(page,'历史补录编辑页面','allocation');await fits(page);await section(page,'历史补录编辑页面','note');await fits(page);
  await section(page,'补录页面','precise');await page.getByRole('button',{name:'新增精确补录'}).click();await (await reveal(page,page.getByLabel('补录日期时间'))).fill('2026-10-06T10:00:01');await fits(page);
  await section(page,'用量页面','prices');await section(page,'价格页面','contract');await page.getByRole('button',{name:'配置单价',exact:true}).click();await (await reveal(page,page.getByLabel('output 单价',{exact:true}))).fill('2');await fits(page);
  await page.goto('/assistant?demo=1');await section(page,'助手页面','context');await fits(page);
  await page.goto('/memories?demo=1');await page.getByRole('button',{name:'新建记忆'}).click();await fits(page);
 }
});

test('用量筛选及日期范围刷新恢复，账号安全分区仍可访问',async({page})=>{
 await page.goto('/usage');await (await reveal(page,page.getByLabel('用量工具',{exact:true}))).selectOption('codex');await page.getByLabel('用量时间范围').selectOption('7');await page.reload();await expect(page.getByLabel('用量工具',{exact:true})).toHaveValue('codex');await expect(page.getByLabel('用量时间范围')).toHaveValue('7');
 await page.goto('/account');await section(page,'账号页面','security');await expect(page.getByLabel('当前密码')).toBeVisible();await fits(page);
});
