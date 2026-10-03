// Baseline screenshot + metric capture for CyberSnake Phase 0.
// Captures before-state screenshots and visual comfort metrics.
// Usage: node scripts/baseline.mjs [--size 1440x900|390x844] [--out baseline]

import { launch, newPage, enterGame, playSession, measureSaturatedRatio, measureWhiteHighlight } from '../tests/harness.js';

const sizes = process.argv.includes('--all')
  ? [['desktop', 1440, 900], ['mobile', 390, 844]]
  : [['desktop', 1440, 900], ['mobile', 390, 844]];

const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'baseline';
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'start';

const browser = await launch();
const results = [];

try {
  for (const [label, w, h] of sizes) {
    const page = await newPage(browser, { width: w, height: h });

    if (mode === 'start') {
      await page.waitForSelector('#start-screen', { state: 'visible', timeout: 15000 });
    } else {
      await playSession(page, { durationMs: 4000 });
    }

    const shot = `${outDir}/${label}-${mode}`;
    await page.screenshot({ path: `${shot}.png`, fullPage: false });

    const sat = mode === 'start' ? { ratio: 0 } : await measureSaturatedRatio(page);
    const white = mode === 'start' ? { ratio: 0 } : await measureWhiteHighlight(page);

    const meta = {
      label,
      width: w,
      height: h,
      mode,
      screenshot: `${shot}.png`,
      saturatedRatio: Number((sat.saturatedRatio * 100).toFixed(3)),
      whiteHighlightRatio: Number((white.whiteRatio * 100).toFixed(3)),
      capturedAt: new Date().toISOString(),
    };
    results.push(meta);
    console.log(JSON.stringify(meta));

    await page.close();
  }

  const report = { tool: 'cybersnake-baseline', generatedAt: new Date().toISOString(), baseCommit: process.env.BASE_COMMIT || 'unknown', results };
  await import('node:fs').then(fs => fs.writeFileSync(`${outDir}/baseline-report.json`, JSON.stringify(report, null, 2)));
  console.log(`\nWrote ${outDir}/baseline-report.json`);
} finally {
  await browser.close();
}
