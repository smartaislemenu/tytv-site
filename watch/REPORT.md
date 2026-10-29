# TYTV Watch — go-live report

**Branch:** `main`  
**SHA:** `0857e57`  
**Rollback:** `4b5f30f` (soft) / `3991597` (earlier)  
**Demo:** `?demo=1` is restricted to the bundled made-up playlist (not a free unlock). Public gate has no QA/`?demo=1` hint.

## 2026-10-28 fix pass
- **Blank player cause:** `.player-overlay` was `position:absolute` inside `.main` with no in-flow children → 0-height navy pane (not GPU). Fixed with full-viewport `.player-screen` chrome (channel, now/next, progress, controls) + explicit fallback card.
- **Demo stream:** self-hosted abstract clip under `watch/demo/stream/` (HLS + MP4, ~1 MB).
- **Phone gate:** side margins + rounded corners.
- **Featured hero:** default `homeLayout=featured`; demo VOD movies provide hero art.

## Lockdowns
- Demo only via URL `?demo=1` (not sessionStorage)
- Demo always re-fetches `/watch/demo/playlist.m3u`; ignores caller text/URLs
- Add playlist / fetchRemote / navigate('add') / submit blocked in demo
- Stored playlists cleared/ignored in demo
- Without Worker (`LICENSE_API_BASE` empty), localStorage `unlocked` is ignored

## Tests
- Parser 23/23
- Playwright lockdown + gate + desktop/phone shots (player not blank)
- Lighthouse on demo: perf 89 / a11y 97 / best-practices 100
- Banned-word scan clean

## Live verify note
Push of `0857e57` to `main` succeeded. Shortly after, the GitHub account returned suspended (Pages 404 for tytvapp.com). Live shots in `watch/shots/live/` were retaken from the same commit served locally.
