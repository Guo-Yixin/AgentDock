import { test, expect } from "@playwright/test";
test('环境变量配置的空数据库可以首次初始化，已有账号不能匿名重置',async({browser})=>{
 const context=await browser.newContext({storageState:{cookies:[],origins:[]}});try{const page=await context.newPage();await page.goto('http://127.0.0.1:4320/');await expect(page.getByRole('heading',{name:'配置数据库',exact:true})).toBeVisible();await expect(page.getByLabel('数据库主机')).toBeDisabled();await page.getByRole('button',{name:'初始化表结构',exact:true}).click();await expect(page.getByRole('heading',{name:'创建工作空间账号'})).toBeVisible();await page.getByLabel('登录账号').fill('synthetic_env_owner');await page.getByLabel('登录密码',{exact:true}).fill('Synthetic-env-pass!');await page.getByLabel('确认登录密码').fill('Synthetic-env-pass!');await page.getByRole('button',{name:'创建并进入'}).click();await expect(page.getByRole('heading',{name:'工作台',exact:true})).toBeVisible();}finally{await context.close();}
 const anonymous=await browser.newContext({storageState:{cookies:[],origins:[]}});try{const response=await anonymous.request.post('http://127.0.0.1:4320/api/settings/database/initialize');expect(response.status()).toBe(401);}finally{await anonymous.close();}
});
test("未登录不能访问会话、路径、导出、模型及用量；演示可独立访问", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4318/");
    await expect(
      page.getByRole("heading", { name: "登录你的工作空间" }),
    ).toBeVisible();
    for (const path of [
      "/api/tasks",
      "/api/export",
      "/api/settings",
      "/api/sources/discover",
      "/api/usage?start=0&end=1",
    ])
      expect(
        (await context.request.get("http://127.0.0.1:4318" + path)).status(),
      ).toBe(401);
    const wrong = await context.request.post(
      "http://127.0.0.1:4318/api/auth/login",
      { data: { username: "audit_test_owner", password: "wrong-password" } },
    );
    expect(wrong.status()).toBe(401);
    expect((await wrong.json()).user).toBeUndefined();
    await page.getByLabel("登录账号").fill("audit_test_owner");
    await page.getByLabel("登录密码").fill("Synthetic-only-pass!");
    await page
      .getByRole("button", { name: "登录工作空间", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "工作台", exact: true }),
    ).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "ad_session")?.httpOnly).toBe(true);
    expect(cookies.find((c) => c.name === "ad_session")?.sameSite).toBe(
      "Strict",
    );
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "ad_session",
    );
    await page.getByLabel("打开账号中心").click();
    await expect(
      page.getByRole("heading", { name: "账号中心", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "退出登录 / 锁定工作空间" }).click();
    await expect(
      page.getByRole("heading", { name: "登录你的工作空间" }),
    ).toBeVisible();
    expect(
      (await context.request.get("http://127.0.0.1:4318/api/tasks")).status(),
    ).toBe(401);
    await page.getByRole("button", { name: "查看演示体验" }).click();
    await expect(page.getByText(/演示模式 · 所有任务/)).toBeVisible();
    await page.screenshot({
      path: "artifacts/screenshots/login-demo.png",
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});
test("用量审计：真实统计、计价、证据、导出与深浅主题", async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => {
      const now = Date.now();
      const data = await (
        await request.get(
          `/api/usage?start=${now - 86400000}&end=${now + 86400000}`,
        )
      ).json();
      return data.summary.total;
    })
    .toBeGreaterThan(0);
  await page.goto("/usage");
  await expect(
    page.getByRole("heading", { name: "用量审计", exact: true }),
  ).toBeVisible();
  await page.getByLabel("用量工具", { exact: true }).selectOption("codex");
  await expect(page.getByText("1.1 K", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "配置单价" }).click();
  await page.getByLabel("单价工具").selectOption("codex");
  await page.getByLabel("单价模型").fill("synthetic-audit-model");
  await page.getByLabel("单价生效日期").fill("2026-01-01");
  for (const field of [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "cacheWriteLong",
  ])
    await page
      .getByLabel(field + " 单价", { exact: true })
      .fill(field === "output" ? "4" : "2");
  await page.getByRole("button", { name: "保存单价规则" }).click();
  await expect(page.getByText("0.0024 CNY", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "用量依据" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("累计快照的正增量")).toBeVisible();
  await expect(dialog.getByText(/sample.jsonl/)).toBeVisible();
  await page.getByLabel("关闭用量详情").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出汇总 CSV" }).click();
  expect((await download).suggestedFilename()).toContain("usage");
  await page.getByLabel("界面主题").selectOption("light");
  await page.screenshot({
    path: "artifacts/screenshots/usage-light-1440.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("界面主题").selectOption("dark");
  await page.screenshot({
    path: "artifacts/screenshots/usage-dark-1440.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/screenshots/usage-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("浅色组件无黑底、快捷操作与关注筛选可用", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByLabel("界面主题").selectOption("light");
  await expect
    .poll(() =>
      page
        .locator(".filters select")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(255, 255, 255)");
  const note = await page
    .locator(".local-note")
    .evaluate((el) => ({
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundImage,
    }));
  expect(note.color).toBe(await page.locator(".main").evaluate(el=>getComputedStyle(el).color));
  expect(note.background).not.toContain("rgb(16, 30, 30)");
  const pin = page.getByRole("button", { name: /^关注：/ }).first();
  await pin.click();
  await page.getByRole("button", { name: "只看关注" }).click();
  await expect(page.locator(".task-row")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "只看关注" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "快捷操作", exact: true }).click();
  await page.getByLabel("搜索快捷操作").fill("用量");
  await page.getByRole("button", { name: /用量审计.*查看跨工具/ }).click();
  await expect(page.getByRole("heading", { name: "用量审计" })).toBeVisible();
});

test("历史补录：累计与对比一致，估算热力图可切换，导出标明性质",async({page,request})=>{
 const measuredBefore=(await (await request.get(`/api/usage?start=${Date.now()-365*86400000}&end=${Date.now()+86400000}`)).json()).summary.records;
 await page.goto('/usage');await page.getByRole('button',{name:'管理历史补录'}).click();await page.getByLabel('历史 Token 数量').fill('5');await page.getByLabel('补录依据与说明').fill('合成浏览器测试：估算工作日，不是请求证据');
 try{
 await page.getByRole('button',{name:'保存历史补录',exact:true}).click();await expect(page.locator('.usage-profile-stats strong').first()).toHaveText('5.00 亿');await expect(page.getByText(/对比合计 5.00 亿/)).toBeVisible();
 await expect(page.locator('.heatmap-grid .estimated-day').first()).toBeVisible();await page.getByLabel(/显示历史估算/).uncheck();await expect(page.locator('.heatmap-grid .estimated-day')).toHaveCount(0);await page.getByLabel(/显示历史估算/).check();
 await page.reload();await expect(page.locator('.usage-profile-stats strong').first()).toHaveText('5.00 亿');
 const result=await (await request.get(`/api/usage?start=${Date.now()-365*86400000}&end=${Date.now()+86400000}`)).json();expect(result.summary.records).toBe(measuredBefore);expect(result.profile.total).toBe(500000000);expect(result.history.days.reduce((s:number,d:{total:number})=>s+d.total,0)).toBe(result.history.total);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出汇总 CSV'}).click();const stream=await (await download).createReadStream();let csv='';for await(const chunk of stream!)csv+=chunk;expect(csv).toContain('历史估算（生成工作日）');
 await page.getByLabel('界面主题').selectOption('light');await page.screenshot({path:'artifacts/screenshots/history-light.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{await request.delete('/api/usage/history');}
});
