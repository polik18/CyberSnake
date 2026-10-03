import { chromium } from '@playwright/test';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

try {
  await page.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'networkidle', timeout: 20000 });
} catch (e) {
  errors.push('NAV: ' + e.message);
}

// 點擊開始按鈕
try {
  await page.click('#btn-start', { timeout: 5000 });
  await page.waitForTimeout(1500);
} catch (e) {
  errors.push('CLICK: ' + e.message);
}

const state = await page.evaluate(() => {
  // 模組範圍變數（在模組內可讀取，但 page.evaluate 在全局範圍執行）
  // 改用 DOM 狀態與 canvas 像素來判斷。
  const startScreen = document.getElementById('start-screen');
  const gameoverScreen = document.getElementById('gameover-screen');
  const scoreText = document.getElementById('score')?.innerText || 'N/A';
  const modeBtn = document.getElementById('btn-visual-mode');
  const modeBtnText = modeBtn ? modeBtn.textContent.trim() : 'NO_BTN';
  // 檢查蛇頭方向標記是否存在
  const canvas = document.querySelector('#canvas-container canvas');
  const gl = canvas ? canvas.getContext('webgl2') || canvas.getContext('webgl') : null;
  return {
    startScreenVisible: startScreen ? !startScreen.classList.contains('hidden') : 'N/A',
    gameoverVisible: gameoverScreen ? !gameoverScreen.classList.contains('hidden') : 'N/A',
    scoreText,
    modeBtnText,
    canvasW: canvas ? canvas.width : 0,
    canvasH: canvas ? canvas.height : 0,
    glType: gl ? (gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : 'none',
  };
});

console.log('=== STATE ===');
console.log(JSON.stringify(state, null, 2));
console.log('=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : 'none');

// 截圖
try {
  await page.screenshot({ path: 'scripts/smoke-after.png' });
  console.log('screenshot saved');
} catch (e) {
  console.log('screenshot err: ' + e.message);
}

await browser.close();
