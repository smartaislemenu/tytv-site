/**
 * Timed-access helpers for /watch license.js (node; mock localStorage).
 */
import assert from 'assert';
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../js/license.js');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { search: '' };
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '11111111-2222-3333-4444-555555555555' },
    configurable: true,
  });
}

const mod = await import(pathToFileURL(srcPath).href);

store.clear();
assert.strictEqual(mod.accessEndsLabel(), null);

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);
const exp = new Date(now + 7 * day).toISOString();
mod.markUnlocked('dad@example.com', 'a'.repeat(64), exp);
const label = mod.accessEndsLabel(now);
assert.ok(label && label.startsWith('Access ends '), label);
assert.ok(label.includes('7 days left'), label);
assert.ok(!label.toLowerCase().includes('free access'), label);

mod.markUnlocked('dad@example.com', 'b'.repeat(64), null);
assert.strictEqual(mod.accessEndsLabel(now), null);

console.log('license.test.mjs: ok');
