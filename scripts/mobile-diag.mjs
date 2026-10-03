import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = 'verify';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'networkidle', timeout: 20000 });
await page.click('#btn-start', { timeout: 5000 });
await page.waitForTimeout(800);

// Poll gameover screen; record elapsed ms when it first appears.
let overMs = null;
let ticks = 0;
const t0 = Date.now();
for (let i = 0; i < 120; i++) {
  const over = await page.$eval('#gameover-screen', (el) => !el.classList.contains('hidden')).catch(() => false);
  if (over) { overMs = Date.now() - t0; break; }
  ticks++;
  await page.waitForTimeout(100);
}

// Capture whatever is on screen (in-game if still running, else game-over).
await page.screenshot({ path: `${OUT}/mobile-diag.png`, fullPage: false });

const score = await page.$eval('#score', (el) => el.innerText).catch(() => 'n/a');
console.log('mobile gameover after (ms):', overMs, '| ticks:', ticks, '| score:', score);
console.log('errors:', errors.length ? errors.join('; ') : 'none');

await browser.close();
