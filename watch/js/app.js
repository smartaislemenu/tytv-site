/**
 * TYTV Watch — web player SPA matching Android TV rail / home / guide / VOD / player.
 */
import { parseM3u, xtreamM3uUrl, xtreamEpgUrl } from './m3u.js';
import { split, groupChannels } from './vod.js';
import { parseXmltv, programAt, progress, formatClock } from './epg.js';
import * as Store from './store.js';
import * as License from './license.js';
import * as Player from './player.js';

const DEMO_PLAYLIST = new URL('../demo/playlist.m3u', import.meta.url).href;
const DEMO_GUIDE = new URL('../demo/guide.xml', import.meta.url).href;
const DEMO_BASE = new URL('../demo/', import.meta.url).href;

const DEMO_ONLY_MSG = 'Demo mode only plays the made-up demo channels.';

function isDemoPlaylistMeta(meta) {
  if (!meta || !meta.demo) return false;
  if (meta.id && meta.id !== 'demo') return false;
  const u = meta.url || '';
  // Must be our bundled demo playlist URL (or empty during internal reload of already-fetched demo text)
  if (u && !u.includes('/demo/playlist.m3u')) return false;
  return true;
}

/** Hard gate: demo mode may only ingest the bundled demo playlist. */
function assertPlaylistAllowed(meta) {
  if (!License.isDemoMode()) return;
  if (!isDemoPlaylistMeta(meta)) throw new Error(DEMO_ONLY_MSG);
}


const state = {
  screen: 'gate', // gate | home | guide | movies | shows | sports | favorites | all | group | settings | profiles | add | search | player
  groupKey: 'HOME',
  groupName: 'Home',
  unlocked: false,
  licenseAvailable: false,
  channels: [], // live
  groups: [],
  movies: [],
  shows: [],
  episodes: {},
  movieCats: [],
  seriesCats: [],
  epg: new Map(),
  focusedChannel: null,
  playQueue: [],
  playIndex: 0,
  playerError: null,
  status: '',
  searchQ: '',
  otpStep: 'email', // email | otp
  otpEmail: '',
  addMode: 'm3u', // m3u | xtream
  persist: Store.load(),
};

const $ = (sel, el = document) => el.querySelector(sel);
const appRoot = $('#app');

function toast(msg) {
  state.status = msg;
  renderStatus();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    state.status = '';
    renderStatus();
  }, 3500);
}

function resolveAsset(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, DEMO_BASE).href;
}

function letterMark(name) {
  const p = (name || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function now() {
  return Date.now();
}

/* ---------------- data load ---------------- */

async function loadPlaylistText(text, meta) {
  if (License.isDemoMode()) {
    // Always re-fetch the bundled demo — ignore caller text/URL/localStorage tricks
    meta = { id: 'demo', name: 'TYTV Demo', type: 'M3U', demo: true, url: DEMO_PLAYLIST };
    assertPlaylistAllowed(meta);
    const res = await fetch(DEMO_PLAYLIST, { cache: 'no-store' });
    if (!res.ok) throw new Error('Demo playlist missing');
    text = await res.text();
  } else {
    assertPlaylistAllowed(meta || {});
  }
  const id = meta.id || Store.uid('pl');
  const parsed = parseM3u(text, id);
  if (!parsed.channels.length) throw new Error('No channels found in that playlist.');
  if (parsed.channels.length > 100_000) throw new Error('Playlist is too large for the browser (100k+). Use the TV app.');

  const { live, vod } = split(parsed.channels, id);
  state.channels = live;
  state.groups = groupChannels(live);
  state.movies = vod.movies;
  state.shows = vod.shows;
  state.episodes = vod.episodes;
  state.movieCats = vod.movieCats;
  state.seriesCats = vod.seriesCats;

  const pl = {
    id,
    name: meta.name || 'My playlist',
    type: meta.type || 'M3U',
    url: meta.url || '',
    server: meta.server || '',
    username: meta.username || '',
    password: '', // never persist password
    epgUrl: meta.epgUrl || parsed.epgUrls[0] || '',
  };
  if (License.isDemoMode()) {
    // Demo must not restore or keep user playlists
    state.persist.playlists = [];
    Store.save(state.persist);
  } else {
    state.persist.playlists = [pl];
    Store.save(state.persist);
  }

  // EPG
  const epgCandidates = [];
  if (meta.epgUrl) epgCandidates.push(meta.epgUrl);
  for (const u of parsed.epgUrls) if (!epgCandidates.includes(u)) epgCandidates.push(u);
  // demo relative guide
  if (meta.demo) epgCandidates.unshift(DEMO_GUIDE);

  state.epg = new Map();
  for (const u of epgCandidates.slice(0, 3)) {
    try {
      const abs = /^https?:\/\//i.test(u) || u.startsWith('/') || u.startsWith('blob:') ? u : new URL(u, DEMO_BASE).href;
      // mixed content guide on https page — skip http
      if (location.protocol === 'https:' && abs.startsWith('http:')) continue;
      const res = await fetch(abs);
      if (!res.ok) continue;
      const xml = await res.text();
      const result = parseXmltv(xml, {
        windowStart: now() - 3 * 3600_000,
        windowEnd: now() + 18 * 3600_000,
        maxPrograms: 20_000,
      });
      state.epg = result.programs;
      toast(result.truncated ? 'Guide loaded (partial)' : 'Guide loaded');
      break;
    } catch (e) {
      console.warn('EPG failed', u, e);
    }
  }
}

async function loadDemo() {
  await loadPlaylistText('', { id: 'demo', name: 'TYTV Demo', type: 'M3U', demo: true, url: DEMO_PLAYLIST });
}

async function fetchRemotePlaylist(url) {
  if (License.isDemoMode()) throw new Error(DEMO_ONLY_MSG);
  if (location.protocol === 'https:' && url.startsWith('http:')) {
    throw new Error("Browsers block insecure (http) playlist links on this site. Use https, or the TV app.");
  }
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error("Couldn't download that playlist (network error or blocked). Check the URL, or use the TV app.");
  }
  if (!res.ok) throw new Error(`Couldn't download playlist (HTTP ${res.status}).`);
  const text = await res.text();
  if (!text || text.length < 8) throw new Error('Playlist file looks empty.');
  if (text.length > 40_000_000) throw new Error('Playlist is too large for the browser. Use the TV app.');
  return text;
}

/* ---------------- navigation / focus ---------------- */

const focusables = () =>
  [...appRoot.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled && el.offsetParent !== null && !el.closest('.hidden'),
  );

function moveFocus(dx, dy) {
  const list = focusables();
  const cur = document.activeElement;
  const i = list.indexOf(cur);
  if (i < 0) {
    list[0]?.focus();
    return;
  }
  // Prefer spatial when possible
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const ex = b.left + b.width / 2;
    const ey = b.top + b.height / 2;
    const vx = ex - cx;
    const vy = ey - cy;
    if (dx && Math.sign(vx) !== dx) continue;
    if (dy && Math.sign(vy) !== dy) continue;
    if (dx && Math.abs(vy) > Math.abs(vx) * 2.5 + 40) continue;
    if (dy && Math.abs(vx) > Math.abs(vy) * 2.5 + 40) continue;
    const dist = Math.hypot(vx, vy) + (dx ? Math.abs(vy) * 0.5 : Math.abs(vx) * 0.5);
    if (dist < bestScore) {
      bestScore = dist;
      best = el;
    }
  }
  if (best) best.focus();
  else if (dx > 0 || dy > 0) list[Math.min(list.length - 1, i + 1)]?.focus();
  else list[Math.max(0, i - 1)]?.focus();
}

