import { chromium } from '@playwright/test';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

await page.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'networkidle', timeout: 20000 });
await page.click('#btn-start', { timeout: 5000 });
await page.waitForTimeout(2000);

// 直接查詢 THREE.Scene 內是否有 marker 網格
const info = await page.evaluate(() => {
  // 透過 window 上的 THREE 實例掃描 scene
  const THREE = window.THREE;
  // 嘗試取得 scene（透過 renderer 的 scene）
  // 這裡改用注入偵測函式：在模組內暴露 scene
  return { ok: true };
});

// 改用 raycast 檢測 marker 是否存在：直接查 scene.traverse
// 但 scene 在模組範圍內。改用另一招：捕獲 scene.add 呼叫
// 我們直接問 DOM 與 canvas 深度緩衝

console.log('=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : 'none');

// 量測 head 與 marker 的相對位置（透過 renderer.info.render.triangles 變化）
const renderInfo = await page.evaluate(() => {
  // 無法直接取得 scene，改用其他指標
  return { note: 'scene not exposed' };
});
console.log(JSON.stringify(renderInfo));

await browser.close();
