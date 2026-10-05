# OreWire

Mining and resource market intelligence: stock data, AI-decoded regulatory filings
and news release summaries for companies listed on the **TSX, TSX-V, CSE and ASX**.

Live and free to read at [orewire.com](https://www.orewire.com).

---

## What it does

- **Company profiles** — exchange, ticker, sector, commodity exposure, headquarters,
  market capitalisation, transfer agent, share price, management and board, plus the
  latest filings and news for that issuer, at `/company/<company-name-slug>`.
- **Decoded filings** — every filing is analysed and rendered with a plain-English
  summary, a verdict (`Noteworthy` / `Watch` / `Routine`), why that verdict was
  reached, key facts, resource estimates, grade commentary, context and what to
  watch. The original PDF is always linked.
- **News releases** — aggregated releases with summaries, linked to the publisher
  and to the company they concern.
- **Market and commodity pages** — commodity, currency and index detail pages, plus
  hub pages browsing companies by commodity, exchange and continent.
- **Watchlists and email** — saved companies with filing alerts, and a scheduled
  daily briefing (email and PDF).
- **Jobs board** — mining and resource roles, with posting and applications.
- **Discussions** — per-entity comment threads.
- **Admin** — dashboard, ingestion pipeline controls, proxy/relay management and
  a scheduled X (Twitter) posting pipeline.

Data is collected by scraping SEDAR+ and the exchange listing venues (TMX, CSE,
ASX) and by consuming news feeds; filings are analysed with the Anthropic API.

---

## Repository layout

```
Server/          Node + Express API, ingestion pipeline, scrapers, schedulers
  routes/          HTTP routes (api/, admin/, seo.js)
  lib/seo/         server-rendered crawler pages, schema.org, sitemaps, IndexNow
  lib/scraper/     SEDAR+, ASX and related scrapers
  lib/social/      X (Twitter) posting pipeline, templates and accounts
  lib/schedulers/  cron entries (quotes, briefings, IndexNow, social)
  jobs/ scripts/   CLI entry points (see Scripts below)
  db/              connection, migrations
  relay/           proxy + browser relay            → relay/README.md
  x-browser/       browser-driven X client          → x-browser/README.md
  lib/webbridge/   browser extension bridge         → lib/webbridge/README.md
frontend/        Vite + React + TypeScript SPA      → frontend/README.md
docs/            SEO/AEO/GEO playbook and runbooks
data/            runtime data (downloads and session cookies, per docker-compose.yml)
docker-compose.yml
```

**Stack.** Backend: Node 22, Express, PostgreSQL (`pg`), node-cron, Anthropic SDK,
S3-compatible object storage, Playwright/Patchright/Camoufox for browser scraping.
Frontend: Vite, React 18, TypeScript, Tailwind, shadcn/Radix, TanStack Query,
React Router, Vitest. Postgres and object storage are **external** — they are not
part of the compose stack.

---

## Getting started

Requires **Node 22** and npm, plus a reachable PostgreSQL instance.

### Local development

```bash
# Backend
cd Server
npm install
cp .env.example .env        # then set DATABASE_URL and the rest
npm run dev                 # node --watch index.js, listens on PORT (8070 in the Docker stack)

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev                 # vite dev server
```

### Docker

```bash
cp Server/.env.example Server/.env
docker compose up --build
```

| service | URL |
|---|---|
| frontend | http://localhost:8080 |
| backend | http://localhost:8070 |
| admin dashboard | http://localhost:8070/admin/dashboard.html |

The compose file reads its own root `.env` for `SERVER_PORT`, `FRONTEND_PORT`,
`VITE_*`, `BACKEND_UPSTREAM` and `SITE_ORIGIN` — see `.env.docker.example`. The
backend's own configuration lives in `Server/.env` (see `Server/.env.example`,
which documents every variable inline; most optional ones are commented out).

The essentials you cannot skip:

| variable | where | purpose |
|---|---|---|
| `DATABASE_URL` | `Server/.env` | Postgres connection; migrations run from `db/migrate.js` |
| `APP_URL` | `Server/.env` | absolute links in emails and generated URLs |
| `ADMIN_PASSWORD` | `Server/.env` | protects the `/admin/*` pages |
| `BACKEND_UPSTREAM` | root `.env` | what the frontend nginx proxies to. **Required** — empty and nginx will not start |
| `SITE_ORIGIN` | root `.env` / `Server/.env` | canonical origin for sitemaps, JSON-LD and canonicals |
| `INDEXNOW_KEY` | `Server/.env` | optional; enables IndexNow freshness pings |

---