function onKey(e) {
  if (state.screen === 'player') {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      closePlayer();
      return;
    }
    if (e.key === ' ' || e.key === 'k' || e.key === 'MediaPlayPause') {
      e.preventDefault();
      Player.togglePause();
      showChrome();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      Player.setCurrentTime(Math.max(0, Player.currentTime() - 10));
      showChrome();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      Player.setCurrentTime(Player.currentTime() + 10);
      showChrome();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ChannelUp' || e.key === 'ChannelDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' || e.key === 'ChannelUp' ? -1 : 1;
      const next = state.playIndex + dir;
      if (next >= 0 && next < state.playQueue.length) playAt(next);
      return;
    }
    showChrome();
    return;
  }

  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveFocus(0, 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveFocus(0, -1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    moveFocus(-1, 0);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    moveFocus(1, 0);
  } else if (e.key === 'Escape' && state.screen !== 'gate' && state.screen !== 'home') {
    e.preventDefault();
    navigate('home');
  }
}

let chromeTimer;
function showChrome() {
  const ov = $('.player-overlay');
  if (!ov) return;
  ov.classList.add('show-chrome');
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => ov.classList.remove('show-chrome'), 3500);
}

/* ---------------- player ---------------- */

async function playChannels(list, index) {
  state.playQueue = list;
  state.playIndex = index;
  state.screen = 'player';
  state.playerError = null;
  render();
  const ch = list[index];
  if (!ch) return;
  state.persist.lastChannelKey = ch.key;
  Store.save(state.persist);
  const video = $('#playerVideo');
  Player.attachVideo(video);
  showChrome();
  const r = await Player.play(ch.url, { userAgent: ch.userAgent });
  if (!r.ok) {
    state.playerError = r.error || "This stream can't play in a browser — use the TV app";
    renderPlayerError();
  }
}

async function playVod(item) {
  const url = item.url;
  if (!url) {
    // series — open first episode
    const eps = state.episodes[item.id] || [];
    if (!eps.length) {
      toast('No episodes yet');
      return;
    }
    await playChannels(
      eps.map((e) => ({
        key: item.key + '|' + e.id,
        name: `${item.name} S${e.season}E${e.episode}`,
        url: e.url,
        group: 'Series',
        logo: e.thumb || item.poster,
        userAgent: '',
      })),
      0,
    );
    return;
  }
  await playChannels(
    [
      {
        key: item.key,
        name: item.name,
        url,
        group: 'Movies',
        logo: item.poster,
        userAgent: '',
      },
    ],
    0,
  );
}

function playAt(i) {
  playChannels(state.playQueue, i);
}

function closePlayer() {
  Player.stop();
  state.screen = state.groupKey === 'HOME' ? 'home' : state.screen === 'player' ? 'home' : state.screen;
  if (state.groupKey === 'SPORTS') state.screen = 'sports';
  else if (state.groupKey === 'FAVORITES') state.screen = 'favorites';
  else if (state.groupKey === 'ALL') state.screen = 'all';
  else if (state.groupKey.startsWith('g:')) state.screen = 'group';
  else state.screen = 'home';
  render();
}

