/**
 * Port of TYTV Android XmltvParser time + programme mapping (DOMParser for browser).
 */

/** XMLTV time → epoch ms (UTC). */
export function parseTime(s) {
  if (!s || !String(s).trim()) return 0;
  const t = String(s).trim();
  const digits = t.match(/^\d+/)?.[0] || '';
  if (digits.length < 12) return 0;
  const base = (digits + '000000').slice(0, 14);
  const rest = t.slice(digits.length).trim();
  const tz = rest && (rest[0] === '+' || rest[0] === '-') ? rest.slice(0, 5) : '+0000';
  try {
    const y = +base.slice(0, 4);
    const mo = +base.slice(4, 6);
    const d = +base.slice(6, 8);
    const h = +base.slice(8, 10);
    const mi = +base.slice(10, 12);
    const se = +base.slice(12, 14);
    const utc = Date.UTC(y, mo - 1, d, h, mi, se);
    const sign = tz[0] === '-' ? -1 : 1;
    const offMin = tz.length >= 5 ? (+tz.slice(1, 3) * 60 + +tz.slice(3, 5)) : 0;
    return utc - sign * offMin * 60_000;
  } catch {
    return 0;
  }
}

/**
 * @param {string} xmlText
 * @param {{ windowStart?: number, windowEnd?: number, maxPrograms?: number, descMax?: number }} opts
 * @returns {{ programs: Map<string, object[]>, channelNames: Map<string, string[]>, icons: Map<string, string>, truncated: boolean }}
 */
export function parseXmltv(xmlText, opts = {}) {
  const windowStart = opts.windowStart ?? Date.now() - 2 * 3600_000;
  const windowEnd = opts.windowEnd ?? Date.now() + 24 * 3600_000;
  const maxPrograms = opts.maxPrograms ?? 50_000;
  const descMax = opts.descMax ?? 300;

  const programs = new Map();
  const channelNames = new Map();
  const icons = new Map();
  let truncated = false;
  let kept = 0;

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Guide file is not valid XML');
  }

  for (const ch of doc.querySelectorAll('channel')) {
    const id = ch.getAttribute('id') || '';
    const names = [...ch.querySelectorAll('display-name')].map((n) => n.textContent.trim()).filter(Boolean);
    channelNames.set(id, names);
    const icon = ch.querySelector('icon')?.getAttribute('src');
    if (icon && icon.length >= 4 && icon.length <= 1000) icons.set(id, icon.trim());
  }

  for (const p of doc.querySelectorAll('programme')) {
    if (kept >= maxPrograms) {
      truncated = true;
      break;
    }
    const ch = (p.getAttribute('channel') || '').trim().toLowerCase();
    const start = parseTime(p.getAttribute('start'));
    let stop = parseTime(p.getAttribute('stop'));
    if (stop <= 0) stop = start + 30 * 60_000;
    if (start <= 0 || stop < windowStart || start > windowEnd) continue;

    let title = p.querySelector('title')?.textContent?.trim() || '';
    let desc = p.querySelector('desc')?.textContent?.trim() || '';
    const sub = p.querySelector('sub-title')?.textContent?.trim() || '';
    if (!desc && sub) desc = sub;
    const categories = [...p.querySelectorAll('category')].map((c) => c.textContent.trim()).filter(Boolean);
    if (desc.length > descMax) desc = desc.slice(0, descMax);

    const prog = { channelId: ch, start, stop, title, desc, categories };
    if (!programs.has(ch)) programs.set(ch, []);
    programs.get(ch).push(prog);
    kept++;
  }

  for (const list of programs.values()) list.sort((a, b) => a.start - b.start);
  return { programs, channelNames, icons, truncated };
}

export function programAt(list, t) {
  if (!list) return null;
  for (const p of list) {
    if (t >= p.start && t < p.stop) return p;
  }
  return null;
}

export function progress(p, now) {
  if (!p || p.stop <= p.start) return 0;
  return Math.min(1, Math.max(0, (now - p.start) / (p.stop - p.start)));
}

export function formatClock(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
