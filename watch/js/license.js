/**
 * Email + OTP unlock gate — same Worker API as the TV app License.kt.
 * Web unlocks require a server-issued session_token and do NOT use a TV device slot.
 * When the Worker is unreachable: coming-soon mode (player stays locked).
 * ?demo=1 opens a restricted demo (bundled made-up channels only — not a paid unlock).
 */
const PREFS = 'tytv_web_license';
export const LICENSE_API_BASE = 'https://license.tytvapp.com';

/** How long a paying user may stay unlocked if the license server is unreachable. */
const GRACE_MS = 72 * 60 * 60 * 1000;
/** Re-check entitlement with the server this often while the player is open. */
export const RECHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

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
  const webId = id.startsWith('web-') ? id : 'web-' + id;
  writePrefs({ ...p, device_id: webId, device_type: 'web' });
  return webId;
}

export function normalizeEmail(s) {
  const e = (s || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function hasSessionToken(p) {
  return typeof p.session_token === 'string' && /^[a-f0-9]{64}$/i.test(p.session_token);
}

/**
 * Local hint only. A forged unlocked flag without a real session_token is ignored.
 * Boot always confirms with the server via recheckLicense().
 */
export function isUnlocked() {
  if (isDemoMode()) return false; // demo is not a license unlock
  const base = LICENSE_API_BASE.trim();
  if (!base) return false;
  const p = prefs();
  return !!(p.unlocked && p.email && String(p.email).includes('@') && hasSessionToken(p));
}

/** True when the URL explicitly asks for the made-up demo (?demo=1). Not persisted via sessionStorage. */
export function isDemoMode() {
  try {
    return new URLSearchParams(location.search).get('demo') === '1';
  } catch {
    return false;
  }
}

/** UI may show the player shell for demo OR a real unlock. */
export function canUsePlayerShell() {
  return isDemoMode() || isUnlocked();
}

export function storedEmail() {
  return prefs().email || '';
}

export function markUnlocked(email, sessionToken, expiresAtIso) {
  const token = String(sessionToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    clearLocal();
    return;
  }
  const next = {
    ...prefs(),
    unlocked: true,
    email: normalizeEmail(email) || email.toLowerCase(),
    session_token: token,
    unlocked_at: Date.now(),
    last_check: Date.now(),
    last_check_ok: true,
    device_type: 'web',
  };
  if (expiresAtIso) next.expires_at = expiresAtIso;
  else delete next.expires_at;
  writePrefs(next);
}

/** "Access ends … (N days left)" or null for lifetime. */
export function accessEndsLabel(nowMs = Date.now()) {
  const iso = prefs().expires_at;
  if (!iso) return null;
  const expMs = Date.parse(iso);
  if (!Number.isFinite(expMs)) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const daysLeft = Math.max(0, Math.ceil((expMs - nowMs) / dayMs));
  const date = new Date(expMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `Access ends ${date} (${daysLeft} days left)`;
}

export function clearLocal() {
  const id = deviceId();
  writePrefs({ device_id: id, device_type: 'web' });
}

export function clearDemoMode() {
  // Demo is URL-only; nothing to clear. Kept for callers.
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
    if (err === 'otp_bad' || err === 'invalid') return { ok: false, error: 'Wrong code. Try again.' };
    if (err === 'otp_expired') return { ok: false, error: 'That code expired. Request a new one.' };
    if (err === 'otp_locked') return { ok: false, error: 'Too many wrong tries. Request a new code.' };
    if (err === 'device_limit') return { ok: false, error: 'This email is already used on 5 TV or phone devices.' };
    if (err === 'no_entitlement') return { ok: false, error: 'No TYTV access on this email yet.' };
    return { ok: false, error: "Couldn't verify. Try again." };
  }
  if (r.json?.ok && r.json?.session_token) {
    markUnlocked(email, r.json.session_token, r.json.expires_at || null);
    return { ok: true, expires_at: r.json.expires_at || null };
  }
  // Server must return a session_token for web — never trust a bare ok.
  clearLocal();
  return { ok: false, error: "Couldn't verify. Try again." };
}

export async function redeemPromo(emailRaw, codeRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, error: 'Enter a valid email address.' };
  const code = String(codeRaw || '').replace(/\D/g, '');
  if (code.length !== 8) return { ok: false, error: 'Promo codes are 8 digits.' };
  const r = await postJson('/v1/redeem', { email, code, device_id: deviceId(), device_type: 'web' });
  if (r.kind === 'unavailable') {
    return { ok: false, error: 'coming_soon', message: 'Promo redeem is almost ready.' };
  }
  if (r.kind === 'net') return { ok: false, error: "Can't reach the license server. Check your internet." };
  if (r.kind === 'http') {
    const err = r.json?.error;
    if (err === 'code_expired') return { ok: false, error: 'That promo code has expired.' };
    if (err === 'code_exhausted') return { ok: false, error: 'That promo code has already been used.' };
    if (err === 'invalid' || err === 'not_found') return { ok: false, error: "That promo code isn't right." };
    return { ok: false, error: "Couldn't redeem. Try again." };
  }
  if (r.json?.ok) {
    return { ok: true, message: r.json.message || 'Promo applied. Next, email yourself a one-time code.', access_days: r.json.access_days ?? null };
  }
  return { ok: false, error: "Couldn't redeem. Try again." };
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

/**
 * Confirm the stored session with the license Worker.
 * Returns: { ok: true } | { ok: false, reason: 'locked'|'network', message? }
 * Network errors keep a recently-validated session unlocked (grace). Forged or revoked → locked.
 */
export async function recheckLicense() {
  if (isDemoMode()) return { ok: true, demo: true };
  const p = prefs();
  if (!p.email || !hasSessionToken(p)) {
    clearLocal();
    return { ok: false, reason: 'locked', message: 'Sign in with your email and code.' };
  }
  const r = await postJson('/v1/check', {
    email: p.email,
    device_id: deviceId(),
    device_type: 'web',
    session_token: p.session_token,
  });
  if (r.kind === 'ok' && r.json?.ok) {
    const next = { ...prefs(), last_check: Date.now(), last_check_ok: true, unlocked: true };
    if (r.json.expires_at) next.expires_at = r.json.expires_at;
    else delete next.expires_at;
    writePrefs(next);
    return { ok: true, expires_at: r.json.expires_at || null };
  }
  if (r.kind === 'net' || r.kind === 'unavailable') {
    // Cap offline grace so timed access cannot outlast expires_at + GRACE_MS
    if (p.expires_at) {
      const expMs = Date.parse(p.expires_at);
      if (Number.isFinite(expMs) && Date.now() > expMs + GRACE_MS) {
        clearLocal();
        return { ok: false, reason: 'locked', message: 'This promo access has ended. Buy unlock or use a promo code.' };
      }
    }
    const last = Number(p.last_check || p.unlocked_at || 0);
    if (last && Date.now() - last < GRACE_MS) {
      writePrefs({ ...prefs(), last_check_ok: false, last_check_attempt: Date.now() });
      return { ok: true, grace: true };
    }
    clearLocal();
    return { ok: false, reason: 'locked', message: "Couldn't confirm your unlock. Sign in again." };
  }
  // HTTP error from server: revoked, expired, invalid session — lock hard.
  const err = r.json?.error;
  clearLocal();
  if (err === 'expired') {
    return { ok: false, reason: 'locked', message: 'This promo access has ended. Buy unlock or use a promo code.' };
  }
  return { ok: false, reason: 'locked', message: 'This unlock is no longer active. Buy or sign in again.' };
}

export async function heartbeat() {
  if (!isUnlocked() || isDemoMode()) return;
  const p = prefs();
  await postJson('/v1/heartbeat', { device_id: deviceId(), email: p.email, device_type: 'web' });
}
