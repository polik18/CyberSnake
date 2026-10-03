import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = 'verify';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'networkidle', timeout: 20000 });
await page.click('#btn-start', { timeout: 5000 });
await page.waitForTimeout(1500);

// 1. Marker direction follows a turn: press RIGHT, wait for head to rotate.
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/marker-after-right.png`, fullPage: false });

// 2. Toggle visual mode (comfort <-> neon)
const toggleTextBefore = await (await page.$('#btn-visual-mode')).textContent();
await page.click('#btn-visual-mode');
await page.waitForTimeout(800);
const toggleTextAfter = await (await page.$('#btn-visual-mode')).textContent();
await page.screenshot({ path: `${OUT}/after-toggle.png`, fullPage: false });
console.log('=== VISUAL TOGGLE ===');
console.log('before:', toggleTextBefore, '| after:', toggleTextAfter, '| changed:', toggleTextBefore !== toggleTextAfter);

// 3. Pause -> pause-screen shows -> resume -> hides
await page.click('#btn-pause', { timeout: 3000 });
await page.waitForTimeout(500);
const pauseVisible = await page.$eval('#pause-screen', (el) => !el.classList.contains('hidden'));
await page.click('#btn-resume', { timeout: 3000 });
await page.waitForTimeout(500);
const pauseHidden = await page.$eval('#pause-screen', (el) => el.classList.contains('hidden'));
console.log('=== PAUSE/RESUME ===');
console.log('pause-screen visible after pause:', pauseVisible, '| hidden after resume:', pauseHidden);

// 4. Force a game-over by holding a single direction until the head hits a wall.
let overVisible = false;
await page.keyboard.press('ArrowDown');
for (let i = 0; i < 60; i++) {
  overVisible = await page.$eval('#gameover-screen', (el) => !el.classList.contains('hidden')).catch(() => false);
  if (overVisible) break;
  await page.waitForTimeout(250);
}
console.log('=== GAME OVER ===');
console.log('gameover-screen appeared:', overVisible);

if (overVisible) {
  await page.click('#btn-restart', { timeout: 3000 });
  await page.waitForTimeout(1000);
  const restartOk = await page.$eval('#gameover-screen', (el) => el.classList.contains('hidden'));
  console.log('=== RESTART ===');
  console.log('restart closed gameover-screen:', restartOk);
} else {
  console.log('game-over not triggered; screenshot running scene');
}

console.log('=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : 'none');

await browser.close();
