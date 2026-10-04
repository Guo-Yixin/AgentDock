import {test,expect} from '@playwright/test';
test('工作目标关联、确认、上下文、URL 恢复和主题',async({page,request})=>{
 const tasks=await(await request.get('/api/tasks')).json(),task=tasks.tasks.find((t:{provider:string})=>t.provider==='claude');
 await page.goto('/goals');await page.getByLabel('目标标题').fill('浏览器：跨工具验证目标');await page.getByLabel('目标项目').selectOption(task.projectId);await page.getByLabel('目标备注').fill('目标备注持久化');await page.getByRole('button',{name:'保存目标',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');
 const goal=(await(await request.get('/api/goals?q='+encodeURIComponent('浏览器：跨工具验证目标'))).json()).goals[0];expect(goal.status).toBe('not_started');
 await request.post(`/api/goals/${goal.id}/sessions`,{data:{taskId:task.id}});
 await page.reload();await expect(page.getByLabel('目标备注')).toHaveValue('目标备注持久化');await expect(page.getByRole('button',{name:task.title+' ↗',exact:true})).toBeVisible();
 await page.getByLabel('目标状态',{exact:true}).selectOption('done');await page.getByRole('button',{name:'保存目标',exact:true}).click();await expect(page.getByRole('status')).toContainText('已保存');const saved=await(await request.get(`/api/goals/${goal.id}`)).json();expect(saved.confirmedAt).toBeGreaterThan(0);expect((await(await request.get(`/api/tasks/${task.id}`)).json()).completion).toBe('unconfirmed');
 await page.getByRole('button',{name:'目标加入助手'}).click();await page.getByRole('button',{name:'预览实际发送内容'}).click();await expect(page.locator('.context-preview')).toContainText('目标备注持久化');
 await page.getByLabel('界面主题').selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.goto('/history?provider=claude&q='+encodeURIComponent('验证历史'));await expect(page.getByLabel('来源筛选')).toHaveValue('claude');await expect(page.getByLabel('搜索任务')).toHaveValue('验证历史');await page.getByRole('button',{name:'项目空间',exact:true}).click();await expect(page).toHaveURL(/\/projects/);await page.goBack();await expect(page).toHaveURL(/\/history/);await expect(page.getByLabel('来源筛选')).toHaveValue('claude');
});

test('未保存目标与日程修改拦截导航和页面离开',async({page})=>{
 await page.goto('/goals?demo=1');await page.getByLabel('目标标题').fill('未保存目标');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'项目空间',exact:true}).click();await expect(page).toHaveURL(/goals/);await expect(page.getByLabel('目标标题')).toHaveValue('未保存目标');
 expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'日历日程',exact:true}).click();await page.getByRole('button',{name:'新建日程'}).click();await page.getByLabel('日程标题').fill('未保存日程');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'报告中心',exact:true}).click();await expect(page.getByLabel('日程标题')).toHaveValue('未保存日程');
});
