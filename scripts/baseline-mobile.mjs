import { launch, newPage, measureSaturatedRatio, measureWhiteHighlight } from '../tests/harness.js';
import fs from 'node:fs';

// Capture a valid mobile in-game frame at a FIXED early time (before the
// ~4.3s wall-crash), so baseline and after are apples-to-apples.
const outDir = process.argv[2] || 'baseline';
const browser = await launch();
const page = await newPage(browser, { width: 390, height: 844 });

try {
  await page.waitForSelector('#start-screen', { state: 'visible', timeout: 15000 });
  await page.click('#btn-start');
  // Wait a fixed early time when the snake is still alive (straight line up),
  // well before the ~4.3s wall crash. Do NOT press keys (keeps it alive).
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/mobile-game.png`, fullPage: false });

  const sat = await measureSaturatedRatio(page);
  const white = await measureWhiteHighlight(page);
  const meta = {
    label: 'mobile', width: 390, height: 844, mode: 'game',
    screenshot: `${outDir}/mobile-game.png`,
    saturatedRatio: Number((sat.saturatedRatio * 100).toFixed(3)),
    whiteHighlightRatio: Number((white.whiteRatio * 100).toFixed(3)),
    capturedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(meta));
} finally {
  await browser.close();
}