## Scripts

### Server (`cd Server`)

| script | what it does |
|---|---|
| `npm start` / `npm run dev` | run the API (watch mode for `dev`) |
| `npm run seo:check` | **static pre-deploy audit** — no database, no network |
| `npm run seo:audit` | live crawl audit of the deployed site (samples 25 URLs per sitemap) |
| `npm run seo:indexnow` | submit URLs to IndexNow |
| `npm run scrape:profiles` | refresh company profiles from exchange listing data |
| `npm run briefing:send` / `briefing:pdf` | daily briefing email / PDF |
| `npm run watchlist-filings:send` | watchlist filing alerts |
| `npm run audit:filing-storage` / `import:orphan-pdfs` | filing storage maintenance |
| `npm run relay:*` | diagnostics for the proxy/browser relay |
| `npm run x-browser` | browser-driven X client |

### Frontend (`cd frontend`)

`npm run dev` · `npm run build` · `npm run preview` · `npm run lint` · `npm test`

---

## How crawlers are served

The site is a single-page app, so JavaScript-less crawlers would otherwise see an
empty shell. Instead, **nginx maps crawler user agents to a backend renderer** that
serves real HTML for company, filing, news, market-news, hub and index pages; human
visitors get the SPA unchanged. Rendered responses are `private, no-store` and carry
`Vary: User-Agent` so a CDN can never serve the wrong variant to the wrong client.

That layer also provides `robots.txt`, `llms.txt`, a paginated sitemap index
(`/sitemap.xml` → `/sitemaps/*.xml`), IndexNow pings, JSON-LD (`@graph`, `FAQPage`,
`Dataset`, `BreadcrumbList`, `NewsArticle`) and per-route canonicals.

Before any deploy:

```bash
cd Server && npm run seo:check
```

After a deploy:

```bash
cd Server && npm run seo:audit
```

The reasoning behind every decision — including the defects found while verifying
and why each fix is shaped the way it is — is in
[`docs/seo-aeo-geo-playbook.md`](docs/seo-aeo-geo-playbook.md).

---

## Documentation

| document | contents |
|---|---|
| [`docs/deploy-seo.md`](docs/deploy-seo.md) | ordered deploy checklist for the SEO layer, with verification commands |
| [`docs/seo-aeo-geo-playbook.md`](docs/seo-aeo-geo-playbook.md) | the SEO/AEO/GEO playbook and the reasoning behind each decision |
| [`docs/seo-outreach-kit.md`](docs/seo-outreach-kit.md) | off-page work: citable facts, who to approach, outreach template |
| [`docs/insider-pages-plan.md`](docs/insider-pages-plan.md) | implementation spec for `/insider/:slug` (not built) |
| [`docs/structured-data-schema-digest.md`](docs/structured-data-schema-digest.md) | schema.org research notes |
| [`geo-ai-crawlers-digest.md`](geo-ai-crawlers-digest.md) | research notes on AI crawlers |
| [`sitemaps-at-scale-digest.md`](sitemaps-at-scale-digest.md) | research notes on sitemaps at scale |

Subsystems have their own READMEs: [frontend](frontend/README.md),
[relay](Server/relay/README.md), [x-browser](Server/x-browser/README.md),
[webbridge](Server/lib/webbridge/README.md),
[webbridge extension](Server/public/webbridge-extension/README.md).

---

## Known gaps

Recorded here so they are not lost, not because they block anything:

- **Brand assets.** `frontend/public/og-image.png` (1200×630) and `logo.png` are
  missing, so `og:image` still points at a third-party preview URL and
  `Organization.logo` is omitted from structured data. `seo:check` warns about both.
- **`/insider/:slug` is linked but not built.** Every manager, director and insider
  name on a company page links there, and no such route exists, so those links land
  on the 404 page. Either build it ([spec](docs/insider-pages-plan.md)) or unwrap
  the links.
- **Eight private routes set no page title** — `/watchlist`, `/jobs/dashboard`,
  `/profile`, `/change-password`, `/login`, `/register`, `/auth/google/callback`,
  `/auth/agree`. They are disallowed in `robots.txt`, so this affects the browser tab
  and history rather than search.
- **One hub is empty.** `?commodity=Cobalt` returns zero companies, and the sitemap
  still advertises it. The page is correctly `noindex`; removing the sitemap entry
  needs an async refactor of `staticEntries()`.
- **Data quality.** A small number of filings are attributed to the wrong company at
  ingest (`status = 'company_mismatch'`; the SEO layer excludes them), and office
  document mapping is deliberately not published. Both are recorded in the playbook.
