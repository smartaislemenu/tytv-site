/**
 * Email + OTP unlock gate — same Worker API as the TV app License.kt.
 * When the Worker is unreachable: coming-soon mode (player stays locked).
 * ?demo=1 enables local demo unlock for QA only (not a real license).
 */
const PREFS = 'tytv_web_license';
export const LICENSE_API_BASE = ''; // set when Worker is live, e.g. https://license.tytvapp.com

function prefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}');
  } catch {
    return {};
  }
}
function writePrefs(p) {
  localStorage.setItem(PREFS, JSON.stringify(p));
}

export function deviceId() {
  const p = prefs();
  if (p.device_id) return p.device_id;
  const id = (crypto.randomUUID && crypto.randomUUID()) || 'web-' + Math.random().toString(36).slice(2) + Date.now();
  // Prefix so admin can tell web devices apart when label/device_type lands in Worker
  const webId = id.startsWith('web-') ? id : 'web-' + id;
  writePrefs({ ...p, device_id: webId, device_type: 'web' });
  return webId;
}

export function normalizeEmail(s) {
  const e = (s || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export function isUnlocked() {
  if (isDemoMode()) return true;
  const p = prefs();
  return !!(p.unlocked && p.email && String(p.email).includes('@'));
}

export function storedEmail() {
  return prefs().email || '';
}

export function markUnlocked(email) {
  writePrefs({
    ...prefs(),
    unlocked: true,
    email: normalizeEmail(email) || email.toLowerCase(),
    unlocked_at: Date.now(),
    last_check: Date.now(),
    device_type: 'web',
  });
}

export function clearLocal() {
  const id = deviceId();
  writePrefs({ device_id: id, device_type: 'web' });
}

export function isDemoMode() {
  const q = new URLSearchParams(location.search);
  if (q.get('demo') === '1') {
    sessionStorage.setItem('tytv_demo', '1');
    return true;
  }
  return sessionStorage.getItem('tytv_demo') === '1';
}

export function clearDemoMode() {
  sessionStorage.removeItem('tytv_demo');
}

async function postJson(path, body) {
  const base = LICENSE_API_BASE.trim().replace(/\/$/, '');
  if (!base) {
    return { kind: 'unavailable' };
  }
  try {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    if (!r.ok) return { kind: 'http', code: r.status, json };
    return { kind: 'ok', json };
  } catch (e) {
    return { kind: 'net', error: e };
  }
}

export async function requestOtp(emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: 'Enter a valid email address.' };
  const r = await postJson('/v1/otp/request', { email, device_id: deviceId(), device_type: 'web' });
  if (r.kind === 'unavailable') {
    return { ok: false, error: 'coming_soon', message: 'Unlock is almost ready. Payments and email codes go live with the paid plan.' };
  }
  if (r.kind === 'net') return { ok: false, error: "Can't reach the license server. Check your internet." };
  if (r.kind === 'http') {
    if (r.code === 429) return { ok: false, error: 'Too many tries. Wait a minute and try again.' };
    return { ok: false, error: "Couldn't send a code. Try again." };
  }
  return { ok: true, message: r.json?.message || 'If this email has TYTV access, a code was sent.' };
}

export async function verifyOtp(emailRaw, otpRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: 'Enter a valid email.' };
  const otp = String(otpRaw || '').replace(/\D/g, '');
  if (otp.length !== 6) return { ok: false, error: 'Enter the 6-digit code from your email.' };
  const r = await postJson('/v1/otp/verify', { email, otp, device_id: deviceId(), device_type: 'web' });
  if (r.kind === 'unavailable') {
    return { ok: false, error: 'coming_soon', message: 'Unlock is almost ready. Use the TV app for now.' };
  }
  if (r.kind === 'net') return { ok: false, error: "Can't reach the license server." };
  if (r.kind === 'http') {
    const err = r.json?.error;
    if (err === 'otp_bad') return { ok: false, error: 'Wrong code. Try again.' };
    if (err === 'otp_expired') return { ok: false, error: 'That code expired. Request a new one.' };
    if (err === 'otp_locked') return { ok: false, error: 'Too many wrong tries. Request a new code.' };
    if (err === 'device_limit') return { ok: false, error: 'This email is already used on 2 devices.' };
    if (err === 'no_entitlement') return { ok: false, error: 'No TYTV access on this email yet.' };
    return { ok: false, error: "Couldn't verify. Try again." };
  }
  if (r.json?.ok) {
    markUnlocked(email);
    return { ok: true };
  }
  return { ok: false, error: "Couldn't verify. Try again." };
}

export async function checkHealth() {
  const base = LICENSE_API_BASE.trim().replace(/\/$/, '');
  if (!base) return { available: false, reason: 'not_configured' };
  try {
    const r = await fetch(base + '/health', { method: 'GET' });
    return { available: r.ok, status: r.status };
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}

export async function heartbeat() {
  if (!isUnlocked() || isDemoMode()) return;
  const p = prefs();
  await postJson('/v1/heartbeat', { device_id: deviceId(), email: p.email, device_type: 'web' });
}
