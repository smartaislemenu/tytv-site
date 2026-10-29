/**
 * Port of TYTV Android VodClassifier.kt — split live / movies / series from M3U entries.
 */
const FILE_EXT = new Set(['mp4','mkv','avi','mov','m4v','wmv','flv','webm','mpg','mpeg','divx','xvid','3gp','ogv']);
const SXE = /^(.*?)[\s._\-:|]*\bS(\d{1,2})\s*[._\-]?\s*E(\d{1,4})\b(.*)$/i;
const NXN = /^(.*?)[\s._\-:|]+(\d{1,2})x(\d{1,3})\b(.*)$/i;
const YEAR_RX = /[\(\[]((?:19|20)\d{2})[\)\]]|\s-\s((?:19|20)\d{2})$/;

export const Type = { LIVE: 'LIVE', MOVIE: 'MOVIE', SERIES: 'SERIES' };

function cleanShow(s) {
  return s.trim().replace(/[-:|._]+$/, '').trim();
}

export function parseEpisode(name) {
  const n = name.trim();
  const m = n.match(SXE) || n.match(NXN);
  if (!m) return null;
  const show = cleanShow(m[1]);
  if (!show) return null;
  return {
    show,
    season: parseInt(m[2], 10),
    episode: parseInt(m[3], 10),
    rest: m[4].trim().replace(/^[-:|.]+/, '').trim(),
  };
}

export function yearOf(name) {
  const m = name.match(YEAR_RX);
  return m ? m[1] || m[2] || '' : '';
}

export function cleanTitle(name) {
  return name.replace(/\s*[\(\[](?:19|20)\d{2}[\)\]]\s*$/, '').trim();
}

export function classify(url, name = '') {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  if (path.includes('/series/')) return Type.SERIES;
  if (path.includes('/movie/') || path.includes('/movies/')) {
    return parseEpisode(name) ? Type.SERIES : Type.MOVIE;
  }
  const last = path.slice(path.lastIndexOf('/') + 1);
  const ext = last.includes('.') ? last.slice(last.lastIndexOf('.') + 1) : '';
  if (FILE_EXT.has(ext)) return parseEpisode(name) ? Type.SERIES : Type.MOVIE;
  return Type.LIVE;
}

function idOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) + s.length.toString(36);
}

/**
 * @param {object[]} entries Channel-like
 * @param {string} playlistId
 */
export function split(entries, playlistId) {
  const live = [];
  const movies = [];
  const movieCats = new Map();
  const seriesCats = new Map();
  const shows = new Map();
  const eps = new Map();

  for (const c of entries) {
    const t = classify(c.url, c.name);
    if (t === Type.LIVE) {
      live.push(c);
      continue;
    }
    if (t === Type.MOVIE) {
      if (!movieCats.has(c.group)) {
        movieCats.set(c.group, { playlistId, kind: 'MOVIE', id: c.group, name: c.group });
      }
      const cat = movieCats.get(c.group);
      movies.push({
        playlistId,
        kind: 'MOVIE',
        id: idOf(c.url),
        name: cleanTitle(c.name),
        categoryId: cat.id,
        poster: c.logo || '',
        year: yearOf(c.name),
        url: c.url,
        key: `${playlistId}|M|${idOf(c.url)}`,
      });
      continue;
    }
    // SERIES
    if (!seriesCats.has(c.group)) {
      seriesCats.set(c.group, { playlistId, kind: 'SERIES', id: c.group, name: c.group });
    }
    const cat = seriesCats.get(c.group);
    const e = parseEpisode(c.name);
    const showName = e ? e.show : c.name.trim();
    const sid = idOf(c.group + '|' + showName);
    if (!shows.has(sid)) {
      shows.set(sid, {
        playlistId,
        kind: 'SERIES',
        id: sid,
        name: cleanTitle(showName),
        categoryId: cat.id,
        poster: c.logo || '',
        year: yearOf(showName),
        url: '',
        key: `${playlistId}|S|${sid}`,
      });
    }
    if (!eps.has(sid)) eps.set(sid, []);
    const list = eps.get(sid);
    const season = e ? e.season : 1;
    const epNo = e ? e.episode : list.filter((x) => x.season === season).length + 1;
    list.push({
      id: idOf(c.url),
      season,
      episode: epNo,
      title: (e && e.rest) || `Episode ${epNo}`,
      url: c.url,
      thumb: c.logo || '',
    });
  }
  for (const list of eps.values()) {
    list.sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return {
    live,
    vod: {
      movieCats: [...movieCats.values()],
      seriesCats: [...seriesCats.values()],
      movies,
      shows: [...shows.values()],
      episodes: Object.fromEntries(eps),
    },
  };
}

/** Groups live channels by group-title, playlist order. */
export function groupChannels(live) {
  const map = new Map();
  for (const c of live) {
    if (!map.has(c.group)) map.set(c.group, []);
    map.get(c.group).push(c);
  }
  return [...map.entries()].map(([name, channels]) => ({
    key: channels[0].groupKey,
    name,
    count: channels.length,
    channels,
  }));
}
