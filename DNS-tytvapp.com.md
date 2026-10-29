# DNS for tytvapp.com → GitHub Pages

**Registrar:** Porkbun (not Cloudflare)  
**Repo:** https://github.com/smartaislemenu/tytv-site  
**Live:** https://tytvapp.com

## Records set at Porkbun

| Type | Name | Content |
|------|------|---------|
| A | `@` (apex) | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `smartaislemenu.github.io` |

Parking / default Porkbun records were removed.

## GitHub Pages

- Custom domain: `tytvapp.com` (repo `CNAME` file + Pages settings)
- Enforce HTTPS after GitHub finishes issuing the cert
