import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, '../shots');
mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:8765/watch/';
let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else { failed++; console.error('FAIL', name, detail || ''); }
}

const browser = await chromium.launch({ headless: true });

async function shot(page, name) {
  await page.screenshot({ path: join(out, name), fullPage: false });
  console.log('shot', name);
}

// --- Gate (no demo) ---
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const text = await page.textContent('#app');
  ok('gate coming soon', /Coming soon/i.test(text||''));
  ok('gate no demo hint', !/\?demo=1/i.test(text||'') && !/QA/i.test(text||''));
  await shot(page, 'desktop-gate-coming-soon.png');

  // localStorage unlock trick must NOT open player
  await page.evaluate(() => {
    localStorage.setItem('tytv_web_license', JSON.stringify({ unlocked: true, email: 'hacker@example.com', device_id: 'web-x' }));
    sessionStorage.setItem('tytv_demo', '1');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const t2 = await page.textContent('#app');
  ok('localStorage unlock blocked', /Unlock to watch|Coming soon/i.test(t2||'') && !/Metro Sports/i.test(t2||''));
  ok('sessionStorage demo alone blocked', !/Metro Sports/i.test(t2||''));
  await ctx.close();
}

// --- Demo lockdown ---
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const home = await page.textContent('#app');
  ok('demo label', /Demo with made-up channels/i.test(home||''));
  ok('demo loaded channels', /Metro Sports/i.test(home||''));
  ok('featured hero', /Featured/i.test(home||'') && (/Glass Harbor|Metro Sports/i.test(home||'')));
  await shot(page, 'desktop-home.png');

  // Try navigate to add via UI
  const addBtn = await page.$('button[data-nav="add"]');
  ok('no add playlist button in rail/settings home', !addBtn);

  await page.click('button[data-nav="settings"]');
  await page.waitForTimeout(300);
  const settings = await page.textContent('#app');
  ok('settings no add', !/Add \/ replace playlist/i.test(settings||''));
  ok('settings demo label', /Demo with made-up channels/i.test(settings||''));

  // Force submit-playlist via evaluate (code path)
  const blocked = await page.evaluate(async () => {
    const mod = await import(new URL('./js/app.js', location.href).href).catch(() => null);
    // Call fetch path indirectly by dispatching
    const root = document.getElementById('app');
    // inject fake add UI and click
    const b = document.createElement('button');
    b.dataset.act = 'submit-playlist';
    root.appendChild(b);
    // Also try loading remote via stolen internals — use dynamic import of m3u + fetch
    try {
      // Simulate what submit would do: fetch remote then — app blocks at fetchRemotePlaylist
      const { parseM3u } = await import(new URL('./js/m3u.js', location.href).href);
      // Directly poke License + try to use player after injecting channels through storage
      localStorage.setItem('tytv_watch_v1', JSON.stringify({
        playlists: [{ id: 'evil', name: 'Evil', type: 'M3U', url: 'https://example.com/evil.m3u' }],
        favorites: [], profiles: [{ id: 'default', name: 'You', color: 1 }], activeProfileId: 'default',
        theme: 'Neon Blue', homeLayout: 'featured', lastChannelKey: '', resume: [],
      }));
    } catch (e) {
      return { err: String(e) };
    }
    return { ok: true };
  });
  ok('localStorage playlist planted', blocked.ok);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const after = await page.textContent('#app');
  ok('demo ignores stored evil playlist', /Metro Sports/i.test(after||'') && !/Evil/i.test(after||''));
  // Channel count should still be demo (18) — Live groups from demo
  ok('still demo groups', /Coastal News|Harbor Classics|Nova Comedy/i.test(after||''));

  // Try injecting load via console-like evaluate of fetchRemotePlaylist
  const fr = await page.evaluate(async () => {
    const player = await import(new URL('./js/player.js', location.href).href);
    // Can't import app private fns; hit Add by changing location hash and clicking injected control
    const btn = document.createElement('button');
    btn.setAttribute('data-nav', 'add');
    document.getElementById('app').appendChild(btn);
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    return document.body.innerText.includes('Add playlist') && document.body.innerText.includes('M3U URL');
  });
  ok('add screen blocked or not real form', fr === false || /Demo with made-up channels/i.test(await page.textContent('#app')));

  // Guide + player shots
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('button[data-nav="guide"]');
  await page.waitForTimeout(400);
  await shot(page, 'desktop-guide.png');
  await page.click('button[data-nav="sports"]');
  await page.waitForTimeout(300);
  await shot(page, 'desktop-sports.png');
  const playBtn = await page.$('button[data-play-key], button.ch-row, button.card');
  if (playBtn) await playBtn.click();
  else {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(2500);
  // Force chrome visible for screenshot / assert player shell
  await page.evaluate(() => {
    const c = document.getElementById('playerChrome') || document.querySelector('.player-chrome');
    if (c) c.classList.add('show');
  });
  const playerText = await page.textContent('#app');
  ok('player shell', /player-screen|Now|Next|Pause|Back/i.test(playerText||'') || !!await page.$('.player-screen'));
  ok('player channel name', /Metro Sports|Coastal|Harbor|Summit/i.test(playerText||''));
  const hasVideoOrFallback = await page.evaluate(() => {
    const v = document.getElementById('playerVideo');
    const fb = document.getElementById('playerError');
    const chrome = document.getElementById('playerChrome');
    const playing = v && v.readyState >= 2 && !v.error;
    const fallbackVisible = fb && !fb.classList.contains('hidden');
    const chromeOk = !!chrome;
    return { playing, fallbackVisible, chromeOk, readyState: v?.readyState, err: v?.error?.message || null };
  });
  ok('player not blank', hasVideoOrFallback.chromeOk && (hasVideoOrFallback.playing || hasVideoOrFallback.fallbackVisible), hasVideoOrFallback);
  await shot(page, 'desktop-player.png');
  await page.keyboard.press('Escape');
  await ctx.close();
}

// Phone
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await shot(page, 'phone-gate-coming-soon.png');
  await page.goto(base + '?demo=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const phoneHome = await page.textContent('#app');
  ok('phone featured hero', /Featured/i.test(phoneHome||''));
  await shot(page, 'phone-home.png');
  await page.click('button[data-nav="guide"]');
  await page.waitForTimeout(400);
  await shot(page, 'phone-guide.png');
  await ctx.close();
}

await browser.close();

// Banned-word scan on production watch files (not tests)
const bannedNeedles = ['iptv', 'espn', 'hbo', 'cnn', 'fox news', 'sky sports', 'usa network', 'netflix', 'disney+'];
const root = join(dir, '..');
function walk(d, acc = []) {
  for (const name of readdirSync(d)) {
    const pth = join(d, name);
    const st = statSync(pth);
    if (st.isDirectory()) {
      if (name === 'shots' || name === 'node_modules' || name === 'tests') continue;
      walk(pth, acc);
    } else if (/\.(js|css|html|m3u|xml|svg)$/i.test(name)) acc.push(pth);
  }
  return acc;
}
const files = walk(root);
let bannedHits = 0;
for (const f of files) {
  const body = readFileSync(f, 'utf8').toLowerCase();
  for (const needle of bannedNeedles) {
    if (body.includes(needle)) {
      bannedHits++;
      console.error('BANNED', needle, f);
    }
  }
}
ok('no IPTV / real channel names', bannedHits === 0, bannedHits);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('UI + lockdown tests passed');
