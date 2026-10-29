# update.json (prepared, not deployed)

- `update.json` advertises the **currently served** APK **1.2.17** (versionCode **20**).
- Do **not** upload this to Cloudflare Pages until Tyler OKs turning the feed on.
- `update.json.1220.example` shows what the feed would look like after 1.2.20 is published (sha/size filled then).
- App 1.2.20 reads `https://tytvapp.com/update.json` then falls back to `https://tytv-site.pages.dev/update.json`.
- Until this file is deployed, 1.2.20 update checks fail quietly (automatic) or show a soft error (manual Settings check).
