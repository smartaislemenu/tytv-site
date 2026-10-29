**Branch note:** Premium redesign lives on the `redesign` branch until Tyler approves going live.

# TYTV download site

Static one-page site for downloading the TYTV Android TV app (APK).

**Live:** https://tytvapp.com  
Also: https://smartaislemenu.github.io/tytv-site/ (redirects once custom domain is active)

Domain registered at **Porkbun** (`tytvapp.com`). DNS A/CNAME records point at GitHub Pages.

## What’s here

| File | Purpose |
|------|---------|
| `index.html` | Full landing page (hero, download, install steps, features, FAQ, gallery) |
| `styles.css` | Dark navy / neon blue theme matching the app |
| `app.js` | Tab switching + optional live version/SHA from GitHub API |
| `assets/` | Real TYTV logo + WebP screenshots (Guide, Settings·Look, Home) |
| `favicon.svg` | Official TYTV icon (from app art) |
| `CNAME` | Placeholder custom domain for GitHub Pages (`tytvapp.com` until changed) |
| `_redirects` | Cloudflare Pages shortcuts: `/apk` and `/download` → latest APK |
| `_headers` | Basic security headers for Cloudflare Pages |
| `robots.txt` | Allow indexing |

## Download URL

Primary APK (always latest release asset):

```
https://github.com/smartaislemenu/tytv-app/releases/latest/download/TYTV.apk
```

Verified against release `v1.2.17` (`TYTV.apk`). SHA-256 is shown on the page and refreshed from the latest release notes when the GitHub API is reachable.

## Preview locally

```bash
cd /workspace/tytv-site
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

## Deploy (after Tyler says go)

### Option A — Cloudflare Pages (recommended with a Cloudflare domain)

1. Create a new Pages project from this folder (direct upload) or from a private GitHub repo.
2. Build settings: **framework = None**, output directory = `/` (or the folder that contains `index.html`).
3. Add custom domain in **Custom domains**.
4. Optional: keep `_redirects` so Firestick Downloader can use `https://YOURDOMAIN/apk`.

### Option B — GitHub Pages

1. Push this folder to a repo (or `/docs` on an existing repo).
2. Settings → Pages → Deploy from branch.
3. Edit `CNAME` to the exact domain you bought (one line, no `https://`).
4. At your registrar, add DNS:

```
# Apex (example for Cloudflare DNS)
CNAME  @   <username>.github.io   # or use A records GitHub publishes
# or preferred:
CNAME  www  <username>.github.io
```

GitHub’s current Pages IP/A records are listed in [GitHub Pages docs](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site). With Cloudflare Proxy (orange cloud), a CNAME to `*.pages.dev` or `*.github.io` is usually enough.

### DNS CNAME placeholder

```
# Point the domain at your host (pick one after deploy):
# Cloudflare Pages:
CNAME  @    your-project.pages.dev
CNAME  www  your-project.pages.dev

# GitHub Pages:
CNAME  www  <user-or-org>.github.io
```

Apex `@` CNAME support depends on the DNS host (Cloudflare supports CNAME flattening).

## Domain shortlist (read-only check, Oct 28, 2026 ET)

See the agent report for live RDAP + registrar prices. Placeholder in `CNAME` is `tytvapp.com` — change it if another name is purchased.

## Content rules

- Never say “IPTV”; say “playlist player” / “M3U playlist”.
- Never include playlist URLs or credentials.
- Never claim channels/movies are included with the app.

## License / affiliation

Not affiliated with Google, Amazon, Walmart, or any streaming service.
