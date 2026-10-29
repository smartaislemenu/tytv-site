import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseHTML } from 'linkedom';
import { parseM3u, findTitleComma, parseAttributes, xtreamM3uUrl } from '../js/m3u.js';
import { classify, split, parseEpisode, Type } from '../js/vod.js';
import { parseTime, parseXmltv, programAt } from '../js/epg.js';

const dir = dirname(fileURLToPath(import.meta.url));
const demo = join(dir, '../demo/playlist.m3u');

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else { failed++; console.error('FAIL', name, detail || ''); }
}

ok('title comma skips quoted', findTitleComma('tvg-name="A, B",Foo', 0) > 0);
const attrs = parseAttributes('tvg-id="x" group-title="Live Sports" tvg-logo="a.png"', 0);
ok('parse attrs', attrs['tvg-id'] === 'x' && attrs['group-title'] === 'Live Sports');

const text = readFileSync(demo, 'utf8');
const { channels, epgUrls } = parseM3u(text, 'demo');
ok('demo channel count', channels.length === 18, channels.length);
ok('epg url relative', epgUrls.includes('guide.xml'), epgUrls);
ok('metro sports', channels.some((c) => c.name === 'Metro Sports 1' && c.group === 'Live Sports'));
ok('no scheme junk skipped', !channels.some((c) => !c.url.includes('://')));
ok('empty playlist', parseM3u('#EXTM3U\n', 'x').channels.length === 0);
ok('junk lines ignored', parseM3u('#EXTM3U\n#EXTINF:-1,Bad\nnot-a-url\n', 'x').channels.length === 0);

const big = ['#EXTM3U'];
for (let i = 0; i < 2000; i++) {
  big.push(`#EXTINF:-1 tvg-id="c${i}" group-title="G${i % 10}",Ch ${i}`);
  big.push(`https://example.com/live/${i}.m3u8`);
}
const t0 = Date.now();
const bigParsed = parseM3u(big.join('\n'), 'big');
ok('2k parse fast', bigParsed.channels.length === 2000 && Date.now() - t0 < 500, Date.now() - t0);

ok('live m3u8', classify('https://x/live/1.m3u8', 'Coastal News') === Type.LIVE);
ok('movie path', classify('https://x/movie/1/file.mp4', 'Glass Harbor') === Type.MOVIE);
ok('series path', classify('https://x/series/1/1/1.ts', 'Show S01E02') === Type.SERIES);
ok('episode parse', parseEpisode('Harbor City S01 E02 Extra')?.season === 1);

const splitDemo = split(channels, 'demo');
ok('demo all live (bipbop)', splitDemo.live.length === 18 && splitDemo.vod.movies.length === 0);

const vodish = parseM3u(`#EXTM3U
#EXTINF:-1 group-title="Movies & Shows",Glass Harbor (2024)
https://cdn.example/movie/1/play.mp4
#EXTINF:-1 group-title="Shows",Nova Comedy S01E01
https://cdn.example/series/2/1/1.mkv
#EXTINF:-1 group-title="News",Coastal News 24
https://cdn.example/live/news.ts
`, 't').channels;
const sp = split(vodish, 't');
ok('split live 1', sp.live.length === 1);
ok('split movies 1', sp.vod.movies.length === 1 && sp.vod.movies[0].name === 'Glass Harbor');
ok('split shows 1', sp.vod.shows.length === 1);

const xu = xtreamM3uUrl('panel.example:8080', 'u', 'p');
ok('xtream m3u url', xu.includes('get.php') && xu.includes('m3u_plus'));

const ms = parseTime('20261029010000 +0000');
ok('xmltv time', ms === Date.UTC(2026, 9, 29, 1, 0, 0), ms);

function isMixed(pageHttps, url) { return pageHttps && url.startsWith('http:'); }
ok('detect mixed', isMixed(true, 'http://x/a.ts'));
ok('https ok', !isMixed(true, 'https://x/a.m3u8'));

const { window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;
const guide = readFileSync(join(dir, '../demo/guide.xml'), 'utf8');
const epg = parseXmltv(guide, { windowStart: 0, windowEnd: Date.now() + 86400e3 * 2, maxPrograms: 5000 });
ok('epg has metro', epg.programs.has('metro.sports1'), [...epg.programs.keys()].slice(0, 5));
const on = programAt(epg.programs.get('metro.sports1'), Date.now());
ok('epg now program', !!on && !!on.title, on);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('All parser tests passed (' + (21 + 2) + ' checks)');
