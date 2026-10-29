/**
 * Port of TYTV Android M3uParser.kt — line-based M3U/M3U8, no regex per line.
 * Handles #EXTM3U (url-tvg / x-tvg-url / tvg-url), #EXTINF attrs, #EXTGRP, #EXTVLCOPT:http-user-agent.
 */
export function findTitleComma(s, from) {
  let inQuote = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ',' && !inQuote) return i;
  }
  return -1;
}

export function parseAttributes(s, from = 0) {
  const out = Object.create(null);
  let i = from;
  const n = s.length;
  while (i < n) {
    while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
    const keyStart = i;
    while (i < n && s[i] !== '=' && s[i] !== ' ' && s[i] !== '\t') i++;
    if (i >= n || s[i] !== '=') continue;
    const key = s.slice(keyStart, i).toLowerCase();
    i++;
    let value;
    if (i < n && (s[i] === '"' || s[i] === "'")) {
      const q = s[i];
      i++;
      const vs = i;
      while (i < n && s[i] !== q) i++;
      value = s.slice(vs, i);
      if (i < n) i++;
    } else {
      const vs = i;
      while (i < n && s[i] !== ' ' && s[i] !== '\t') i++;
      value = s.slice(vs, i);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function normalizeName(name) {
  let sb = '';
  for (const ch of name) {
    const c = ch.toLowerCase();
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb += c;
  }
  return sb;
}

export function epgKeyFor(tvgId, name) {
  if (tvgId && tvgId.trim()) return tvgId.trim().toLowerCase();
  return 'name:' + normalizeName(name || '');
}

/**
 * @param {string} text
 * @param {string} playlistId
 * @returns {{ channels: object[], epgUrls: string[] }}
 */
export function parseM3u(text, playlistId = 'default') {
  const channels = [];
  const epgUrls = new Set();
  let pendingAttrs = null;
  let pendingName = '';
  let pendingGroup = null;
  let pendingUa = '';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let raw of lines) {
    const line = raw.trim().replace(/^\uFEFF/, '');
    if (!line) continue;
    if (line.startsWith('#')) {
      const lower = line.toLowerCase();
      if (lower.startsWith('#extm3u')) {
        const a = parseAttributes(line, 7);
        for (const k of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
          if (!a[k]) continue;
          for (const u of a[k].split(',').map((x) => x.trim()).filter(Boolean)) epgUrls.add(u);
        }
      } else if (lower.startsWith('#extinf')) {
        const colon = line.indexOf(':');
        const start = colon >= 0 ? colon + 1 : 7;
        const commaIdx = findTitleComma(line, start);
        const attrPart = commaIdx >= 0 ? line.slice(start, commaIdx) : line.slice(start);
        pendingAttrs = parseAttributes(attrPart, 0);
        pendingName = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      } else if (lower.startsWith('#extgrp:')) {
        pendingGroup = line.slice(8).trim();
      } else if (lower.startsWith('#extvlcopt:')) {
        const opt = line.slice(11);
        if (opt.toLowerCase().startsWith('http-user-agent=')) pendingUa = opt.slice(opt.indexOf('=') + 1).trim();
      }
      continue;
    }
    if (!line.includes('://')) {
      pendingAttrs = null;
      pendingName = '';
      pendingGroup = null;
      pendingUa = '';
      continue;
    }
    const attrs = pendingAttrs || {};
    const name = pendingName || attrs['tvg-name'] || line.slice(line.lastIndexOf('/') + 1);
    const group =
      (attrs['group-title'] && attrs['group-title'].trim()) ||
      (pendingGroup && pendingGroup.trim()) ||
      'Uncategorized';
    const tvgId = (attrs['tvg-id'] || '').trim();
    const tvgName = (attrs['tvg-name'] || '').trim();
    const ch = {
      playlistId,
      name,
      url: line,
      group: group.trim(),
      tvgId,
      tvgName,
      logo: (attrs['tvg-logo'] || attrs['logo'] || '').trim(),
      catchup: attrs['catchup'] || attrs['catchup-type'] || '',
      catchupDays: parseInt((attrs['catchup-days'] || attrs['timeshift'] || '').trim(), 10) || 0,
      catchupSource: attrs['catchup-source'] || '',
      userAgent: pendingUa || attrs['user-agent'] || '',
    };
    ch.key = `${playlistId}|${ch.url}`;
    ch.groupKey = `${playlistId}|${ch.group}`;
    ch.epgKey = epgKeyFor(tvgId, tvgName || name);
    channels.push(ch);
    pendingAttrs = null;
    pendingName = '';
    pendingGroup = null;
    pendingUa = '';
  }
  return { channels, epgUrls: [...epgUrls] };
}

/** Xtream get.php m3u_plus URL (same fallback the TV app uses). */
export function xtreamM3uUrl(server, username, password) {
  let s = (server || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/player_api\.php$/i, '').replace(/\/get\.php$/i, '');
  const u = new URL(s + '/get.php');
  u.searchParams.set('username', username);
  u.searchParams.set('password', password);
  u.searchParams.set('type', 'm3u_plus');
  u.searchParams.set('output', 'ts');
  return u.toString();
}

export function xtreamEpgUrl(server, username, password) {
  let s = (server || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/player_api\.php$/i, '').replace(/\/get\.php$/i, '');
  const u = new URL(s + '/xmltv.php');
  u.searchParams.set('username', username);
  u.searchParams.set('password', password);
  return u.toString();
}
