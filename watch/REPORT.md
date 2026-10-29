# TYTV Watch — go-live report

**Branch:** `web-player` → merged to `main`  
**Rollback SHA:** `3991597`  
**Demo:** `?demo=1` is restricted to the bundled made-up playlist (not a free unlock). Public gate has no QA/`?demo=1` hint.

## Lockdowns
- Demo only via URL `?demo=1` (not sessionStorage)
- Demo always re-fetches `/watch/demo/playlist.m3u`; ignores caller text/URLs
- Add playlist / fetchRemote / navigate('add') / submit blocked in demo
- Stored playlists cleared/ignored in demo
- Without Worker (`LICENSE_API_BASE` empty), localStorage `unlocked` is ignored

## Tests
- Parser 23/23
- Playwright lockdown + gate + desktop/phone shots
- Lighthouse on demo
- Banned-word scan (no IPTV / real channel names) on production watch files
