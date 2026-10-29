import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, '../shots');
mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:8765/watch/';

const browser = await chromium.launch({ headless: true });
const results = [];

async function shot(page, name) {
  const path = join(out, name);
  await page.screenshot({ path, fullPage: false });
  results.push(path);
  console.log('shot', name);
}

// Desktop demo home
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'desktop-home.png');

  // Guide
  await page.click('button[data-nav="guide"]');
  await page.waitForTimeout(500);
  await shot(page, 'desktop-guide.png');

  // Sports
  await page.click('button[data-nav="sports"]');
  await page.waitForTimeout(400);
  await shot(page, 'desktop-sports.png');

  // Keyboard: arrow down a few times
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await shot(page, 'desktop-player.png');
  // Back
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Gate without demo
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, 'desktop-gate-coming-soon.png');

  // Bad playlist via add (demo mode)
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.click('button[data-nav="settings"]');
  await page.waitForTimeout(200);
  await page.click('button[data-nav="add"]');
  await page.waitForTimeout(200);
  await page.fill('#m3uUrl', 'https://example.invalid/nope.m3u');
  await page.click('button[data-act="submit-playlist"]');
  await page.waitForTimeout(1500);
  const err = await page.textContent('#addErr');
  console.log('bad playlist err:', err);
  results.push('bad-playlist:' + (err || ''));

  // Mixed content message — inject a channel play with http url via console
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const { play, attachVideo, stop } = await import('./js/player.js');
    // create video
  });
  // Play by patching first channel url temporarily through UI is hard; call player module via page
  const mixed = await page.evaluate(async () => {
    const mod = await import(new URL('./js/player.js', location.href).href);
    const v = document.createElement('video');
    document.body.appendChild(v);
    mod.attachVideo(v);
    const r = await mod.play('http://example.com/stream.ts');
    mod.stop();
    v.remove();
    return r;
  });
  console.log('mixed content result', mixed);
  results.push('mixed:' + JSON.stringify(mixed));

  await ctx.close();
}

// Phone
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'phone-home.png');
  await page.click('button[data-nav="guide"]');
  await page.waitForTimeout(500);
  await shot(page, 'phone-guide.png');
  await ctx.close();
}

// Memory / long playback sampling
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('button[data-play-key]');
  await page.waitForTimeout(2000);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const m = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);
    samples.push(m);
    await page.waitForTimeout(5000);
  }
  console.log('heap samples (bytes)', samples);
  results.push('heap:' + JSON.stringify(samples));
  await shot(page, 'desktop-player-long.png');
  await ctx.close();
}

await browser.close();
console.log('DONE', results.length);