function renderPlayerError() {
  const box = $('#playerError');
  if (!box) return;
  if (state.playerError) {
    box.classList.remove('hidden');
    box.innerHTML = `<h2>Can't play here</h2><p>${escapeHtml(state.playerError)}</p>
      <button class="btn btn-primary" type="button" data-act="close-player">Back</button>
      <p class="hint" style="margin-top:14px">Mixed-content (http on https) and many providers block browser playback. The TV app can still play these.</p>`;
  } else box.classList.add('hidden');
}

/* ---------------- render ---------------- */

function navigate(screen, opts = {}) {
  if (License.isDemoMode() && (screen === 'add' || screen === 'add-playlist')) {
    toast(DEMO_ONLY_MSG);
    return;
  }
  state.screen = screen;
  if (opts.groupKey) state.groupKey = opts.groupKey;
  if (opts.groupName) state.groupName = opts.groupName;
  render();
}

function channelsForView() {
  const favs = new Set(state.persist.favorites || []);
  if (state.screen === 'favorites' || state.groupKey === 'FAVORITES') {
    return state.channels.filter((c) => favs.has(c.key));
  }
  if (state.screen === 'sports' || state.groupKey === 'SPORTS') {
    return state.channels.filter((c) => /sport/i.test(c.group) || /sport/i.test(c.name));
  }
  if (state.screen === 'all' || state.groupKey === 'ALL') return state.channels;
  if (state.screen === 'group') {
    return state.channels.filter((c) => c.groupKey === state.groupKey || c.group === state.groupName);
  }
  return state.channels;
}

