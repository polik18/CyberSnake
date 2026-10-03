import { chromium } from '@playwright/test';

async function run(reduce) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  if (reduce) {
    await page.addInitScript(() => {
      window.__rmOverride = (q) => ({ matches: /reduce/.test(q), media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false;} });
      Object.defineProperty(window, 'matchMedia', { writable: true, value: (q) => window.__rmOverride(q) });
    });
  }

  await page.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.click('#btn-start', { timeout: 5000 });

  // Continuously sample bloom strength during gameplay to catch the peak pulse.
  let maxBloom = 0;
  const sample = async () => {
    try {
      const v = await page.evaluate(() => { const o = window.__rmObjects; return o ? o.bloomPass.strength : 0; });
      if (v > maxBloom) maxBloom = v;
    } catch {}
  };
  let over = false;
  for (let i = 0; i < 80; i++) {
    await sample();
    if (!over) {
      over = await page.$eval('#gameover-screen', (el) => !el.classList.contains('hidden')).catch(() => false);
      if (over) break;
      await page.keyboard.press('ArrowUp');
    }
    await page.waitForTimeout(100);
  }

  console.log(`reduce=${reduce}: maxBloom=${maxBloom.toFixed(3)} gameoverVisible=${over}`);
  await browser.close();
}

await run(false);
await run(true).catch((e) => console.log('run(true) threw:', e.message));
console.log('done');
