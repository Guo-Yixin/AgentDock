// Render our authored SVG to a crisp, transparent desktop icon. No remote assets.
import { chromium } from '@playwright/test';
import { readFile, copyFile } from 'node:fs/promises';
const svg=await readFile('public/brand.svg','utf8');
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
  await page.screenshot({path:'desktop/icon.png',omitBackground:true});
  await copyFile('public/brand.svg','public/favicon.svg');
} finally { await browser.close(); }
console.log('已从统一 SVG 生成桌面图标与网页 favicon');
