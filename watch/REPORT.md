# TYTV Watch — branch report (not on main)

**Branch:** `web-player`  
**Built:** 2026-10-28 ~10:35 PM America/New_York  
**Live push:** not done (awaiting parent / Tyler OK)

## What shipped on this branch
- `/watch/` SPA matching TV app rail + screens (Home Featured/Classic, Guide, Sports, Favorites, All, Movies, Shows, Search, Settings, Profiles, Add playlist, Player)
- Parsers ported from Android: `M3uParser`, `VodClassifier`, XMLTV times + programme map, Xtream `get.php` m3u_plus URL builder
- Unlock gate: email + 6-digit OTP against Worker `/v1/otp/*` (same as `License.kt`); `device_id` stored as `web-…`; `device_type: web` sent when API is configured
- Playback: hls.js + native HLS; mixed-content / CORS / media errors → “This stream can't play in a browser — use the TV app”
- **No stream proxy**
- Demo playlist only under `watch/demo/` (made-up channels; Apple bipbop HLS)
- Marketing nav adds **Watch** → `watch/`

## Gate before Worker exists
`LICENSE_API_BASE` in `watch/js/license.js` is **empty**.
- Real visitors: **Coming soon** unlock screen (player locked). Email button disabled.
- QA: `/watch/?demo=1` loads demo UI (session-only; not a paid unlock). Clear sessionStorage to return to gate.
- When Worker + Stripe go live: set `LICENSE_API_BASE` to the Worker origin and enable OTP.

## Tests run
| Check | Result |
|--------|--------|
| Parser unit tests (`node watch/tests/parsers.test.mjs`) | 23/23 pass |
| Empty / junk / 2k-entry playlist | OK |
| Bad remote playlist URL | Friendly network error |
| Mixed content (https page + http stream) | Detected in helper; message path wired |
| Keyboard arrows + Enter + Escape in player | OK (Playwright) |
| Desktop + phone layouts | Screenshots below |
| Lighthouse (local `?demo=1`) | Perf 0.93 · A11y 1.00 · Best-practices 0.96 |
| Long playback heap (~30s) | ~10 MB usedJSHeapSize, flat (Chrome) |

## Screenshot paths
All under `watch/shots/`:
- `desktop-home.png`, `desktop-guide.png`, `desktop-sports.png`, `desktop-player.png`, `desktop-player-long.png`
- `desktop-gate-coming-soon.png`
- `phone-home.png`, `phone-guide.png`, `phone-gate-coming-soon.png`
- `lighthouse.json`

## Risks
1. **Mixed content / CORS** — many provider streams are `http://` or omit CORS; browser will show the friendly message; TV app still works. No proxy unless Tyler asks.
2. **Worker not deployed** — web stays locked (by design) until API base is set.
3. **2-device limit** — web counts as a device once Worker binds `device_id`; may need admin reset / raising limit when users use TV + phone + web.
4. **Xtream VOD JSON API** not ported — only M3U / get.php live list for v1.
5. **Demo logos** are letter-mark PNGs (intentional); real playlists use provider logos (subject to CORS on `<img>` — decorative fail is OK).

## Not matched vs TV app
- ExoPlayer buffer policy, live reconnect, timeshift, catchup player
- Channel preview in detail panel while browsing
- Multi-view, screensaver, boot-to-last-channel
- Full Xtream `player_api` VOD categories / series details
- Adult PIN lock depth, kids allow-list filtering, scores/weather widgets
- Offline soft-license banner (30-day)

## Suggested go-live steps (parent)
1. Review screenshots + this report with Tyler.
2. Merge/push `web-player` → `main` when OK (or copy `/watch` only).
3. After Worker deploy: set `LICENSE_API_BASE`, optionally add `device_type`/`label` column write in Worker (devices already have `label`).
4. Decide whether `?demo=1` stays for marketing or is removed before announce.
