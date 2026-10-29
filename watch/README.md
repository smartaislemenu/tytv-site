# TYTV Watch (web player)

Browser version of the TYTV Android TV app UI and playlist loading logic.

**Path:** `/watch/` on tytvapp.com  
**Branch:** `web-player` (do not merge until parent / Tyler OK)

## Features matched from the TV app
- Neon Blue theme (Orbit palette)
- Left rail: Home, Search, TV Guide, Settings, Live Sports, Favorites, All channels, Movies, TV Shows, live groups
- Featured / Classic home layouts
- M3U parser (same attribute rules as `M3uParser.kt`)
- VOD split (same `/movie/` `/series/` / file-ext rules as `VodClassifier.kt`)
- XMLTV guide parse + now-playing bars
- Xtream via `get.php?type=m3u_plus` fallback (same as TV app)
- Email + 6-digit OTP unlock (Worker `/v1/otp/*`); `device_id` prefixed `web-`
- hls.js + native HLS; mixed-content / CORS → friendly “use the TV app” message
- Arrow-key / Enter navigation (remote-like)

## Gate before Worker is live
`LICENSE_API_BASE` in `js/license.js` is empty until Cloudflare Worker is deployed.
Users see a **Coming soon** unlock screen (player locked).
QA: open `/watch/?demo=1` to load the made-up demo playlist (not a real unlock).

## Demo content
`demo/` — made-up channels (Metro Sports 1, Coastal News 24, …). Streams are Apple’s public bipbop HLS sample. No real provider URLs.

## Not matched in browser
- ExoPlayer buffer / reconnect / timeshift / catchup playback quirks
- Channel preview PiP in the detail panel while browsing
- Multi-view (4-up)
- Screensaver, boot-to-last-channel, system PIP
- Full Xtream VOD JSON API (movies/series via player_api) — M3U/get.php path only for v1
- Adult lock PIN, kids profile filtering depth, sports score widgets
- Offline soft-license banner after 30 days
- No stream proxy (by design — ask before adding)

## Tests
```bash
node watch/tests/parsers.test.mjs
```
