# Deploying the OreWire SEO layer

One ordered checklist. Every step is either a command or a fact to check.

**Why order matters:** the frontend nginx config proxies crawler requests to
`BACKEND_UPSTREAM`. If the frontend ships before the backend has the renderer,
every crawler request 404s from the backend instead of receiving HTML — worse than
the current state, because it is a crawlable error rather than an empty shell.

---

## 0. Before touching production

```bash
cd Server
npm run seo:check
```

This is static: no database, no network. It must exit clean. It verifies the SEO
modules load and export what the routes expect, that every path nginx proxies has a
matching backend route, that `frontend/nginx.conf` is structurally sound with both
envsubst variables templated and set, that `routes/seo.js` is mounted in
`index.js`, and that the SPA's `useSeo` calls are present.

**If this fails, stop.** Do not deploy past a red `seo:check`.

---

## 1. Environment variables

Set these in Dokploy on the correct service. Nothing else in this runbook works
without step 1.

### Backend service

| variable | value | notes |
|---|---|---|
| `SITE_ORIGIN` | `https://www.orewire.com` | absolute canonicals, sitemaps, JSON-LD |
| `INDEXNOW_KEY` | optional | 8–128 chars of `[a-zA-Z0-9-]`. Omit to disable pings |
| `SEO_INDEXNOW_CRON` | optional | default `30 5 * * *` |
| `SEO_INDEXNOW_WINDOW_HOURS` | optional | default `24` |
| `SEO_QUOTE_MAX_AGE_MINUTES` | optional | default `1440`; a cached quote older than this is omitted rather than published |

### Frontend service

| variable | value | notes |
|---|---|---|
| `BACKEND_UPSTREAM` | `http://backend.orewire.com` | **the** variable. Empty means nginx fails to start |
| `EXTRA_CRAWLER_UA_PATTERN` | optional | extra nginx map mask. Defaults to a pattern that never matches |

**Do not create env vars named after nginx variables** (`uri`, `host`, `scheme`,
`remote_addr`) on the frontend service. The official image runs `envsubst` over the
template, and a collision would silently rewrite nginx's own variables. Existing
Docker variables (`HOSTNAME`, `PATH`, `HOME`) do not collide.

---

## 2. Deploy the backend

Deploy the backend service and confirm it is healthy **before** the frontend.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://backend.orewire.com/seo/status
```

- **`200`** — the renderer is live. Continue.
- **`404` (`Cannot GET /seo/status`)** — the backend is running older code. **Stop.**
  Deploying the frontend now would 404 every crawler path.

Also confirm the renderer actually renders:

```bash
curl -sA 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://backend.orewire.com/seo/company/carson-river-ventures-corp | head -40
```

Expect an HTML document with a `<title>` naming the company and a
`application/ld+json` block.

---

## 3. Deploy the frontend

Then verify the proxy from the public host, as a crawler:

```bash
UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

# The page the whole objective is about.
curl -sA "$UA" https://www.orewire.com/company/carson-river-ventures-corp \
  | grep -c 'Carson River Ventures'

# The machine-readable files.
curl -sA "$UA" https://www.orewire.com/robots.txt
curl -sA "$UA" https://www.orewire.com/sitemap.xml | head -20
curl -sA "$UA" https://www.orewire.com/llms.txt | head -20
```

Expected:

| check | expected |
|---|---|
| `/company/carson-river-ventures-corp` as Googlebot | HTML containing the company name, not the SPA shell |
| `/robots.txt` | the templated file allowing AI crawlers, `Disallow: /seo/`, a `Sitemap:` line |
| `/sitemap.xml` | a `<sitemapindex>` listing `companies-N`, `news-N`, `filings-N`, `static` |
| `/llms.txt` | plain text listing recent companies and key pages |
| the same company URL with a **browser** UA | the normal SPA (unchanged) |

If `/robots.txt` still returns the old 14-line file, the frontend did not pick up
the template — check that the config reached
`/etc/nginx/templates/default.conf.template` in the image.

---

## 4. Cloudflare

Two things to confirm, both outside the code:

1. **`backend.orewire.com/robots.txt` is answered by Cloudflare's Content Signals
   Policy**, not by the backend. That is expected and harmless — the canonical
   `robots.txt` is served from `www`. Do not "fix" it.
2. **No bot challenge on AI crawlers.** Cloudflare Bot Fight Mode and some managed
   rules challenge `GPTBot`, `ClaudeBot`, `PerplexityBot` and friends. A challenge
   page is served with HTTP 200, so it looks like success in logs while the crawler
   receives nothing. Check a few:

```bash
for bot in GPTBot ClaudeBot PerplexityBot Google-Extended; do
  printf '%s: ' "$bot"
  curl -s -o /dev/null -w '%{http_code}\n' \
    -A "Mozilla/5.0 (compatible; $bot/1.0; +https://example.com/bot)" \
    https://www.orewire.com/company/carson-river-ventures-corp
done
```

Any non-`200` is a block. If a challenge page comes back with `200`, inspect the
body rather than the status.

---

## 5. Submit and verify

1. **Google Search Console** — submit `https://www.orewire.com/sitemap.xml`.
2. **Bing Webmaster Tools** — same. Bing also feeds ChatGPT's browsing.
3. Wait for indexing, then run the live audit:

```bash
cd Server
npm run seo:audit
```

It samples 25 URLs per sitemap by default. `--all` would request roughly 228,000
URLs; do not run that against production without meaning to.

---

## 6. What to expect, and when

| timeframe | what to look for |
|---|---|
| hours | crawler UAs get rendered HTML; sitemap fetched without errors |
| days 1–7 | `site:orewire.com` starts returning company pages; Search Console reports "Discovered"/"Crawled" |
| weeks 1–4 | company names begin ranking, typically page 3+ for contested tickers, better for the long tail |
| 1–3 months | with off-page citations, "Carson River Ventures Corp." becomes plausible |

**On-page work makes ranking possible, not inevitable.** The technical layer is
necessary and not sufficient. Ranking for a company name against webfiles.thecse.com,
Bloomberg, Barron's and stockanalysis.com depends on authority those sites already
have and OreWire does not. That is what `docs/seo-outreach-kit.md` is for —
**Wikidata first**, because it is the entity source LLMs and search engines read.

---

## 7. Rollback

The SEO layer is additive. To disable it without reverting code:

- **Crawler HTML only:** clear `EXTRA_CRAWLER_UA_PATTERN` and redeploy the frontend
  with a config whose crawler map is defaulted off. The SPA is unaffected — human
  traffic never used the renderer.
- **IndexNow pings:** unset `INDEXNOW_KEY`. The scheduler logs a skip and does
  nothing else.
- **A bad sitemap:** the renderer serves it, so redeploying the backend's previous
  image restores it. Nothing else depends on it.

The renderer never writes to the database, so no rollback can leave data in a state
that needs repair.