function renderRail() {
  const profile = state.persist.profiles.find((p) => p.id === state.persist.activeProfileId) || state.persist.profiles[0];
  const favCount = (state.persist.favorites || []).length;
  const sportsCount = state.channels.filter((c) => /sport/i.test(c.group)).length;
  const items = [
    { id: 'profiles', label: profile?.name || 'You', ico: '👤', screen: 'profiles' },
    { id: 'home', label: 'Home', ico: '⌂', screen: 'home', sel: state.screen === 'home' },
    { id: 'search', label: 'Search', ico: '⌕', screen: 'search' },
    { id: 'guide', label: 'TV Guide', ico: '▦', screen: 'guide' },
    { id: 'settings', label: 'Settings', ico: '⚙', screen: 'settings' },
    { sec: 'Live TV' },
    { id: 'sports', label: 'Live Sports', ico: '⚡', screen: 'sports', count: sportsCount, cls: 'live' },
    { id: 'favorites', label: 'Favorites', ico: '★', screen: 'favorites', count: favCount, cls: 'gold' },
    { id: 'all', label: 'All channels', ico: '◎', screen: 'all', count: state.channels.length },
    { sec: 'On demand' },
    { id: 'movies', label: 'Movies', ico: '🎬', screen: 'movies', count: state.movies.length },
    { id: 'shows', label: 'TV Shows', ico: '📺', screen: 'shows', count: state.shows.length },
    { sec: 'Live groups' },
    ...state.groups.map((g) => ({
      id: 'g:' + g.key,
      label: g.name,
      ico: null,
      screen: 'group',
      groupKey: g.key,
      groupName: g.name,
      count: g.count,
      sel: state.screen === 'group' && state.groupKey === g.key,
    })),
  ];

  return `<nav class="rail" aria-label="TYTV menu">
    <div class="rail-logo"><span class="mark">TY</span> TYTV</div>
    ${items
      .map((it) => {
        if (it.sec) return `<div class="rail-section">${escapeHtml(it.sec)}</div>`;
        const sel = it.sel || state.screen === it.screen ? 'selected' : '';
        const cls = ['rail-item', sel, it.cls || ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-nav="${it.screen}" data-gk="${escapeHtml(it.groupKey || '')}" data-gn="${escapeHtml(it.groupName || '')}">
          ${it.ico ? `<span class="ico">${it.ico}</span>` : ''}
          <span class="lbl">${escapeHtml(it.label)}</span>
          ${it.count != null ? `<span class="cnt">${it.count}</span>` : ''}
        </button>`;
      })
      .join('')}
  </nav>`;
}

function cardChannel(c) {
  const prog = programAt(state.epg.get(c.epgKey) || state.epg.get((c.tvgId || '').toLowerCase()), now());
  const logo = resolveAsset(c.logo);
  return `<button type="button" class="card" data-play-key="${escapeHtml(c.key)}">
    <div class="art" style="${logo ? `background-image:url('${escapeHtml(logo)}')` : ''}">${logo ? '' : escapeHtml(letterMark(c.name))}</div>
    <div class="body"><div class="title">${escapeHtml(c.name)}</div>
    <div class="sub">${escapeHtml(prog?.title || c.group)}</div></div>
  </button>`;
}

function cardVod(v) {
  const poster = resolveAsset(v.poster);
  return `<button type="button" class="card poster" data-vod-key="${escapeHtml(v.key)}">
    <div class="art" style="${poster ? `background-image:url('${escapeHtml(poster)}')` : ''}">${poster ? '' : escapeHtml(letterMark(v.name))}</div>
    <div class="body"><div class="title">${escapeHtml(v.name)}</div>
    <div class="sub">${escapeHtml(v.year || (v.kind === 'SERIES' ? 'Series' : 'Movie'))}</div></div>
  </button>`;
}

function renderHome() {
  if (!state.channels.length && !state.movies.length) {
    if (License.isDemoMode()) {
      return `<div class="empty"><h2>Demo with made-up channels</h2>
        <p>This demo only includes the bundled sample playlist.</p></div>`;
    }
    return `<div class="empty"><h2>Add a playlist</h2>
      <p>Paste your M3U link or Xtream login — same as the TV app.</p>
      <button class="btn btn-primary" type="button" data-nav="add">Add playlist</button></div>`;
  }
  const favs = new Set(state.persist.favorites || []);
  const favCh = state.channels.filter((c) => favs.has(c.key)).slice(0, 12);
  const liveSports = state.channels.filter((c) => /sport/i.test(c.group)).slice(0, 10);
  const hero = state.movies.find((m) => m.poster) || state.movies[0] || state.shows[0];
  const layout = state.persist.homeLayout || 'featured';

  if (layout === 'classic') {
    return `<div class="topbar"><h1>Home</h1><div class="meta">${state.channels.length} channels</div></div>
      <div class="row-title">Channels</div>
      <div class="h-scroll">${state.channels.slice(0, 24).map(cardChannel).join('')}</div>
      <div class="row-title">Movies</div>
      <div class="h-scroll">${state.movies.slice(0, 16).map(cardVod).join('')}</div>`;
  }

  let heroHtml = '';
  if (hero) {
    const art = resolveAsset(hero.poster);
    heroHtml = `<div class="hero">
      <div class="hero-art" style="${art ? `background-image:url('${escapeHtml(art)}')` : ''}"></div>
      <div class="hero-copy">
        <div class="eyebrow">${hero.kind === 'SERIES' ? 'Series' : 'Featured'}</div>
        <h2>${escapeHtml(hero.name)}</h2>
        <p>${escapeHtml(hero.year ? `Made-up demo title · ${hero.year}` : 'From your playlist')}</p>
        <div class="hero-actions">
          <button class="btn btn-primary" type="button" data-vod-key="${escapeHtml(hero.key)}">Play</button>
          <button class="btn btn-ghost" type="button" data-nav="movies">Browse movies</button>
        </div>
      </div>
    </div>`;
  }

  return `${heroHtml}
    ${favCh.length ? `<div class="row-title">Favorites</div><div class="h-scroll">${favCh.map(cardChannel).join('')}</div>` : ''}
    ${liveSports.length ? `<div class="row-title">Live Sports</div><div class="h-scroll">${liveSports.map(cardChannel).join('')}</div>` : ''}
    ${state.movies.length ? `<div class="row-title">Movies</div><div class="h-scroll">${state.movies.slice(0, 16).map(cardVod).join('')}</div>` : ''}
    ${state.shows.length ? `<div class="row-title">TV Shows</div><div class="h-scroll">${state.shows.slice(0, 16).map(cardVod).join('')}</div>` : ''}
    <div class="row-title">Channels</div>
    <div class="h-scroll">${state.channels.slice(0, 24).map(cardChannel).join('')}</div>`;
}

function renderChannelList(title) {
  const list = channelsForView();
  const favs = new Set(state.persist.favorites || []);
  if (!list.length) {
    return `<div class="topbar"><h1>${escapeHtml(title)}</h1></div><div class="empty"><h2>Nothing here yet</h2><p>Add a playlist or favorite some channels.</p></div>`;
  }
  return `<div class="topbar"><h1>${escapeHtml(title)}</h1><div class="meta">${list.length}</div></div>
    <div class="channel-list">
    ${list
      .map((c) => {
        const prog = programAt(state.epg.get(c.epgKey) || state.epg.get((c.tvgId || '').toLowerCase()), now());
        const pct = prog ? Math.round(progress(prog, now()) * 100) : 0;
        const logo = resolveAsset(c.logo);
        const star = favs.has(c.key) ? '★' : '☆';
        return `<button type="button" class="ch-row" data-play-key="${escapeHtml(c.key)}" data-focus-ch="${escapeHtml(c.key)}">
          <div class="ch-logo">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : escapeHtml(letterMark(c.name))}</div>
          <div>
            <div class="ch-name">${escapeHtml(c.name)}</div>
            <div class="ch-prog">${escapeHtml(prog ? prog.title : c.group)}</div>
            ${prog ? `<div class="prog-bar"><i style="width:${pct}%"></i></div>` : ''}
          </div>
          <span class="btn btn-ghost" role="button" tabindex="0" data-fav="${escapeHtml(c.key)}" title="Favorite" aria-label="Favorite">${star}</span>
        </button>`;
      })
      .join('')}
    </div>`;
}

function renderGuide() {
  const list = state.channels.slice(0, 40);
  const start = Math.floor(now() / 1800_000) * 1800_000; // 30-min grid
  const cols = 6;
  const slots = Array.from({ length: cols }, (_, i) => start + i * 1800_000);
  document.documentElement.style.setProperty('--guide-cols', String(cols));

  let html = `<div class="topbar"><h1>TV Guide</h1><div class="meta">${formatClock(start)}</div></div>
    <div class="guide-wrap"><div class="guide" role="table" aria-label="TV guide">
    <div class="gl">Channel</div>
    ${slots.map((t) => `<div class="gh">${escapeHtml(formatClock(t))}</div>`).join('')}`;

  for (const c of list) {
    const logo = resolveAsset(c.logo);
    html += `<div class="gl">${logo ? `<img src="${escapeHtml(logo)}" width="28" height="28" alt="">` : ''} ${escapeHtml(c.name)}</div>`;
    const progs = state.epg.get(c.epgKey) || state.epg.get((c.tvgId || '').toLowerCase()) || [];
    for (const t of slots) {
      const p = programAt(progs, t + 60_000);
      const isNow = t <= now() && now() < t + 1800_000;
      html += `<button type="button" class="cell ${isNow ? 'now' : ''}" data-play-key="${escapeHtml(c.key)}">
        <div class="t">${escapeHtml(p?.title || '—')}</div>
        <div class="d">${p ? escapeHtml(formatClock(p.start) + ' – ' + formatClock(p.stop)) : ''}</div>
      </button>`;
    }
  }
  html += `</div></div>`;
  return html;
}

function renderVodGrid(kind) {
  const items = kind === 'MOVIE' ? state.movies : state.shows;
  const title = kind === 'MOVIE' ? 'Movies' : 'TV Shows';
  if (!items.length) {
    return `<div class="topbar"><h1>${title}</h1></div><div class="empty"><h2>No ${title.toLowerCase()} in this playlist</h2>
      <p>On-demand titles appear when the playlist uses movie/series paths or video files — same rules as the TV app.</p></div>`;
  }
  return `<div class="topbar"><h1>${title}</h1><div class="meta">${items.length}</div></div>
    <div class="h-scroll" style="flex-wrap:wrap; overflow:visible">${items.map(cardVod).join('')}</div>`;
}

function renderSearch() {
  const q = state.searchQ.trim().toLowerCase();
  const ch = q ? state.channels.filter((c) => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : [];
  const mv = q ? state.movies.filter((m) => m.name.toLowerCase().includes(q)) : [];
  const sh = q ? state.shows.filter((m) => m.name.toLowerCase().includes(q)) : [];
  return `<div class="topbar"><h1>Search</h1></div>
    <div class="field"><label for="searchQ">Find channels, movies, shows</label>
      <input id="searchQ" type="search" value="${escapeHtml(state.searchQ)}" placeholder="Type a name" autocomplete="off">
    </div>
    ${q ? `<div class="row-title">Channels (${ch.length})</div><div class="h-scroll">${ch.slice(0, 30).map(cardChannel).join('')}</div>
      <div class="row-title">Movies (${mv.length})</div><div class="h-scroll">${mv.slice(0, 20).map(cardVod).join('')}</div>
      <div class="row-title">Shows (${sh.length})</div><div class="h-scroll">${sh.slice(0, 20).map(cardVod).join('')}</div>` : `<p class="hint">Start typing — arrow keys move between results.</p>`}`;
}

function renderSettings() {
  const demo = License.isDemoMode();
  return `<div class="topbar"><h1>Settings</h1></div>
    <div class="panel-card" style="margin:0;max-width:560px">
      ${demo ? `<div class="coming" style="margin-bottom:14px"><strong>Demo with made-up channels.</strong> Playlist add is turned off in demo.</div>` : ''}
      <div class="field"><label>Home layout</label>
        <select id="homeLayout">
          <option value="featured" ${state.persist.homeLayout !== 'classic' ? 'selected' : ''}>Featured</option>
          <option value="classic" ${state.persist.homeLayout === 'classic' ? 'selected' : ''}>Classic</option>
        </select>
      </div>
      <div class="field"><label>Account</label>
        <div class="hint">${demo ? 'Demo with made-up channels — not a paid unlock.' : License.storedEmail() || 'Not signed in'}</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${demo ? '' : `<button class="btn btn-primary" type="button" data-nav="add">Add / replace playlist</button>
        <button class="btn btn-ghost" type="button" data-act="reload-demo">Load demo playlist</button>`}
        <button class="btn btn-danger" type="button" data-act="signout">${demo ? 'Leave demo' : 'Sign out'}</button>
      </div>
      <p class="hint" style="margin-top:16px">Streams that use plain http, or that block browser requests, show a friendly message and work in the TV app instead. TYTV never proxies your streams.</p>
    </div>`;
}

function renderProfiles() {
  return `<div class="topbar"><h1>Profiles</h1></div>
    <div class="h-scroll">
      ${state.persist.profiles
        .map(
          (p) => `<button type="button" class="card" data-act="pick-profile" data-id="${escapeHtml(p.id)}">
        <div class="art" style="background:linear-gradient(135deg,#3B82FF,#5AD4FF)">${escapeHtml(letterMark(p.name))}</div>
        <div class="body"><div class="title">${escapeHtml(p.name)}</div>
        <div class="sub">${p.id === state.persist.activeProfileId ? 'Active' : 'Switch'}</div></div>
      </button>`,
        )
        .join('')}
      <button type="button" class="card" data-act="add-profile">
        <div class="art">+</div>
        <div class="body"><div class="title">Add profile</div><div class="sub">Local only</div></div>
      </button>
    </div>`;
}

function renderAdd() {
  if (License.isDemoMode()) {
    return `<div class="topbar"><h1>Add playlist</h1></div>
      <div class="panel-card" style="margin:0;max-width:520px">
        <div class="coming"><strong>Demo with made-up channels.</strong> ${escapeHtml(DEMO_ONLY_MSG)}</div>
        <button class="btn btn-primary" type="button" data-nav="home">Back to Home</button>
      </div>`;
  }
  return `<div class="topbar"><h1>Add playlist</h1></div>
    <div class="panel-card" style="margin:0;max-width:520px">
      <div class="tabs">
        <button type="button" class="tab ${state.addMode === 'm3u' ? 'active' : ''}" data-act="add-mode" data-mode="m3u">M3U URL</button>
        <button type="button" class="tab ${state.addMode === 'xtream' ? 'active' : ''}" data-act="add-mode" data-mode="xtream">Xtream</button>
      </div>
      ${
        state.addMode === 'm3u'
          ? `<div class="field"><label for="m3uUrl">Playlist URL</label>
              <input id="m3uUrl" type="url" placeholder="https://…/playlist.m3u" autocomplete="off">
            </div>
            <div class="field"><label for="m3uEpg">Guide URL (optional)</label>
              <input id="m3uEpg" type="url" placeholder="https://…/guide.xml" autocomplete="off">
            </div>
            <div class="field"><label for="m3uFile">Or choose a file</label>
              <input id="m3uFile" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,text/plain">
            </div>`
          : `<div class="field"><label for="xtServer">Server</label><input id="xtServer" placeholder="http://host:port" autocomplete="off"></div>
             <div class="field"><label for="xtUser">Username</label><input id="xtUser" autocomplete="username"></div>
             <div class="field"><label for="xtPass">Password</label><input id="xtPass" type="password" autocomplete="current-password"></div>
             <p class="hint">Uses the same get.php m3u_plus fallback as the TV app. Password is not saved in this browser.</p>`
      }
      <p class="err hidden" id="addErr"></p>
      <button class="btn btn-primary" type="button" data-act="submit-playlist">Load playlist</button>
      <button class="btn btn-ghost" type="button" data-act="reload-demo" style="margin-left:8px">Use demo</button>
    </div>`;
}

function renderGate() {
  const coming = !state.licenseAvailable && !License.isDemoMode();
  return `<div class="gate" role="dialog" aria-labelledby="gateTitle">
    <div class="rail-logo" style="padding-left:0"><span class="mark">TY</span> TYTV Watch</div>
    <h1 id="gateTitle">Unlock to watch</h1>
    <p class="lede">Same email + one-time code as the TV app. Two devices per email.</p>
    ${
      coming
        ? `<div class="coming"><strong>Coming soon.</strong> Payments and email codes aren't live yet.
           Download the TV app on <a href="/">tytvapp.com</a>.</div>`
        : ''
    }
    ${
      state.otpStep === 'email'
        ? `<div class="field"><label for="email">Email</label>
             <input id="email" type="email" autocomplete="email" placeholder="you@example.com"></div>
           <p class="err hidden" id="gateErr"></p>
           <p class="okmsg hidden" id="gateOk"></p>
           <button class="btn btn-primary" type="button" data-act="request-otp" ${coming ? 'disabled' : ''}>Email me a code</button>`
        : `<div class="field"><label>Code sent to ${escapeHtml(state.otpEmail)}</label>
             <input id="otp" class="otp" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code"></div>
           <p class="err hidden" id="gateErr"></p>
           <button class="btn btn-primary" type="button" data-act="verify-otp">Unlock</button>
           <button class="btn btn-ghost" type="button" data-act="otp-back" style="margin-left:8px">Back</button>`
    }
    <p class="hint" style="margin-top:18px"><a href="/">← Back to tytvapp.com</a></p>
  </div>`;
}

function renderPlayerShell() {
  const ch = state.playQueue[state.playIndex];
  const prog = ch
    ? programAt(state.epg.get(ch.epgKey) || state.epg.get((ch.tvgId || '').toLowerCase()), now())
    : null;
  return `<div class="player-overlay show-chrome" id="playerOverlay">
    <video id="playerVideo" playsinline controls></video>
    <div class="player-error hidden" id="playerError"></div>
    <div class="player-chrome">
      <div class="player-title">${escapeHtml(ch?.name || '')}</div>
      <div class="player-sub">${escapeHtml(prog?.title || ch?.group || '')}</div>
      <div class="player-actions">
        <button class="btn btn-primary" type="button" data-act="close-player">Back</button>
        <button class="btn btn-ghost" type="button" data-act="prev-ch">Prev</button>
        <button class="btn btn-ghost" type="button" data-act="next-ch">Next</button>
        <button class="btn btn-ghost" type="button" data-fav="${escapeHtml(ch?.key || '')}">Favorite</button>
      </div>
    </div>
  </div>`;
}

function renderStatus() {
  let el = $('#statusToast');
  if (!state.status) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'statusToast';
    el.className = 'status-toast';
    appRoot.appendChild(el);
  }
  el.textContent = state.status;
}

function renderDetail() {
  const c = state.focusedChannel;
  if (!c) return `<div class="detail" id="detail"></div>`;
  const prog = programAt(state.epg.get(c.epgKey) || state.epg.get((c.tvgId || '').toLowerCase()), now());
  const logo = resolveAsset(c.logo);
  return `<aside class="detail show" id="detail">
    <div class="ch-logo" style="width:72px;height:72px;margin-bottom:12px">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : escapeHtml(letterMark(c.name))}</div>
    <h2 style="margin:0 0 6px;font-size:1.1rem">${escapeHtml(c.name)}</h2>
    <div class="hint">${escapeHtml(c.group)}</div>
    ${prog ? `<p style="margin-top:14px"><strong>${escapeHtml(prog.title)}</strong><br><span class="hint">${escapeHtml(prog.desc || '')}</span></p>` : ''}
    <button class="btn btn-primary" style="margin-top:14px" type="button" data-play-key="${escapeHtml(c.key)}">Play</button>
  </aside>`;
}

function mainBody() {
  switch (state.screen) {
    case 'home':
      return renderHome();
    case 'guide':
      return renderGuide();
    case 'movies':
      return renderVodGrid('MOVIE');
    case 'shows':
      return renderVodGrid('SERIES');
    case 'sports':
      return renderChannelList('Live Sports');
    case 'favorites':
      return renderChannelList('Favorites');
    case 'all':
      return renderChannelList('All channels');
    case 'group':
      return renderChannelList(state.groupName || 'Group');
    case 'settings':
      return renderSettings();
    case 'profiles':
      return renderProfiles();
    case 'add':
      return renderAdd();
    case 'search':
      return renderSearch();
    default:
      return renderHome();
  }
}

function render() {
  if (!License.canUsePlayerShell()) {
    state.unlocked = false;
    appRoot.innerHTML = renderGate();
    bind();
    return;
  }
  if (state.screen === 'player') {
    appRoot.innerHTML = `<div class="app">${renderRail()}<div class="main">${renderPlayerShell()}</div></div>`;
    Player.attachVideo($('#playerVideo'));
    renderPlayerError();
    bind();
    return;
  }
  const showDetail = ['sports', 'favorites', 'all', 'group'].includes(state.screen);
  appRoot.innerHTML = `<div class="app">${renderRail()}
    <div class="layout-with-detail" style="flex:1;min-width:0">
      <div class="main">${License.isDemoMode() ? `<div class="coming" style="margin:12px 22px 0;max-width:none"><strong>Demo with made-up channels.</strong> Sample content only — not a paid unlock.</div>` : ''}<div class="main-scroll">${mainBody()}</div></div>
      ${showDetail ? renderDetail() : ''}
    </div>
  </div>`;
  renderStatus();
  bind();
  // focus first content control
  const first = appRoot.querySelector('.main-scroll button, .main-scroll input, .rail-item.selected') || appRoot.querySelector('.rail-item');
  first?.focus();
}

function bind() {
  appRoot.onclick = async (e) => {
    const t = e.target.closest('[data-nav],[data-act],[data-play-key],[data-vod-key],[data-fav]');
    if (!t) return;

    if (t.dataset.fav) {
      e.stopPropagation();
      const key = t.dataset.fav;
      const set = new Set(state.persist.favorites || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      state.persist.favorites = [...set];
      Store.save(state.persist);
      render();
      return;
    }

    if (t.dataset.playKey) {
      const list = channelsForView().length ? channelsForView() : state.channels;
      let idx = list.findIndex((c) => c.key === t.dataset.playKey);
      let queue = list;
      if (idx < 0) {
        idx = state.channels.findIndex((c) => c.key === t.dataset.playKey);
        queue = state.channels;
      }
      if (idx >= 0) playChannels(queue, idx);
      return;
    }

    if (t.dataset.vodKey) {
      const item = [...state.movies, ...state.shows].find((v) => v.key === t.dataset.vodKey);
      if (item) playVod(item);
      return;
    }

    if (t.dataset.nav) {
      const screen = t.dataset.nav;
      navigate(screen, { groupKey: t.dataset.gk || screen.toUpperCase(), groupName: t.dataset.gn || '' });
      return;
    }

    const act = t.dataset.act;
    if (act === 'request-otp') {
      const email = $('#email')?.value || '';
      const err = $('#gateErr');
      const ok = $('#gateOk');
      err?.classList.add('hidden');
      ok?.classList.add('hidden');
      const r = await License.requestOtp(email);
      if (!r.ok) {
        if (err) {
          err.textContent = r.message || r.error;
          err.classList.remove('hidden');
        }
        return;
      }
      state.otpStep = 'otp';
      state.otpEmail = License.normalizeEmail(email) || email;
      render();
      return;
    }
    if (act === 'verify-otp') {
      const otp = $('#otp')?.value || '';
      const err = $('#gateErr');
      const r = await License.verifyOtp(state.otpEmail, otp);
      if (!r.ok) {
        if (err) {
          err.textContent = r.message || r.error;
          err.classList.remove('hidden');
        }
        return;
      }
      state.unlocked = true;
      state.screen = 'home';
      if (!state.channels.length) {
        if (License.isDemoMode()) await loadDemo().catch((e) => toast(String(e.message || e)));
        else navigate('add');
      }
      render();
      return;
    }
    if (act === 'otp-back') {
      state.otpStep = 'email';
      render();
      return;
    }
    if (act === 'close-player') {
      closePlayer();
      return;
    }
    if (act === 'prev-ch') {
      if (state.playIndex > 0) playAt(state.playIndex - 1);
      return;
    }
    if (act === 'next-ch') {
      if (state.playIndex < state.playQueue.length - 1) playAt(state.playIndex + 1);
      return;
    }
    if (act === 'signout') {
      License.clearLocal();
      License.clearDemoMode();
      state.unlocked = false;
      state.otpStep = 'email';
      state.channels = [];
      state.movies = [];
      state.shows = [];
      state.groups = [];
      state.epg = new Map();
      if (License.isDemoMode() || new URLSearchParams(location.search).get('demo') === '1') {
        // Drop ?demo=1 so the public gate shows
        location.href = new URL('.', location.href).pathname.replace(/\/?$/, '/') || '/watch/';
        return;
      }
      render();
      return;
    }
    if (act === 'reload-demo') {
      // In demo mode the bundled demo is already loaded; ignore add-from-settings paths.
      if (License.isDemoMode()) {
        try {
          await loadDemo();
          state.screen = 'home';
          toast('Demo with made-up channels');
          render();
        } catch (err) {
          toast(String(err.message || err));
        }
        return;
      }
      try {
        await loadDemo();
        state.screen = 'home';
        toast('Demo playlist loaded');
        render();
      } catch (err) {
        toast(String(err.message || err));
      }
      return;
    }
    if (act === 'add-mode') {
      state.addMode = t.dataset.mode;
      render();
      return;
    }
    if (act === 'submit-playlist') {
      if (License.isDemoMode()) {
        toast(DEMO_ONLY_MSG);
        return;
      }
      const err = $('#addErr');
      err?.classList.add('hidden');
      try {
        if (state.addMode === 'm3u') {
          const file = $('#m3uFile')?.files?.[0];
          let text;
          let url = $('#m3uUrl')?.value?.trim() || '';
          const epgUrl = $('#m3uEpg')?.value?.trim() || '';
          if (file) text = await file.text();
          else if (url) text = await fetchRemotePlaylist(url);
          else throw new Error('Paste a playlist URL or choose a file.');
          await loadPlaylistText(text, { name: 'My playlist', type: 'M3U', url, epgUrl });
        } else {
          const server = $('#xtServer')?.value?.trim() || '';
          const username = $('#xtUser')?.value?.trim() || '';
          const password = $('#xtPass')?.value || '';
          if (!server || !username || !password) throw new Error('Enter server, username, and password.');
          const url = xtreamM3uUrl(server, username, password);
          const text = await fetchRemotePlaylist(url);
          await loadPlaylistText(text, {
            name: 'Xtream',
            type: 'XTREAM',
            url,
            server,
            username,
            epgUrl: xtreamEpgUrl(server, username, password),
          });
        }
        state.screen = 'home';
        toast('Playlist loaded');
        render();
      } catch (ex) {
        if (err) {
          err.textContent = ex.message || String(ex);
          err.classList.remove('hidden');
        }
      }
      return;
    }
    if (act === 'pick-profile') {
      state.persist.activeProfileId = t.dataset.id;
      Store.save(state.persist);
      state.screen = 'home';
      render();
      return;
    }
    if (act === 'add-profile') {
      const name = prompt('Profile name', 'Kids') || '';
      if (!name.trim()) return;
      const p = { id: Store.uid('pf'), name: name.trim(), color: 0x3b82ff, kids: /kid/i.test(name) };
      state.persist.profiles.push(p);
      Store.save(state.persist);
      render();
      return;
    }
  };

  appRoot.oninput = (e) => {
    if (e.target.id === 'searchQ') {
      state.searchQ = e.target.value;
      // re-render body only would be nicer; full render ok for demo size
      const pos = e.target.selectionStart;
      render();
      const again = $('#searchQ');
      if (again) {
        again.focus();
        again.setSelectionRange(pos, pos);
      }
    }
  };

  appRoot.onchange = (e) => {
    if (e.target.id === 'homeLayout') {
      state.persist.homeLayout = e.target.value;
      Store.save(state.persist);
      toast('Home layout saved');
    }
  };

  appRoot.onmouseover = (e) => {
    const row = e.target.closest('[data-focus-ch]');
    if (!row) return;
    const ch = state.channels.find((c) => c.key === row.dataset.focusCh);
    if (ch && ch !== state.focusedChannel) {
      state.focusedChannel = ch;
      const d = $('#detail');
      if (d) {
        const tmp = document.createElement('div');
        tmp.innerHTML = renderDetail();
        d.replaceWith(tmp.firstElementChild);
      }
    }
  };

  const ov = $('#playerOverlay');
  if (ov) {
    ov.onmousemove = showChrome;
    ov.onclick = showChrome;
  }
}

/* ---------------- boot ---------------- */

async function boot() {
  document.addEventListener('keydown', onKey);
  License.deviceId();

  const health = await License.checkHealth();
  state.licenseAvailable = !!health.available;

  if (License.isDemoMode()) {
    // Restricted shell: bundled demo only. Ignore localStorage playlists / unlock flags.
    state.unlocked = true;
    state.persist.playlists = [];
    Store.save(state.persist);
    try {
      await loadDemo();
      state.screen = 'home';
    } catch (e) {
      console.error(e);
      state.screen = 'home';
      toast(String(e.message || e));
    }
    render();
    return;
  }

  if (License.isUnlocked()) {
    state.unlocked = true;
    state.screen = 'add';
    render();
    License.heartbeat();
    setInterval(() => License.heartbeat(), 5 * 60_000);
    return;
  }

  state.unlocked = false;
  render();
}

boot();
