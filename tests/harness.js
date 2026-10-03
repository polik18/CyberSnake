// Shared Playwright harness for CyberSnake visual regression (ESM).
// Loads the static index.html, enters a game, and provides helpers to
// capture baseline screenshots and measure visual comfort metrics.

import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const BASE_URL = process.env.CYBERNAKE_BASE_URL || 'http://127.0.0.1:5174/';

export async function launch() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  return browser;
}

export async function newPage(browser, { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  return page;
}

export async function waitForStart(page) {
  await page.waitForSelector('#start-screen', { state: 'visible', timeout: 15000 });
  await page.waitForSelector('#btn-start', { state: 'visible', timeout: 15000 });
}

// Enter the game by clicking start and waiting for the canvas to render.
export async function enterGame(page, { durationMs = 4000 } = {}) {
  await waitForStart(page);
  await page.click('#btn-start');
  await page.waitForFunction(() => {
    const c = document.getElementById('canvas-container');
    const cv = c && c.querySelector('canvas');
    return cv && cv.width > 0 && cv.height > 0;
  }, { timeout: 15000 });
  await page.waitForTimeout(durationMs);
}

// Play a short session: steer the snake to eat food and build length.
export async function playSession(page, { durationMs = 6000 } = {}) {
  await enterGame(page, { durationMs });
  const moves = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'd', 'w', 's'];
  for (let i = 0; i < 60; i++) {
    const m = moves[i % moves.length];
    await page.keyboard.press(m);
    await page.waitForTimeout(80);
  }
}

// Snapshot the WebGL canvas element to a PNG buffer via Playwright.
async function canvasToPNG(page) {
  const el = page.locator('#canvas-container canvas');
  const buf = await el.screenshot({ type: 'png' });
  return buf;
}

// Compute pixel metrics from a PNG buffer.
function computeMetrics(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const { width, height, data } = png;
  const total = width * height;
  let saturated = 0, white = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b);
    const sat = mx - Math.min(r, g, b);
    if (sat > 90 && mx > 120) saturated++;
    if (r > 240 && g > 240 && b > 240) white++;
  }
  return {
    saturatedPixels: saturated,
    whitePixels: white,
    totalPixels: total,
    saturatedRatio: total ? saturated / total : 0,
    whiteRatio: total ? white / total : 0,
  };
}

// Measure the proportion of "saturated bright" pixels (comfort metric).
export async function measureSaturatedRatio(page) {
  const buf = await canvasToPNG(page);
  if (!buf) return { saturatedPixels: 0, whitePixels: 0, totalPixels: 0, ratio: 0 };
  const r = computeMetrics(buf);
  return { saturatedPixels: r.saturatedPixels, totalPixels: r.totalPixels, saturatedRatio: r.saturatedRatio, whiteRatio: r.whiteRatio };
}

// Count how many near-white pixels exist (the "blinding highlight" metric).
export async function measureWhiteHighlight(page) {
  const buf = await canvasToPNG(page);
  if (!buf) return { whitePixels: 0, totalPixels: 0, ratio: 0 };
  const r = computeMetrics(buf);
  return { whitePixels: r.whitePixels, totalPixels: r.totalPixels, whiteRatio: r.whiteRatio };
}
