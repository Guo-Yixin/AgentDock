import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('real adapters, filtering, editing, linking, export and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('button', { name: /实现本地任务搜索/ }).first()).toBeVisible();
  await page.getByLabel('来源筛选').selectOption('claude');
  await expect(page.getByRole('button', { name: /验证历史导入/ }).first()).toBeVisible(); await expect(page.getByRole('button', { name: /实现本地任务搜索/ }).first()).not.toBeVisible();
  await page.getByLabel('来源筛选').selectOption('codex'); await page.getByRole('button', { name: /实现本地任务搜索/ }).first().click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await expect(dialog.getByText('本轮回复已结束', { exact: true })).toBeVisible();
  await dialog.getByLabel('备注', { exact: true }).fill('测试备注：已验证搜索'); await dialog.getByLabel('我的摘要补充').fill('人工补充摘要');
  await dialog.getByLabel('任务状态').selectOption('done'); await dialog.getByPlaceholder('例如：AgentDock 首版交付').fill('跨工具交付');
  await dialog.getByRole('button', { name: '保存备注' }).click(); await expect(page.getByRole('status')).toContainText('已保存');
  const downloadEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出摘要' }).click();
  const download = await downloadEvent; const markdown = await readFile((await download.path())!, 'utf8'); expect(markdown).toContain('人工补充摘要'); expect(markdown).toContain('跨工具交付');
  await page.reload(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByLabel('备注', { exact: true })).toHaveValue('测试备注：已验证搜索');
  await expect(page.getByLabel('任务状态')).toHaveValue('done'); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '历史记录', exact: true }).click(); await page.getByLabel('搜索任务').fill('跨工具交付');
  await expect(page.getByRole('button', { name: /实现本地任务搜索/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
test('source coverage, projects and empty searches', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '工具接入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '来源连接' })).toBeVisible(); await expect(page.getByText('未找到记录', { exact: true })).toHaveCount(2); await page.getByRole('navigation',{name:'来源连接分页'}).getByRole('button',{name:'下一页'}).click(); await expect(page.getByText('未找到记录',{exact:true})).toHaveCount(1);
  await page.getByRole('button', { name: '项目空间', exact: true }).click(); await expect(page.getByRole('heading', { name: 'sample-project' })).toBeVisible();
  await page.getByRole('button', { name: /sample-project/ }).click(); await page.getByLabel('搜索任务').fill('不存在的任务xyz'); await expect(page.getByText('没有匹配的任务')).toBeVisible();
});
test('SSE reconnects after a network interruption', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByText('本地服务已连接')).toBeVisible();
  await context.setOffline(true); await expect(page.getByText('正在连接本地服务')).toBeVisible();
  await context.setOffline(false); await expect(page.getByText('本地服务已连接')).toBeVisible({ timeout: 12000 });
});
test('reject cross-origin writes and preserve original completion semantics', async ({ request }) => {
  const list = await (await request.get('/api/tasks?provider=claude')).json(); const id = list.tasks[0].id;
  expect(list.tasks[0].completion).toBe('unconfirmed');
  const forbidden = await request.patch(`/api/tasks/${id}`, { headers: { Origin: 'https://untrusted.example' }, data: { manualStatus: 'done' } }); expect(forbidden.status()).toBe(403);
  const invalid = await request.patch(`/api/tasks/${id}`, { data: { manualStatus: 'reported_complete' } }); expect(invalid.status()).toBe(400);
});
test('demo mode is separate and responsive screenshots match the visual direction', async ({ page }) => {
  await page.goto('/?demo=1'); await expect(page.getByText(/演示模式 · 所有任务/)).toBeVisible();
  await expect(page.getByRole('button', { name: /实现跨工具任务索引/ }).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/screenshots/overview-1440.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: /实现跨工具任务索引/ }).first().click(); await page.screenshot({ path: 'artifacts/screenshots/detail-1440.png', animations: 'disabled' }); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.screenshot({ path: 'artifacts/screenshots/overview-1920.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'artifacts/screenshots/overview-mobile.png', fullPage: true, animations: 'disabled' });
  await expect(page.getByRole('navigation', { name: '主导航' })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('打开导航').click(); await page.getByRole('button', { name: '工具接入', exact: true }).click(); await expect(page.getByRole('heading', { name: '来源连接' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(page.locator('.orbit-art')).toHaveCount(0); expect(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
});
