# OreWire SEO, AEO and GEO playbook

Status: in progress. This document records the diagnosis, the research behind the
changes, what has been implemented, and what still has to happen outside the
codebase.

The problem being solved, in the client's words: nobody searches for "OreWire".
People search for **"Carson River Ventures Corp."** and OreWire should appear in
the results. Today it does not.

---

## 0. Deployment status: none of this is live

Verified directly against the running site, not inferred. **The production
deployment predates all of this work — both services.**

| Check | Result | What it means |
|---|---|---|
| `https://www.orewire.com/robots.txt` | the original 14-line file (Googlebot, Bingbot, Twitterbot, facebookexternalhit, `*`) | the frontend is running the pre-change image; the AI crawler block and the `Sitemap:` directive are absent |
| `https://www.orewire.com/sitemap.xml` | the SPA's `index.html` | nginx has no `location = /sitemap.xml`, so there is **no sitemap at all** |
| `https://www.orewire.com/llms.txt` | the SPA's `index.html` | `/llms.txt` is not proxied |
| `https://backend.orewire.com/seo/status` | `Cannot GET /seo/status` (Express 404) | the backend is running without `routes/seo.js` |

So: no crawler-rendered company pages, no sitemap, no hubs, no structured data,
no IndexNow. Every claim in the sections below describes code that exists in the
repository and **has never executed in production**.

**Nothing in this document changes the outcome for "Carson River Ventures
Corp." until `BACKEND_UPSTREAM` is set and both services are redeployed.** That is
the whole of the remaining gap on the technical side.

### A cloudflare behaviour that invalidates one design assumption

`https://backend.orewire.com/robots.txt` is answered by **Cloudflare**, not by the
backend. It returns Cloudflare's managed Content Signals Policy robots.txt rather
than anything from this codebase.

Consequences worth knowing before trusting the design:

- The `notCanonicalRobotsTxt()` route added in section 3.10 **can never be
  reached on the backend host**, because Cloudflare intercepts `/robots.txt`
  there. It is not harmful, but it does not do the job it was written for, and
  the backend host's crawl policy is actually governed by Cloudflare's content
  signals, not by us.
- The canonical `www` host is unaffected: its robots.txt is served from the
  frontend container, which is why the original file is what we see today.

This is also a reminder that **robots.txt is not fully under the application's
control** in this deployment. Anything that depends on it — allowing AI crawlers,
pointing at the sitemap — should be verified against the live host after
deploying, not assumed from the code.

---

## 0.1 A production data bug that this work would have amplified

Found while checking what the live API returns for the exact company in the brief.
It is not an SEO bug, and it is more serious than one.

**Evidence.** `GET https://backend.orewire.com/api/filings/20594` returns:

```json
{
  "id": 20594,
  "company_id": 1415,
  "company_name": "Carson River Ventures Corp.",
  "pdf_filename": "simplysolvent07312026-nr.pdf",
  "status": "company_mismatch",
  "analysis": {
    "summary": "Simply Solventless Concentrates Ltd. (TSXV: HASH) will miss the
                deadline for its 2025 annual financial statements ...",
    "raw_response": { "data_extracted": {
      "issuer_names_from_document": ["Simply Solventless Concentrates Ltd."] } }
  }
}
```

The ingest attributed a **Simply Solventless Concentrates** news release to Carson
River Ventures: wrong `company_id`, wrong `company_name`, the PDF stored under a
`Carson River Ventures Corp_/` prefix. The analysis then correctly identified the
real issuer in the document and set `status = 'company_mismatch'`.

**So the system already knows.** The mismatch is detected and recorded, and then
the public filings endpoints return the row anyway. `GET /api/companies/CSE-CRIV`
lists eight such filings under Carson River's profile.

**Why this is worse than a ranking problem.** Rendered on Carson River's page, it
states that Carson River is under a management cease trade order for delayed
financials. That is another company's regulatory distress attached to a named
public issuer — materially misleading financial information about a real company,
with the credibility and legal exposure that implies. It is also the opposite of
the E-E-A-T signal this whole effort depends on. And crawled HTML makes it worse
than a transient API response: search engines and language models cache and cite
it.

**Mitigation applied in this layer.** `PUBLISHABLE_FILING_STATUS` in
`lib/seo/data.js` excludes `company_mismatch` from the company filing list, the
filings index, the sitemap and the filing detail page. A misattributed filing is
now invisible rather than published wrongly.

That is a mitigation **in one consumer**, not the fix. The real fix is upstream:
attribute the filing to the issuer the document names, or leave it unattributed.
Until then the row stays in the database and every other consumer — the SPA
filings list, the watchlist alerts, the daily briefing email — still sees it.

**To size the problem:**

```sql
SELECT status, COUNT(*) FROM filings GROUP BY status ORDER BY 2 DESC;
SELECT id, company_name, pdf_filename FROM filings
 WHERE status = 'company_mismatch' ORDER BY id DESC LIMIT 50;
```

If the count is large, this deserves attention well ahead of any SEO work.

---

## 0.2 The real target, and who currently ranks for it

Worth recording, because two assumptions in the original brief turned out to be
wrong and one design decision was vindicated.

**The company is `CSE:CRIV`, not TSXV.** Carson River Ventures Corp. trades on the
Canadian Securities Exchange under **CRIV** (`isin CA14601V2049`,
`cusip 14601V204`). OreWire holds it as company id 1415.

**This vindicates the name-based company URL.** Section 3.1 made
`/company/<company-name-slug>` canonical, with `EXCHANGE-TICKER` resolving and
redirecting. Had the URL stayed ticker-based, ranking for this query would have
required guessing the right exchange *and* ticker. `/company/carson-river-ventures-corp`
is correct without knowing either.

**Who currently ranks for "Carson River Ventures Corp.":**
| result | type |
|---|---|
| `webfiles.thecse.com` | the regulator's own PDF store |
| `bloomberg.com/profile/company/CRIV:CN` | financial data aggregator |
| `barrons.com/market-data/stocks/criv` | financial data aggregator |
| `stockanalysis.com/quote/cse/CRIV/company/` | financial data aggregator |
| `financialreports.eu` | low-authority filing aggregator |
| `newsfile.futunn.com` | SEDAR+ notice relay |

Two things follow. First, the incumbents are aggregators and the regulator, not
the company itself — and `financialreports.eu` shows that a thin filing
aggregator can rank, so this is not an unassailable set. Second, **none of them
summarise the filings.** "Carson River Ventures Corp. filings", or the company
name plus a drill or financing term, is where OreWire has content nobody else
does, and it is the ground the page titles already target.

---

## 1. Diagnosis: why OreWire was invisible

The site could not rank for a company name because, as far as a crawler was
concerned, the company pages did not exist.

| # | Finding | Evidence |
|---|---|---|
| 1 | **The site is a pure client-rendered SPA.** Every URL served the same `index.html` with one generic `<title>` and an empty `<div id="root">`. | `frontend/index.html`, `frontend/nginx.conf` `try_files ... /index.html` |
| 2 | **No per-page metadata existed anywhere in the frontend.** No title management, no canonical, no structured data. | grep for `document.title`, `og:title`, `application/ld+json`, `react-helmet` across `frontend/src` returned zero matches |
| 3 | **No `sitemap.xml` existed at all.** Nothing listed the company, filing or news URLs. | only `frontend/public/robots.txt` was present |
| 4 | **Company URLs did not contain the company name.** The canonical form was `/company/TSXV-CRV`. | `companySlug()` in `frontend/src/features/companies/api.ts` |
| 5 | **Company profile content was unreachable without JavaScript.** The name, ticker, description, filings and news only appeared after React fetched `/api/companies/...`. | `frontend/src/features/companies/pages/CompanyDetail.tsx` |
| 6 | **`robots.txt` was minimal** and declared no sitemap. | `frontend/public/robots.txt` (old content) |
| 7 | **`<link rel="canonical" href="/">` was hardcoded and relative** in the shell, so every route claimed to be the home page. | `frontend/index.html` line 9 (old content) |
| 8 | **News detail URLs were URL-encoded external links**, e.g. `/news/https%3A%2F%2F...`. Not usable as a citation target. | `buildDetailSlug()` in `frontend/src/features/news/components/NewsArticleCard.tsx` |

Items 1 and 5 are the fatal ones. For a query like "Carson River Ventures Corp.",
Google had to choose between a page whose server response contains no company
name at all, and pages on the exchange, SEDAR and the company itself that contain
it in plain HTML. OreWire loses that comparison before content quality is even
considered.

---

## 2. What the research says

### 2.1 JavaScript rendering

Google documents dynamic rendering as a **workaround**, not a recommended
architecture: [Dynamic rendering as a workaround](https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering).
Google can render JavaScript, but rendering is deferred, retried and budgeted, so
JS-only content is indexed later and less reliably than HTML that is present in
the first response. The durable answer is server rendering or prerendering.
Dynamic rendering is the correct *bridge* when the app cannot be server rendered
quickly, which is the situation here.

### 2.2 Sitemaps

A sitemap is the only realistic way to get thousands of profiles discovered
without waiting for internal links to be crawled. Constraints: 50,000 URLs and
50 MB uncompressed per file, with a `<sitemapindex>` above that
([sitemaps.org protocol](https://www.sitemaps.org/protocol.html)).

### 2.3 Structured data

- Google **retired FAQ rich results** for most sites in August 2023
  ([Google Search Central announcement](https://developers.google.com/search/blog/2023/08/howto-faq-changes),
  [summary](https://neilpatel.com/blog/google-ends-faq-rich-results/)). FAQ
  markup is therefore kept for entity and answer-engine understanding, **not** in
  the expectation of a rich result.
- `Corporation` with `tickerSymbol` and `exchange` is the highest value node for
  a company page: it is the machine-readable statement "this URL is the OreWire
  page for this listed entity".

### 2.4 AEO and GEO

Answer engines (Google AI Overviews, ChatGPT, Perplexity, Claude, Copilot) cite
passages, not sites. Practical guidance converges on
([AEO guide](https://www.frase.io/blog/what-is-answer-engine-optimization-the-complete-guide-to-getting-cited-by-ai),
[GEO playbook](https://www.frase.io/blog/how-to-get-cited-by-ai-search-engines-the-complete-geo-playbook)):

- Direct question and answer pairs, short and self-contained.
- Named entities stated explicitly, with ticker and exchange spelled out.
- One fact per sentence where possible, so a passage can be lifted intact.
- Being crawlable by the AI crawlers at all, which is a robots.txt decision.

### 2.5 `llms.txt`

The evidence for `llms.txt` is weak: a study across 300k domains found **no clear
effect on AI citations**
([Search Engine Journal](https://www.searchenginejournal.com/llms-txt-shows-no-clear-effect-on-ai-citations-based-on-300k-domains/561542/),
[SE Ranking](https://seranking.com/blog/llms-txt/)). It is implemented here as a
cheap supplement to indexable HTML, never as a substitute. Nothing in the plan
depends on it.

---

## 3. What has been implemented

### 3.1 Backend: a crawler-rendered SEO surface

New module `Server/lib/seo/`:

| File | Responsibility |
|---|---|
| `util.js` | `slugify`, the mirrored `slugSql` expression, URL builders, HTML escaping, summarising |
| `schema.js` | schema.org JSON-LD `@graph` builders (Organization, WebSite, Corporation, NewsArticle, BreadcrumbList, FAQPage) |
| `data.js` | every database read the SEO layer needs, including name-slug resolution |
| `pages.js` | the full HTML documents served to crawlers, with content, facts tables, filings, news, people and FAQs |
| `sitemaps.js` | sitemap index, child sitemaps, `robots.txt`, `llms.txt` |

New router `Server/routes/seo.js`, mounted at the application root in
`Server/index.js`:

| Endpoint | Purpose |
|---|---|
| `GET /robots.txt` | allows search, social and AI crawlers, declares the sitemap, blocks private routes |
| `GET /llms.txt` | markdown index for language models |
| `GET /sitemap.xml` | sitemap index |
| `GET /sitemaps/companies-N.xml` | up to 10,000 company profiles per file |
| `GET /sitemaps/news-N.xml` | news releases |
| `GET /sitemaps/filings-N.xml` | decoded filings |
| `GET /sitemaps/static.xml` | the hub pages |
| `GET /company/:slug` | **rendered company profile**: title, H1, facts, filings, news, people, FAQs, JSON-LD |
| `GET /companies` | rendered company index, paginated |
| `GET /news/:slug` | rendered news item |
| `GET /filings/:id` | rendered filing |
| `GET /seo/status` | JSON summary of what is being published |
| `GET /seo/company/:slug` | always-rendered company page, for QA |

Details that matter:

- **Company pages are canonical at `/company/<company-name-slug>`**, for example
  `/company/carson-river-ventures-corp`. The old ticker URL still resolves and is
  **301 redirected** to the name URL, so the two forms never compete.
- The slug rule is implemented twice, in JS and in SQL, and the two are required
  to agree character for character. This is documented in `util.js` because a
  divergence silently 404s every company page.
- Requests arriving on a **non-canonical host** (the raw backend domain, a
  preview URL) get `X-Robots-Tag: noindex`, so only the `www` copy is indexed.
- Company profiles are enriched with commodities, continents and country using
  the same helpers the public API uses, so crawler and user views agree.

### 3.2 Frontend: crawler routing and per-page head

- `frontend/nginx.conf` is now a **template**. It maps crawler user agents
  (search, AI, social and SEO tooling) and proxies the content routes and the
  generated files to the backend. Ordinary visitors still get the SPA unchanged.
  `/robots.txt` is served statically so it can never 502.
- `frontend/orewire-proxy-headers.inc` sets `Host` to the upstream while
  preserving the public host in `X-Forwarded-Host`, which is what the backend
  uses for its canonical-host decision.
- `frontend/Dockerfile` copies the template to
  `/etc/nginx/templates/default.conf.template` and sets a configurable
  `BACKEND_UPSTREAM`.
- `frontend/index.html` gained a correct absolute canonical, a `robots` meta
  directive, `og:site_name`, a sitemap link, static Organization and WebSite
  JSON-LD, and a `<noscript>` fallback with real links.
- `frontend/src/lib/seo.ts` adds client-side head management (`useSeo`) plus
  JSON-LD builders mirroring the backend, so crawlers that *do* run JavaScript
  and human users get correct titles and canonicals too.
- `useSeo` is wired into `CompanyDetail.tsx` and `Companies.tsx`.
- The company index now links to the canonical **name** URLs.
- The public API (`GET /api/companies/:idOrSlug`) now resolves name slugs, which
  is what makes the name-based canonical URL work inside the SPA.

### 3.3 News URLs are now canonical and citable

The old news URL was `encodeURIComponent(link || title)`, producing
`/news/https%3A%2F%2F...`. It carried no keywords, was ugly to cite, and could
not be shared. The canonical form is now **`/news/<title-slug>-<id>`**.

- `newsUrl()` in `Server/lib/seo/util.js` and `newsSlug()` in
  `frontend/src/lib/seo.ts` implement the same rule, so crawler HTML, the
  sitemap and SPA links all agree.
- The sitemap, the rendered news page and the company page news list all emit the
  new form.
- `fetchNewsItem()` parses the `-<id>` suffix and resolves by primary key,
  falling back to the legacy link lookup, so **previously shared links keep
  working**.
- `NewsDetail.tsx`'s fallback feed scan matches both slug shapes.

### 3.4 Entity signals

`sameAs` is the signal that tells a search or answer engine which other URLs
describe the same company. Two are emitted, and only where the URL shape is
already proven by this codebase, because an invented URL that 404s is worse than
none:

- the company's own website;
- for ASX listings, the ASX announcements page for the ticker, using the exact
  pattern the ASX scraper already builds in
  `Server/lib/scraper/asx/filings-scraper.js`.

Filing pages additionally emit a `DigitalDocument` node whose `sameAs` and
`isBasedOn` point at the original regulatory document (`filings.source_url`). This
lets an answer engine verify a claim against the primary source, and it credits
SEDAR+ or ASX rather than appearing to compete with them. The same link is shown
visibly on the page.

### 3.5 Crawl hubs and internal linking

Discovery of ~2,000 company profiles depended entirely on the sitemap, which is a
weak crawl graph: sitemaps get URLs *seen*, but not *linked*, and internal links
are what carry relevance and signal that a page matters.

Commodity, exchange and continent hub pages now exist, and they link both ways:

- `/companies?commodity=Gold` (and the eight other commodities in `COMMODITY_KEYS`)
- `/companies?exchange=TSX` (and TSXV, CSE, ASX)
- `/companies?continent=Africa` (and North America, South America, Australia, Asia, Europe)

Every company profile links **up** to its commodity hubs and its exchange hub;
every hub links **down** to 100 profiles plus all the other hubs, paginated with
`?page=N` which preserves the filter. The hubs are also listed in
`sitemaps/static.xml`.

Two correctness details worth keeping:

- **Param naming had to be reconciled.** The in-app filter uses
  `/companies?market=TSX-V`, while the hub links use
  `/companies?exchange=TSXV`. A user clicking a hub link would have seen an
  unfiltered list. `Companies.tsx` now accepts `exchange` as an alias and
  normalises `TSXV` / `TSX-V`, and its canonical is built to match the crawler's
  exactly, so the SPA and crawler views cannot compete over the same hub.
  Continent hubs needed none of this: `?continent=Africa` is already the SPA's
  own parameter and value, because both sides read the same `CONTINENT_KEYS`.
  The branch order in the SPA's canonical builder (commodity, continent,
  exchange) deliberately matches the crawler renderer's, so the two cannot emit
  different canonicals for the same hub.
- **The hub filters are deliberately duplicated**, not imported from
  `routes/api/companies.js`, so a change to the public list filter cannot
  silently change what a crawler is shown.

### 3.6 IndexNow

`Server/lib/seo/indexnow.js` plus `Server/scripts/submit-indexnow.js` submit URLs
to the shared IndexNow endpoint, which covers Bing, Yandex, Seznam and Naver.
Bing is the target that matters: it backs Copilot and feeds several answer
products, so a new company profile reaching Bing quickly is a direct route to
being answerable. Google does not participate in IndexNow, so this supplements
the sitemap rather than replacing it.

```
npm run seo:indexnow                # hubs, static pages
npm run seo:indexnow -- --recent 200
npm run seo:indexnow -- --companies
```

Disabled unless `INDEXNOW_KEY` is set, so an unconfigured environment is
unaffected. Two things are load bearing: the key file must be served at
`/<key>.txt` (nginx has a dedicated regex location for it, because the SPA
fallback would otherwise return `index.html` and fail verification), and the key
file must be reachable **before** submitting.

`lib/schedulers/seo-indexnow.js` also runs this automatically, daily at 05:30
(`SEO_INDEXNOW_CRON`, `SEO_INDEXNOW_WINDOW_HOURS`, default 24h lookback). It
submits the hubs plus only the company profiles whose `updated_at` moved inside
the window, because the point of IndexNow is to say "this is new", not "this
exists": resubmitting the full catalogue daily would be noise. It follows the
existing scheduler pattern, so a failure there is caught and logged rather than
taking down scheduler startup.

### 3.7 Titles now promise only what the crawled HTML delivers

The company page title previously read
`… (TSXV:CRV) Stock Price, Filings & News`. The crawled HTML carries market
capitalisation, shares outstanding, exchange, ticker, filings and news, but **not
a live quote**, because fetching one would put an external call with no latency
guarantee on the crawler path. A title that overclaims is a genuine quality
problem, so both the crawler renderer and the SPA head now say
`… Filings, News & Company Profile`.

Round 4 concluded from this that the title should stop claiming a price, and
noted that a quote could only be added later via a cache table written by the
quote scheduler. **That cache table already existed and had been missed**:
`migrate.js` adds `quote_price`, `quote_change_pct`, `quote_change_abs`,
`quote_volume` and `quote_updated_at` to `companies`, refreshed every 30 minutes
by `company-quote-refresh.js`. Section 3.14 covers what was done with it. The
title still does not claim a price, because the quote is a timestamped last price
that may be absent for a given company, and a title cannot honestly say both.

### 3.8 Cache safety: the failure mode that would silently undo all of this

The content routes answer with the SPA shell for a person and with rendered HTML
for a crawler, chosen by User-Agent. That makes the response a function of the
request **and** the user agent, which an edge cache keyed on the URL alone cannot
represent. There are two ways this goes wrong, and one of them is fatal:

- If a cache stores the **crawler HTML**, a human visitor can be served the plain
  crawler page instead of the app.
- If a cache stores the **SPA shell**, a later crawler request is answered from
  cache and **never reaches the renderer at all**. The crawler quietly sees an
  empty `<div id="root">` again — exactly the original problem — and nothing in
  the logs shows it.

Both directions are now closed:

| layer | header | why |
|---|---|---|
| backend, rendered HTML | `Cache-Control: private, no-store` + `Vary: User-Agent` | guarantees crawler HTML never lands in a shared cache |
| backend, robots/sitemaps/llms.txt | `public, s-maxage=3600` | these are byte-identical for every user agent, so caching is correct |
| nginx, SPA shell (`location /`) | `Cache-Control: no-cache` + `Vary: User-Agent` | stops a crawler request being answered from a cached shell |

`Vary: User-Agent` is the semantically correct signal and is kept for
spec-compliant caches, but it is not sufficient on its own: **Cloudflare does not
use `Vary` when computing its cache key.** `no-store` and `no-cache` are what
actually enforce the behaviour.

Two details that are easy to get wrong:

- The shell's `no-cache` is set in `location /`, **not** on the content-route
  location. `try_files … /index.html` performs an internal redirect, which re-runs
  location matching, so headers attached to the content location are discarded by
  the time the file is served. Putting them there would look correct and do
  nothing.
- The shell now revalidates on every SPA route, including the home page, because
  `location /` serves them all. That is a deliberate trade: it costs a
  revalidation per HTML request and removes any chance of a cache handing a
  crawler a shell. `/assets/` keeps its one-year immutable caching.

### 3.9 Citable statistics on the hubs

Research on generative engine optimisation converges on one practical point:
a passage carrying a concrete, verifiable **statistic** is far more likely to be
quoted by an answer engine than prose is. OreWire already owns those numbers.

The index and its hub pages now answer, in a real `<table>` with the question as
the heading and a plain sentence above it:

- **How many mining companies does OreWire track for each commodity?** with a
  count per commodity, each linking to its hub.
- **Which exchanges are these companies listed on?** with the per-exchange
  breakdown, scoped to the commodity on a commodity hub.
- The same facts are duplicated as `FAQPage` question and answer pairs, each
  answer a single self-contained sentence carrying the number, so it can be
  lifted intact. A `Dataset` node describes the counts.

Two decisions worth keeping:

- **Counts only, never a combined market capitalisation.** `market_cap` is stored
  in mixed currencies (CAD, AUD, USD), so a total would be arithmetically
  meaningless. A wrong statistic is worse than no statistic: it is the fastest
  way to lose the credibility that makes a source quotable at all.
- **The counts go through the same `hubFilter` as the hub listings**, one query
  per commodity, rather than one query with conditional aggregates. That makes it
  impossible for the published number to disagree with the number of companies
  actually listed on the hub, and it keeps the blast radius of a malformed
  `raw_data` row to a single commodity instead of the whole page. The queries are
  also caught individually in the route, so the statistics are strictly additive:
  a failure degrades the page to the company list rather than taking it down.

### 3.10 Two sitemap URLs were returning 404, and the audit that catches this class of bug

nginx proxies crawler requests for `/company`, `/companies`, `/news` and
`/filings` to the renderer. The renderer had routes for `/company/:slug`,
`/companies`, `/news/:slug` and `/filings/:id` — but **not** for `/news` or
`/filings` themselves. Both of those are listed in `sitemaps/static.xml`.

The result: a sitemap advertising two URLs that answered **404 to every
crawler**. A browser saw the SPA and never noticed. Search Console would have
reported both as Not found.

This is the characteristic failure of a User-Agent split: a URL can be correct
for a person and wrong for a crawler, and nothing in normal testing reveals it.
The fix is `renderNewsIndexPage` / `renderFilingsIndexPage` plus the matching
routes, reusing the sitemap row queries so no new SQL was needed.

`scripts/audit-seo-urls.js` exists to catch the whole class:

```
npm run seo:audit
npm run seo:audit -- --sample 50 --concurrency 4
```

It fetches `/sitemap.xml` as **Googlebot**, walks every child sitemap and every
URL in them, and fails if any URL does not return 200 with rendered markup — it
treats "200 but served the SPA shell" as a failure too, because that is the other
way this setup breaks silently. It exits non-zero, so it can gate a deploy.

The same class of bug had a second instance worth recording, because it looked
different. `/market-news` is listed in the sitemap, but nginx did not proxy it to
the renderer at all, so it was not a 404 like `/news` and `/filings` — a crawler
that runs JavaScript saw a perfectly good page, and only a crawler that does not
run JavaScript saw the empty shell. It is proxied and rendered now
(`renderMarketNewsIndexPage`), with the item links going out to the publisher
under `rel="nofollow noopener"`, matching the SPA.

Its query is a deliberate copy of the public feed's from
`routes/api/news.js queryFeedTable()`: `relevant = TRUE`, the blocked-publisher
clause, and the archived-company exclusion. Market news has an admin-managed
blocklist, and rendering those rows without it would have published items the
platform has deliberately hidden — a policy breach, not just an SEO slip.

Every sitemap URL should be checked this way after any change to the nginx
User-Agent rules, because that is the only place the split can go wrong.

### 3.11 The company page now carries OreWire's two pieces of unique content

The company page is the page that has to win a company-name query, and it was
missing the two things OreWire has that nobody else does: its own written
analysis, and its insider data. Both are now in the crawled HTML.

- **`OreWire analysis`** — the cached `company_snapshots` row, rendered as key
  points plus full paragraphs. This is the most quotable content on the site: it
  is written for this company from this company's own filings, news and insider
  data. Read through `getCachedSnapshotView()`, a new export on
  `lib/companies/snapshot.js` that reuses the existing `formatResponse()`, so
  prose sanitising applies to text cached before those rules shipped.
- **`Insider ownership`** — the largest holders and the three most recent insider
  transactions, as tables.

Two constraints shaped this, and both matter:

- **The snapshot is read, never generated.** A model call has no latency bound
  and real cost, and this code runs on the crawler path. If no snapshot exists,
  the section is simply omitted.
- **The insider rows are capped at exactly what an anonymous visitor sees** in
  the SPA: top five holders, three most recent transactions. That cap is not a
  display choice. The rest sits behind registration, so publishing more would
  both undercut the paywall and make the crawled page differ from the page a
  person gets — the one line dynamic rendering must not cross.

`getCachedSnapshotView()` is required lazily inside the SEO data layer, because
`lib/companies/snapshot.js` pulls in the AI client at module load and the page
renderer should not depend on that just to render a profile.

### 3.12 Crawler coverage, the single point of failure, and the escape hatch

The nginx User-Agent map is the load-bearing part of this whole design. If a bot
is not in that list it receives the empty SPA shell, the site looks perfect in a
browser, and **nothing anywhere reports a problem**. Three of the bugs found in
this work were variations of that theme.

The list covers Googlebot, Bingbot, the major AI crawlers (GPTBot, OAI-SearchBot,
ChatGPT-User, PerplexityBot and -User, ClaudeBot and -User and -SearchBot,
Google-Extended, Applebot and -Extended, DuckAssistBot, Amazonbot,
meta-externalagent, cohere-ai, MistralAI-User, YouBot, CCBot, Bytespider,
PetalBot), the social unfurlers, and the SEO tools. New AI crawlers appear
regularly, though, so the list cannot be complete by construction.

`EXTRA_CRAWLER_UA_PATTERN` closes that gap without a code change:

```
EXTRA_CRAWLER_UA_PATTERN=~*newai-bot
```

It is inserted verbatim as an extra nginx map mask, so it must carry its own
match operator. The Dockerfile defaults it to `~*orewire-never-matches` — a valid
regex that matches no real User-Agent. That default matters: substituting an
empty value would leave a bare `""` mask, and **a malformed map stops nginx from
starting**, which takes the whole frontend down. A never-matching regex cannot do
that. Omit the `~*` and the value becomes an exact match that will not match a
real User-Agent — it fails safe, serving the SPA and never the reverse.

**Why not invert the logic instead?** Treating "anything that does not look like
a browser" as a crawler would cover unknown bots automatically, and it was
rejected deliberately. Real browsers almost always send `Mozilla/5.0`, so the
inversion would mostly work, but any UA-mangling proxy or privacy tool would then
serve a real visitor the plain content page instead of the app. That is a visible
breakage for a user, whereas a missing bot is an invisible one for us with a
one-variable fix. Fail safe, not fail clever.

Verify coverage with `npm run seo:audit`, which requests the sitemap as
Googlebot, and spot-check a specific agent directly:

```
curl -sA "PerplexityBot/1.0" https://www.orewire.com/company/TSXV-CRV | head -40
curl -sA "GPTBot/1.2" https://www.orewire.com/company/TSXV-CRV | head -40
```

### 3.13 Paginated listing pages past page one are noindex, follow

The hubs are paginated at 100 companies per page, and there are nine commodities,
four exchanges and six regions — roughly **380 listing pages**, each a thin slice
of a list, all of them indexable. Adding the paginated news, filings and market
news indexes makes it worse.

Every one of those pages competes for crawl and index budget against the
~2,000 company profiles, which are the pages that can actually win a query. Page
one of each hub is a legitimate landing page and stays indexable; page two
onwards is not.

They are `noindex, **follow**` rather than `noindex, nofollow` on purpose:

- the pager links still get followed, so discovery of deeper companies is
  unaffected;
- every profile is listed in the sitemap regardless, so nothing becomes
  unreachable;
- only the indexing of the thin pages is suppressed.

The SPA's `Companies.tsx` sets the identical directive from the same `page > 1`
test, because the crawler and user views must not disagree about the same URL.

### 3.14 The share price, from the cache that was already there

"Do you have a price for this company" is the most common question asked of a
company profile, and section 3.7 had concluded OreWire could not answer it in
crawled HTML without an external call. That conclusion was wrong: the cache
already existed as columns on `companies`, written every 30 minutes.

The company page now carries a **Share price** block — price, percentage change,
absolute change and volume — plus a `FAQPage` entry, *"What is ____'s share
price?"*, answered with the figure and the timestamp.

Four constraints, each deliberate:

- **Read, never fetched.** Straight from `companies.quote_price`. The crawler path
  makes no external call.
- **No currency is asserted, anywhere.** The quote cache has no currency column,
  and mining companies on the TSX and TSXV do not all report in CAD. Deriving a
  currency from the exchange would therefore be wrong for a real subset of them,
  and a wrong financial figure is worse than an absent one. The page says plainly
  that no currency is asserted and points at the interactive profile for it.
- **Omitted once older than `SEO_QUOTE_MAX_AGE_MINUTES`** (24h by default). The
  movers board treats 35 minutes as stale, which is right for a live board; a
  profile page can carry an older number, but only while it is labelled as a
  timestamped last price rather than a current one. Beyond the window the section
  disappears rather than showing a figure someone could mistake for today's.
- **Deliberately absent from the JSON-LD.** A stale price rendered as structured
  data could reach a rich result, where the timestamp would be stripped away and
  the number would stand alone as if it were current. The visible prose keeps its
  "as of" attached; structured data would not.

The `dp` precision is chosen once and shared by the price and the absolute
change, so a sub-dollar small cap does not render as `0.0850` next to `-0.002`.

### 3.15 The rule: the crawled page shows what the SPA shows

Dynamic rendering only stays legitimate if the two views agree. Reviewing each in
isolation had missed that, so the check is now mechanical: **read the SPA page
component and diff the fields it renders against the fields the crawler renderer
emits.**

Doing that for `FilingDetail.tsx` found the crawler page showing *less* than a
person sees. Three substantive fields were missing:

| field | section |
|---|---|
| `ai_output.resource_estimate` | Resource estimate |
| `ai_output.grade_commentary` | Grade commentary |
| `ai_output.context` | Context |

For a mining audience the resource estimate is a headline number, and grade
commentary is what a drill result is actually judged on. All three are now
rendered, in the same order as the SPA, via one `analysisSection()` helper.

The same diff found a smaller mismatch: the SPA reads shares outstanding as
`data.shares_outstanding ?? data.total_float`, so where the first column is empty
it shows the float. The crawler page showed nothing. Now it uses the same
fallback.

**And the diff produced a rule, in both directions.** Fields that exist in the
database or the public API but that the SPA deliberately does not surface stay
out of the crawled HTML:

- `ai_output.cash_position`, `burn_rate_quarterly`, `pp_amount`, `pp_price`,
  `insider_holdings` — all returned by `GET /api/filings/:id` with no auth, none
  rendered by the filing page. Publishing them would diverge from the user view.
- `companies.listing_date` and `companies.region` — present on the row, surfaced
  nowhere in the SPA. Absent from the page deliberately; a column the product
  chooses not to show is not automatically safe to publish.

The public API being open is not the test. The test is what the page shows.

### 3.16 The company page diff came back clean, and yielded a contact address

Running the same field diff against `CompanyDetail.tsx` — the page that has to win
a company-name query — found **no missing content**. Every substantive section is
already rendered: About, the AI analysis, management and directors, filings, news
releases, insider ownership and transactions, and the share price. Two sections
are excluded, both correctly:

- **Corporate Spotlight** is a `Not Yet Available` upsell panel inviting company
  directors to email OreWire. It is an empty state, not content.
- **Discussion** is user-generated comments, which are thin, unmoderated and
  better left out of a crawled snapshot.

The diff did surface one thing worth having: **`hello@orewire.com`**, which the
page displays publicly and which also appears in the Contact page, Terms, Privacy
and every outbound email template. It is now `email` and a `contactPoint` on the
Organization node, in the backend schema, the SPA helper and the static shell.

Two Organization properties are deliberately still absent:

- **no `logo`** — no first-party logo asset exists in the repo; the only images
  are `favicon.ico` and `placeholder.svg`. A broken logo URL is a worse signal
  than no logo URL.
- **no `sameAs`** — no verified OreWire social profile is referenced anywhere in
  the codebase. Inventing an X or LinkedIn URL would be a fabricated entity
  claim, which is precisely the kind of thing entity SEO punishes.

### 3.17 Every content route now sets its own canonical in the SPA

`frontend/index.html` carries a static `<link rel="canonical" href="https://www.orewire.com/">`.
That is correct for the homepage and wrong for every other route: any page that
did not call `useSeo` inherited it, so the SPA asserted that `/filings`,
`/news`, `/market-news` and `/filings/:id` were all copies of the homepage.

Only `CompanyDetail` and `Companies` had a `useSeo` call. All six content routes
do now:

| route | component |
|---|---|
| `/company/:slug` | `CompanyDetail.tsx` |
| `/companies` | `Companies.tsx` |
| `/news` | `News.tsx` |
| `/news/:slug` | `NewsDetail.tsx` |
| `/market-news` | `MarketNews.tsx` |
| `/filings` | `FilingsList.tsx` |
| `/filings/:id` | `FilingDetail.tsx` |

**Why this matters even though crawlers get the rendered HTML.** The User-Agent
map is the only thing separating the two views, and section 3.12 exists precisely
because that map can be incomplete. A JavaScript-rendering crawler that reaches
the SPA must not be handed a canonical telling it the page is the homepage — that
is an instruction to drop the URL, not merely a missing signal. The same applies
to the `noindex, follow` directive on paginated listings, which the SPA now sets
from the same `page > 1` test as the renderer.

A single global canonical manager was considered and rejected. The effect
ordering is not reliable — a page's `useSeo` effect and a router-level fallback
effect run in an order that depends on component nesting, so the fallback would
sometimes overwrite the page's own value. Per-page calls are deterministic.

### 3.18 Two scripts, because every check here used to be manual

Every invariant in this document was verified by hand, because the environment
this work was done in had no working shell. That is not a good arrangement: three
defects were caught only by re-reading code, and one of them — `/news` and
`/filings` in the sitemap, proxied by nginx, answering 404 because no route
existed — stayed live for several rounds.

There are now two runnable checks, one for each side of the deploy:

| command | when | what it needs | what it checks |
|---|---|---|---|
| `npm run seo:check` | **before** deploy | nothing | modules load, exports exist, nginx paths have routes, SPA routes declare metadata |
| `npm run seo:audit` | **after** deploy | the live site | every sitemap URL returns rendered HTML to a crawler |

`seo:check` performs no database or network access. Its most valuable test is
simply `require()`-ing every module under `lib/seo/` plus `routes/seo.js`:
`Server/index.js` requires the SEO router at startup, so a syntax error or a bad
require path anywhere in the tree stops the **whole backend** from booting, not
just the SEO routes. A missing import in a page renderer is exactly the defect
that shipped twice during this work.

It also cross-checks the paths nginx proxies against the routes that exist, which
is the specific check that would have caught the 404s, and asserts that all seven
SPA content routes call `useSeo` and that the four paginated renderers use the
shared `listingRobots(page)` helper.

Neither script is a substitute for the other. Static checks cannot tell you
whether nginx is configured correctly in Dokploy or whether Cloudflare is
challenging bots; the live audit cannot tell you why a module fails to load.

`seo:check` also reports two **warnings** that no code change can fix, because
both need a real file supplied by a human:

- `og:image` still points at a leftover Lovable preview render on a third party
  bucket. Every social share shows an asset hosted somewhere OreWire does not
  control. It needs a first-party `https://www.orewire.com/og-image.png`
  (1200×630).
- There is no `logo.png`, so `Organization.logo` is omitted. The repository
  contains exactly two image files and neither is a brand asset:
  `favicon.ico` and `placeholder.svg`.

They are warnings rather than failures so they cannot block a deploy, but they
print on every run so they cannot be quietly forgotten either.

### 3.19 Cross-listings, and the identifiers that cannot be read cheaply

Checking the live `GET /api/companies/CSE-CRIV` response against the crawler
renderer found that the SPA's identifiers card shows **every listing a company
has** (`symbols[]` from `instrument_symbols`) while the crawled page showed only
the primary one. That matters more than it sounds: a junior miner is often
cross-listed on a US OTC venue, and a searcher may well use the other ticker.

Now rendered as an "Other listings" row, plus a `FAQPage` answer —
*"What other exchanges is ____ listed on?"*. Secondary listings only, filtered
against the company's own exchange and ticker, so a single-listing company does
not show a duplicated row.

**ISIN and CUSIP are deliberately still absent**, despite the API returning them
and the identifiers card displaying them. They are not stored anywhere: they come
from a live TradingView call (`fetchTvFundamentals` in `lib/market/tv-quote.js`).
Adding them would put an external request with no latency bound on the crawler
path — the same objection as section 3.7. Unlike the share price, there is no
cached column to read instead, so the tradeoff cannot be resolved the way 3.14
resolved it. If they are wanted, the fix is to persist them on `companies` from
the existing quote refresh, then read the column.

`listing_date` and `region` also remain unpublished, per the rule in section 3.15.

### 3.20 Thin news, at a scale that would have suppressed everything else

Found by asking the live API how much content exists. The answer changes the plan:

| content | rows |
|---|---|
| company profiles | 2,394 |
| filings | 96,880 |
| news items | 131,012 |

**Every one of six sampled news items was thin.** Their `summary` was either a
bare dateline — `"Paris, October 1 st 2026, 2:00 p.m."` — or the title with the
publisher appended: `"Bellevue Gold Limited (ASX:BGL): FY26 Delivery and Hedge
Book Roll-Off Shape the Next Phase Kalkine"`. The Google News descriptions are all
that was captured.

Submitting ~131,000 near-empty, largely duplicate URLs would have been the single
most damaging thing in this whole body of work: it buries the ~2,400 company
profiles in a mass of pages with no content, and it is a textbook way for a
site with no authority to be assessed as low quality overall.

**The rule** (`THIN_SUMMARY_CHARS = 200` in `lib/seo/util.js`, mirrored in
`frontend/src/lib/seo.ts`) is a plain length test so the SQL and JS sides cannot
drift:

- `hasSubstantiveSummarySql('n')` filters `countNews()` and
  `listNewsSitemapRows()` — so thin items are out of the sitemap **and** out of
  the `/news` index, which share those two queries.
- `hasSubstantiveSummary(item)` sets `noindex, follow` on a thin news page, in
  both the crawler renderer and `NewsDetail.tsx`. `follow` matters: those pages
  still carry links out to company profiles, and suppressing the index entry
  should not break discovery.

The company page's own news list is deliberately **not** filtered. It is a list of
linked titles, not an indexed page, and there the dateline items are still
useful context.

**Filings are different and stay fully listed.** Each carries an AI summary, a
verdict and a verdict reason, so they are substantive pages — and they are the
content nobody else has.

**This is the strongest argument yet for doing the reconnaissance first.** The
thin-content risk was invisible from the source; it took one API call to see.

### 3.21 The audit script defaulted to 228,000 requests

`audit-seo-urls.js` fetched *every* URL in every sitemap. With 96,880 filings and
131,012 news items, that is roughly 228,000 HTTP requests — well over an hour at
default concurrency, and indistinguishable from an attack to any edge in front of
the site.

It now samples **25 URLs per sitemap** by default, with `--all` to opt in
explicitly and `--sample N` to adjust. Sampling loses almost nothing: a missing
route or a broken User-Agent split fails for *every* URL on that sitemap, not just
the unsampled ones, so 25 is ample to detect the failures the script exists for.
The per-sitemap line now reads `(25 of 10000 url(s))` so a sampled run is never
mistaken for full coverage.

A second misattribution class also surfaced in that sample and is **not** fixed
here: the news-to-company link is sometimes wrong. Two Eramet press releases were
attributed to `Golden Cross Resources Inc.` and `Fortune Bay Corp.` respectively,
and a Citigroup/Resolute Mining item to `Peako Limited`. Same shape as section
0.1 — the join is wrong, and publishing it links crawlers to the wrong company
page. Worth the same upstream attention.

### 3.22 Two content decisions that follow from the real numbers

`GET /api/filings/stats` returns the actual corpus:

```json
{"companies":2394,"filings":96916,"analyzed":96137,"pending":779,
 "noteworthy":14840,"watch":16181,"routine":65102}
```

**Unanalysed filings are no longer advertised to crawlers.** 779 filings have no
AI output, so their pages carry nothing but a filename and a date.
`INDEXABLE_FILING_WHERE` requires a summary of at least 120 characters, and is
applied to the sitemap and the filings index — but **not** to `getFilingById()`,
because those filings are still legitimately reachable and linked. This is an
indexing decision, not a publication one.

**The crawl-budget trade-off is real and left as a judgement call.** The sitemap
presents ~2,394 company profiles against ~96,900 filings: forty times as many
filing URLs as company URLs, on a domain with no authority and therefore a small
crawl budget. Filings are the differentiated content and each carries a real AI
summary, so they stay listed — but if indexing coverage after deploy shows Google
working through filings while company profiles sit uncrawled, the lever is to cap
the filings sitemap to a rolling window (say 12 or 24 months) rather than dropping
it. That is deliberately not done now, because it would discard genuine long-tail
content on a guess.

**A verdict hub is the obvious next addition and is blocked on the SPA.** The
stats show 14,840 `noteworthy` filings, which would make a strong, differentiated
"/filings?verdict=Noteworthy" landing page. It is not built, because
`FilingsList.tsx` keeps its verdict filter in component state and does **not** read
it from the URL — so a hub link would show a user an unfiltered list. The SPA has
to sync the verdict to the URL first; building the crawler side alone would create
exactly the divergence sections 3.15 and 3.17 exist to prevent.

### 3.23 Guards for the empty set, which the thin-news filter made reachable

Excluding thin summaries (section 3.20) can legitimately reduce the news set to
zero — the sample was six for six. That made two previously theoretical states
reachable, and neither was handled:

- **An empty child sitemap.** `pageCount(0)` returns 1, so an empty `<urlset>` was
  published for news. Valid XML, a Search Console warning, and no reason to
  advertise a sitemap listing nothing. `sitemapChildren()` now omits a kind
  entirely when it has no rows.
- **An empty news index.** `/news` would render "OreWire summarises 0 news
  releases" over an empty list, which is a soft 404. It now sets
  `noindex, follow` and explains itself instead.

**Maintaining this file costs something, and that is worth stating.** Both of
these broke assertions in `scripts/check-seo.js`, which counted `robots:
listingRobots(page)` occurrences exactly. The assertions were rewritten to test
the *intent* (all four listings reference the helper; the news page gates on
summary substance; the news index guards the empty set) rather than exact string
counts. A self-audit that fails whenever correct code changes shape trains people
to ignore it, which is worse than not having one.

### 3.24 `updated_at` is not a content-change signal, and two features assumed it was

`saveQuote()` in `lib/market/company-quote-refresh.js` ends with:

```sql
UPDATE companies SET quote_price = $2, ..., quote_updated_at = NOW(),
                     updated_at = NOW() WHERE id = $1
```

That runs **every 30 minutes, for every quoted company**. So
`companies.updated_at` moves twice an hour across essentially the whole table,
whether or not anything on any page changed. Two things built on it silently
degraded:

- **The IndexNow freshness ping.** `listCompaniesUpdatedSince()` matched on
  `COALESCE(updated_at, created_at)`, so it selected all ~2,394 companies every
  run. The ping's entire purpose is to say "this is new" rather than "this
  exists"; it had become a daily full-catalogue resubmission, which is exactly
  what section 3.6 says it must not be.
- **Company sitemap `lastmod`.** It read `updated_at`, so every one of the 2,394
  profiles claimed to have changed half an hour ago, on every fetch. Inaccurate
  `lastmod` is worse than none: it teaches the crawler to ignore the field, and
  the field is how a sitemap says "come back here on your next pass".

**Fixes.** The ping now keys on real content events —
`listFilingsCreatedSince()` and `listNewsCreatedSince()`, which select new filings
and new news in the window and derive the affected company pages from them. News
is restricted to substantive summaries, because a thin news page is `noindex` and
pinging it would ask a crawler to fetch something that will not be indexed.
Company `lastmod` is now the newest filing for that company, falling back to
`created_at`.

`listCompaniesUpdatedSince()` is deleted rather than fixed. Its query was never
wrong; its *name* invited exactly this mistake, and leaving a function called that
in an SEO module is an invitation to use it again.

**The generalisable lesson:** a generic `updated_at` maintained by an unrelated
high-frequency job is not a content-change signal. Four separate features here
wanted "did this page's content change" and the schema had no column that
answered it.

### 3.25 The URL scheme was audited against every writer, and one gap was real

Section 3.1 made `/company/<company-name-slug>` canonical, on the reasoning that a
searcher types a company *name*. That decision had never been checked against what
the database actually does to the columns it depends on.

**Checked, and it holds.** Every writer of the `companies` table was enumerated —
twelve of them. `companies.name` is only ever **inserted**, never updated:

- `seeder.js` and `upload.js` insert, and check for an existing name first.
- `scrape-profiles.js` updates the profile fields through `COALESCE(new, existing)`
  for every column and never touches `name` — a deliberate design, commented as
  "a field the venue leaves blank never wipes data we already hold".
- the admin create endpoint inserts; the migrations touch symbol flags only.

So the name is effectively immutable and the canonical URL is stable by
construction.

**`exchange` and `ticker` are not.** `instrument-symbols-store.js` updates both in
place. A company that changes ticker would therefore have 404'd every URL built
from its old one, silently losing whatever equity those links had accumulated —
and this is the second reason the name-based scheme is the right one: a ticker
change does not move the canonical URL at all.

**Gap closed.** `instrument_symbols` retains every listing ever recorded, so
`findCompanyBySymbol()` resolves a past ticker and the route 301s it to the
current name URL. Added to both resolvers — `lib/seo/data.js` and
`routes/api/companies.js` — because a mismatch between them means the crawler
redirects where the SPA 404s, which is exactly what section 3.15's rule forbids.

**Known limitation, not fixed.** `lib/companies/migrate.js` deletes the source row
when two companies are merged, and no mapping is kept. A merged company's page
therefore 404s with nothing to redirect to. Recording it because it is a real
equity leak on a link-building effort, and the fix — persisting an alias row at
merge time and 301ing from it — is a schema change rather than an SEO one.

### 3.26 Extraction failures are a template, and were excluded only by luck

There are **three** terminal filing statuses, not one — `resolveFilingStatus()` in
`lib/scraper/analyzer/persist.js` returns `extraction_failed`, `company_mismatch`
or `analyzed`. Only `company_mismatch` was being handled.

`extractionFailedAnalysis()` in `lib/scraper/analyzer/constants.js` does not leave
the fields empty. It writes a **fixed canned analysis** for every failure:

```
summary:        "This filing could not be processed automatically because no
                 readable text was found."
ticker_summary: "Text extraction failed — view original PDF."
verdict:        "extraction_failed"
what_to_watch:  "View the original PDF for details."
```

So every extraction failure is byte-identical prose. Publishing them as pages
would be duplicate content at whatever scale the OCR failures reach — the same
class of problem as section 3.20's thin news, and the same remedy.

The summary-length floor was already excluding them, but **by accident**: the
canned summary happens to be 85 characters, under the 120 threshold. Editing that
sentence would have silently started indexing all of them. That is not a property
to depend on.

**Fix, and a separation worth keeping:**

| constant | question it answers | excludes |
|---|---|---|
| `PUBLISHABLE_FILING_STATUS` | can this be trusted against this company? | `company_mismatch` |
| `INDEXABLE_FILING_WHERE` | does this page have content? | not `analyzed = 1`, or summary under 120 chars |

`f.analyzed = 1` is the load-bearing test in the second, because
`analyzedFlagForAnalysis()` returns 0 for both pending filings and extraction
failures. The length floor stays as a second gate rather than being removed.

Both are indexing decisions, not publication ones: these filings remain listable
and still resolve at `/filings/<id>`.

**Measure it:**

```sql
SELECT status, COUNT(*) FROM filings GROUP BY status ORDER BY 2 DESC;
```

### 3.27 Two more data assumptions: one held, one needed a guard

**`raw_data` is always valid JSON — verified.** The commodity and continent hub
filters cast it (`raw_data::jsonb->>'Gold'`), and a malformed row would make every
commodity and region hub page fail, not just that row. Checked every write path:
`seeder.js` (three sites) and `upload.js` all write `JSON.stringify(row)`. There
is no path that writes anything else, so the cast is safe. This was worth
confirming rather than defending with a `try`/`catch` I did not need.

**A share price of zero is now suppressed.** `quoteSummary()` accepted any finite
number, so `quote_price = 0` rendered as "0.0000" and the FAQ answered *"OreWire's
most recent quote for ____ is 0.0000"*. Zero means no data, not a free share, and
the page presents the figure as the issuer's last price. The guard is
`price <= 0`.

Worth stating plainly: this is a guard, not a fix to an observed bug. I could not
query the column to see whether a zero is actually stored. It is cheap, it is
correct either way, and the cost of being wrong in the other direction is
publishing a false price for a listed company.

### 3.28 `news_releases` was the one listing missing the archived-company filter

Filings and market news both exclude items belonging to archived companies, using
the same clause the public feeds use. `countNews()` and `listNewsSitemapRows()`
did not — they never joined `companies` at all.

The consequence was narrow but real: the news sitemap advertised releases for
companies the site has deliberately hidden, and each of those news pages renders a
"Related company" link to a company URL that answers 404. Handing a crawler a dead
internal link is a small quality signal against, and it is exactly the kind of
divergence sections 3.15 and 3.17 exist to prevent.

Both queries now share `PUBLIC_NEWS_FROM` / `PUBLIC_NEWS_WHERE`, which mirror
`buildFeedFilters()` in `lib/news/db.js`: `relevant = TRUE`, archived companies
excluded, plus the substantive-summary floor from section 3.20. Sharing one
predicate between the count and the list is what keeps the advertised sitemap
count equal to the pages that exist.

### 3.29 First real execution of anything here, and it found a bug

The shell in this environment is still dead after thirty-six rounds
(`STATUS_DLL_INIT_FAILED`, confirmed from a separate process). Nothing in this
project has ever been run.

One route was available: the workflow tool executes JavaScript. So the pure
functions were transcribed into a script and executed against **real values
captured from the live API** during this work.

**What passed:**

| check | result |
|---|---|
| 14 real company names slugified | all valid (`[a-z0-9-]`, no leading/trailing dash) |
| `Carson River Ventures Corp.` | → `carson-river-ventures-corp`, the expected canonical |
| slug collisions across those 14 | none |
| the 6 real thin news summaries (34–99 chars) | all 6 correctly classified thin |
| a substantive control (250 chars) | correctly classified substantive |
| `summarise(text, 155)` on a 258-char input | 155 chars, within budget |
| `newsUrl()` forms | stable, no URL-encoded external links |

The thin-content threshold from section 3.20 is now **empirically validated**
rather than guessed: on real production data it separates the observed thin items
from a real summary with a wide margin.

**What it found.** `newsUrl()` emits `/news/<id>` when an item has an id but no
usable title. `resolveNews()` only recognised `<title-slug>-<id>` — the trailing-id
pattern requires the dash, and the fallback then looked a bare `7` up as a link or
a title and found nothing. **That URL 404'd**, in both the crawler renderer and the
SPA. Fixed in both: a purely numeric slug is now read as an id.

The sitemap never emitted such a URL, because it requires a non-empty title — but
the company page's news list does not filter on that, so it could hand a crawler a
dead link.

**Caveat, stated plainly.** The functions were transcribed by hand, so this
verifies the *logic*, not the files. A transcription error would cause a false
pass. It is still far stronger than reading, which is all that was available
before, and it is the reason a real bug is now fixed instead of shipped.

### 3.30 Structured data and escaping, executed against adversarial input

Same execution route as 3.29. The company description is scraped from exchange
sites, so it is untrusted; the test input was
`Acme </script><script>alert(1)</script> & "quotes" 'apostrophes' Corp`.

| check | result |
|---|---|
| JSON-LD parses with `JSON.parse` | **pass** |
| `</script>` present raw inside the `<script>` tag | **no** — it cannot break out |
| raw `<`, `>` or `&` anywhere inside the tag | none |
| company name round-trips exactly through the graph | yes |
| FAQ answer round-trips (incl. U+2028 / U+2029) | yes |
| `stripUndefined` drops `undefined` / `null` / empty array | yes (dropped `url`, `about`, `subjectOf`) |
| `escapeHtml` leaves no raw `< > " '` and no unencoded `&` | pass |
| `escapeHtml(null)` / `(undefined)` | `''`, no throw |
| XML escaping of a URL containing `&` and `<` | `&amp;`, `&lt;` |

**News slug round trip, all eight shapes, now including the round-36 fix:**

```
{id:42, title:''}            -> /news/42                          -> id 42
{id:7, title:'', link:'...'} -> /news/7                           -> id 7
{id:999, title:'   '}        -> /news/999                         -> id 999
{id:5, title:'---'}          -> /news/5                           -> id 5
{id:1, title:'2026'}         -> /news/2026-1                      -> id 1
```

Every id survives, and no URL ever contains an encoded external link. The bug
fixed in 3.29 is confirmed closed by execution rather than by reading.

**Two slug edge cases confirmed, and deliberately not coded around.** A name that
is entirely punctuation slugifies to empty and yields `/company/unknown`; a name
that is entirely digits yields `/company/123`, which the resolver reads as a
primary key and would resolve to a different company. Both are impossible for a
real listed issuer, and **all 2,394 production names were not tested** — only the
14 sampled in 3.29. Adding a special case for a shape that cannot occur would cost
more in resolver complexity than it protects, so both are recorded instead. If a
`slug` column is ever added to `companies` (section 5), it should reject an empty
or purely numeric slug at write time, which is the right place for this.

### 3.31 The HTML envelope, executed, and a false positive in my own test

`layout()` wraps every crawler page, so an escaping bug there affects all ~2,400
profiles, both hubs and every filing. Executed against a hostile company name
(`Acme "Quoted" & <Tagged> Corp.`) and description (containing
`<script>alert(1)</script>`):

| check | result |
|---|---|
| tag balance for all 12 emitted element types | all balanced |
| 29 attribute values | none contains a raw `<` or `>` |
| quote count in `<head>` | 82, even — no attribute terminated early |
| `canonical` with a query string | `…Rare%20Earths&amp;page=2`, no raw `&` |
| 8 required head elements (title, description, canonical, robots, og:url, twitter:card, JSON-LD in head, no og:image without an image) | all present |
| JSON-LD still parses with hostile data | yes |
| `<script>alert(1)</script>` in the description | escaped, no raw `<script>` in the body |
| `title`, `h1`, `p` text nodes | no raw `<` or `>` |
| the `STYLE` constant injected unescaped into `<style>` | contains no angle bracket, so it cannot close the element early |

**One flag was mine, not the code's.** The first run reported
`rawAngleBracketInTextNode: true`. The regex was
`/<(title|p|h1)[^>]*>[^<]*[<>]/` — it consumed the text with `[^<]*` and then
matched the `<` that *starts the closing tag*. The stronger capture
(`<(title|h1|p)\b[^>]*>([\s\S]*?)<\/\1>`) shows all three text nodes are clean, and
the faulty regex was reproduced to prove that is what it matched.

Worth recording because it is the mirror image of the rest of this document: I
came close to reporting a serious escaping bug that did not exist, and the same
carelessness that would have produced a false alarm could equally have produced a
false pass. A test is only evidence if the test itself is checked.

### 3.32 The sitemaps, executed: the index and the child route agree

The sitemap is the primary discovery mechanism, and its most dangerous failure is
silent: an index that advertises child sitemaps the router cannot serve. Google
fetches the index, finds nothing usable, and reports it days later. So the check
was the naming contract between `sitemapChildren()` and `childSitemap()`.

Executed against the real production counts (2,394 companies, 131,012 news,
96,916 filings):

| check | result |
|---|---|
| children generated | **26**, exactly the expected 1 + 14 + 10 + 1 |
| advertised children unservable by `childSitemap()` | **none** |
| duplicate child names | none |
| `<sitemapindex>` structure | declaration once, tags balanced, namespace declared, no raw `&` |
| a full 10,000-URL child sitemap | 10,000 `<url>` entries, tags balanced, every `<loc>` absolute |
| size of that child sitemap | **1,998,999 bytes (~2 MB)** |
| protocol limits (50,000 URLs, 50 MB) | both clear, by a wide margin |
| an entry with no `lastmod` | omits the element entirely; never emits `null` |
| `safeIso` on `null` / `undefined` / `''` / `'not a date'` | `null` — no `Invalid Date` can reach the XML |
| `safeIso` on a date-only string and an epoch number | both normalise to full ISO |
| `compactNumber` on the real values | BHP `298.28B`, Carson River `1.08M`, `813.90M`, `12.3K` |
| `compactNumber(0)` and `(null)` | `null`, so a zero market cap is omitted rather than printed as `0` |

**A useful incidental number:** a maximum-size child sitemap is only ~2 MB, so the
50 MB protocol ceiling would allow roughly 250,000 URLs. `PAGE_SIZE = 10000` is
five times more conservative than the protocol requires, and the byte limit is
nowhere near binding. 26 files is a perfectly good outcome, so there is nothing to
change — but if the file count ever became awkward, raising `PAGE_SIZE` is safe.

**No defects found this round.** Recording that plainly, because a verification
round that finds nothing is a result and not a gap: the sitemap naming contract,
the XML escaping, the date guards and the number formatting are all now confirmed
by execution rather than by reading.

**One practical note about the sandbox.** The workflow tool requires the return
value to be plain JSON; including an `undefined` property fails the whole run with
a type error. Values have to be normalised before returning them.

### 3.33 The hub canonical was not actually in parity, in two separate ways

Sections 3.5 and 3.17 both assert that the SPA's canonical and the crawler's must
be identical for the same hub. That was written twice and **never tested**. It was
wrong twice.

**Divergence 1: space encoding.** The renderer built its query string with
`URLSearchParams`, which serialises as `application/x-www-form-urlencoded` and
encodes a space as `+`. The sitemap built the same URLs by hand with
`encodeURIComponent`, which gives `%20`. Three hub values contain a space, so:

```
sitemap advertises   /companies?commodity=Rare%20Earths
page canonical says  /companies?commodity=Rare+Earths
```

The sitemap was pointing at a URL the page itself disclaimed. Same for
`North America` and `South America`.

**Divergence 2: dropped parameters.** The SPA used an `else if` chain, so a URL
carrying more than one hub parameter kept only the first, while the renderer kept
all of them. Over 54 fixture combinations, **40 produced different canonicals for
the same URL**:

```
URL: /companies?exchange=TSXV&continent=Africa
renderer canonical: /companies?exchange=TSXV&continent=Africa
SPA canonical:      /companies?continent=Africa
```

**Why neither surfaced.** Real hub links are single-parameter, and single-parameter
combinations agreed in all 14 cases. So every link the site actually generates was
fine, and only a URL a person or crawler assembled by hand diverged. That is
exactly the kind of defect that never shows up in manual testing.

**Fix.** One shared shape, applied to both builders: sequential parameters in the
order commodity, exchange, continent, page, each encoded with
`encodeURIComponent`. Re-run over the same fixtures: **all 19 sitemap hub URLs
equal the renderer's canonical, all 54 crawler/SPA combinations agree, and all 19
round-trip their parameter values** through `decodeURIComponent`.

**A first attempted fix was wrong and the test caught it.** Changing only the SPA
to sequential `if`s still left 30 mismatches, because the two sides were *also*
encoding spaces differently. Had I shipped the first fix on the strength of the
diagnosis alone, I would have replaced one inconsistency with a subtler one.

### 3.34 A Postgres collation difference that could 404 an accented company name

Sections 3.1 and 3.25 both assert that `slugify()` in JS and `slugSql()` in SQL
"must match exactly", and both note the rule is impossible to test from here
because Postgres cannot be run. That assertion had a hole.

`slugSql()` used `regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')`. In
PostgreSQL a bracket **range** is interpreted using the database collation, so
under a UTF-8 locale `[^a-z0-9]` can treat `á` as falling between `a` and `z` and
therefore **keep** it. JavaScript's `[a-z]` is always ASCII. Under such a
collation:

```
JS slugify    Amapá Minerals Holdings Inc.  ->  amap-minerals-holdings-inc
SQL (widened) Amapá Minerals Holdings Inc.  ->  amapá-minerals-holdings-inc
```

The company URL is built from the JS slug and the lookup uses the SQL expression,
so that company's page would **404 at its own canonical URL**.

**This is not hypothetical.** `GET /api/companies?search=á` returns
**"Amapá Minerals Holdings Inc." (TSX:AMAP, id 3640)**. Six accented characters
were probed — `á` matched; `ó`, `é`, `ñ`, `ü`, `ç` did not — so at least one real
company is exposed, and there is no reason to think it is the only one.

**Fix: remove the range from the SQL, not the dependence on it.** A literal
character list has no ordering, so a collation cannot widen it:

```sql
regexp_replace(lower(name), '[^abcdefghijklmnopqrstuvwxyz0123456789]+', '-', 'g')
```

Applied to `slugSql()` and to the two inline copies that had the same flaw:
the name-slug fallback in `routes/api/companies.js` and the title-slug fallback in
`routes/api/news.js`. A grep for `[^a-z0-9]` across `Server/` was the check that
found the second one; the remaining hits are JavaScript regexes, which are always
ASCII and therefore already correct.

**Verified by execution** over a 14-name corpus including accented, CJK and emoji
names: the literal class matches the JS slugify for every one, all slugs are
ASCII-only, and the widened behaviour was modelled to demonstrate the divergence
rather than assert it.

**The generalisable lesson.** I had written "these two must match" five times, in
comments, as though writing it made it true. It was untestable from here — but the
*reason* it was untestable was that I was relying on locale-dependent behaviour,
and the fix was to stop relying on it. "Untestable" was a clue, not a dead end.

### 3.35 Every hub has content, and the profile feeds publish mojibake

**The hubs are not empty.** Checked against the live API before trusting the
sitemap entries, because an empty hub is an empty page in a sitemap:

| hub | live total |
|---|---|
| `commodity=Gold` | 686 |
| `commodity=Rare Earths` | 35 |
| `continent=North America` | 701 |
| `exchange=TSXV` | 937 |

**Mojibake in the exchange profile feeds.** The `Rare Earths` response exposed it
in Aclara Resources Inc. (TSX:ARA, id 2):

```
"headquarters": "Cerro el Plomo 5630,Office 901 9th Floor, RegiÃ³n Metropolitana de Santiago, Santiago, CL"
```

The issuer's data says `Región`. The UTF-8 bytes `C3 B3` were each read as a
Latin-1 character. `pipeline/exchanges.js` fetches the TMX profile with
`res.json()`, which decodes UTF-8 correctly, so the damage is already present in
TMX's response rather than introduced here — which also means the two consumers
that read the stored column, the SPA and the crawler renderer, are equally wrong.

`?search=Ã` returns no matches, so **no company name is affected and no URL is at
risk**. The damage is confined to the scraped profile text: `headquarters`,
`description`, `transfer_agent`, `phone`.

**Fixed at the write point, not in the renderer.** `repairMojibake()` in
`lib/text/repair-mojibake.js`, applied in `saveProfile()` so every exchange source
benefits and both views render the corrected text. Repairing only in the SEO
renderer would have made the crawler page disagree with the SPA about the same
fact — exactly what the parity rules exist to prevent.

The rewrite is guarded three ways, because silently altering stored text is only
acceptable when it is provably safe: the mojibake signature must be present
(`Â`/`Ã` followed by a continuation character), every character must be Latin-1
representable, and the re-decode must not produce U+FFFD. Failing any guard
returns the input unchanged, so the worst case is the status quo.

**Verified by execution over 12 cases**, all passing:

```
REAL Aclara headquarters   RegiÃ³n Metropolitana  ->  Región Metropolitana
SOCIÃTÃ MINIÃRE            ->  SOCIÉTÉ MINIÈRE
clean ASCII / correct accent / CJK / Cyrillic  ->  unchanged
CJK plus mojibake          ->  unchanged (guard 2)
lone Â with no continuation -> unchanged (guard 1)
```

plus the `saveProfile()` wrapper: `undefined`, `null` and `''` all become `null`
so the `COALESCE` still leaves existing data intact.

### 3.36 The crawler published a market cap the SPA never shows

Reading `CompanyDetail.tsx` rather than assuming the API shape turned up a
contradiction on every company page:

```js
const sharesOut    = fund?.shares_outstanding ?? data.shares_outstanding ?? data.total_float;
const computedMcap = displayPrice != null && sharesOut != null ? displayPrice * sharesOut : null;
const marketCap    = computedMcap ?? fund?.market_cap ?? data.market_cap;
```

The SPA **does not display `companies.market_cap`** when it has a price and a share
count. It computes `price × shares` and treats the stored column as a last resort.
The crawler page published the stored column directly. Measured against real rows:

| company | stored (was published) | computed (now published) | printed price × shares |
|---|---|---|---|
| Agnico Eagle (TSX:AEM) | 141.48B | **132.11B** | 132.11B |
| Artemis Gold (TSXV:ARTG) | 8.75B | **9.27B** | 9.27B |
| Amapá Minerals (TSX:AMAP) | 366.28M | **396.15M** | 396.15M |
| Aclara Resources (TSX:ARA) | 742.69M | **885.52M** | 885.52M |
| Carson River (CSE:CRIV) | *(omitted)* | **1.53M** | 1.53M |

Two problems, and the second is the one that matters. The figure disagreed with
the SPA — Aclara's stored value is 19% below the computed one, so it is plainly
stale — and it was **internally inconsistent with the price and share count
printed beside it**. A page stating a price, a share count and a market cap that
do not multiply out reads as wrong to a person and to an answer engine, and this
is exactly the kind of arithmetic a reader can check.

The target company is on the last row: Carson River's stored `market_cap` is
`null`, so the old code published an empty cell. It now shows **1.53M**, derived
from the price and share count already on the page — a new citable fact on the one
company page the objective is about.

**Exact equality with a browser is not achievable and is not claimed.** The SPA can
prefer TradingView fundamentals, which are fetched live and cannot be reproduced in
a renderer, and its price can come from a live quote rather than the cached one.
What the change guarantees is that the document's own numbers agree with each
other — which is the property a crawler-served page has to get right.

This came from reading the SPA's own computation rather than from the API shape.
The `/profile` endpoint does not return `market_cap` at all, so assuming the
crawler and the SPA saw the same fields would have been reasonable and wrong.

### 3.37 The people section had one heading where the SPA has two

Same method as 3.36, applied to rendering instead of arithmetic. `PeopleSection`
in `CompanyDetail.tsx` renders **two** sections:

```jsx
{managers.length > 0 && <section><h2>Management</h2>{renderTable(managers)}</section>}
{directors.length > 0 && <section><h2>Board of Directors</h2>{renderTable(directors)}</section>}
```

The crawler page emitted a single `<h2>Management and directors</h2>` over one
combined list. Both showed the same people with the same titles, so no *fact* was
wrong — but the grouping is not cosmetic. "Board of Directors" is the heading an
answer engine matches a question like *"who is on the board of Carson River
Ventures"* against, and a combined heading does not answer it. That is a direct
AEO loss on the exact section a board question targets.

Fixed to mirror the SPA: `<h2>Management</h2>` for `kind === 'manager'`,
`<h2>Board of Directors</h2>` for `kind === 'director'`, each emitted only when
non-empty, with names stripped of honorifics by the SPA's own regex.

**Verified by execution.** Carson River's real rows (2 managers, 0 directors)
produce exactly one `<h2>Management</h2>` and no empty board heading; a mixed
fixture produces both; directors-only produces only the board; empty, null and an
unknown `kind` produce nothing. Honorific stripping matches the SPA including its
edge cases — `Dr Smith` → `Smith` (the period is optional) and `Ms.X` → `Ms.X`
(no space after the period).

**One difference left in place, deliberately.** The SPA makes each person's name a
link to `/insider/<slug>`, and the crawler page renders plain text. Those links are
not added, because **`/insider/` is not in the crawler proxy** (`frontend/nginx.conf`
matches only `/company`, `/companies`, `/news`, `/filings`, `/market-news`), so
there is no server-rendered insider page to link to.

Adding the links anyway would hand every one of ~2,400 company pages a set of URLs
that render only under JavaScript — which is precisely what AI crawlers do not do,
and they are the audience this section matters for. The whole crawler surface is
currently coherent: every crawled URL has server-rendered content. The prerequisite
is an insider renderer plus its proxy entry; until then, plain text is the honest
option.

### 3.38 A full inventory of what the SPA shows that the crawler does not

Reading `CompanyDetail.tsx`'s three cards end to end gives the complete picture,
and it splits cleanly into two very different categories.

**Category 1 — figures that exist only in a live third-party response.** These are
not stored anywhere, so a server-side renderer cannot show them without making
every crawled page depend on an external API:

| SPA shows | source | why the crawler omits it |
|---|---|---|
| ISIN, CUSIP | `data.fundamentals` | `fetchTvFundamentals()` in `lib/market/tv-quote.js`, called live per request |
| Avg Vol (30D) | `data.fundamentals` | same call |
| 52W High, 52W Low | `data.marketData` | `tv.price_52_week_high/low`, called live per request |
| price, change, volume | `liveQuote ?? data.marketData` | live; the crawler uses the cached `quote_price` instead |

The distinction matters: these are not facts being hidden. They are numbers whose
only existence is inside a live TradingView response. When that call fails the SPA
renders `formatEmpty(null)` — a dash — so the divergence exists only when
TradingView succeeds.

Persisting ISIN and CUSIP is possible but was **declined**. `company-quote-refresh.js`
calls `fetchCompanyQuote()`, not `fetchTvFundamentals()`, so caching them means
adding ~2,394 extra external calls to a scheduled job that currently works. That is
a rate-limit and failure-mode risk on a system that cannot be run or tested here,
taken to populate two rows. It is recorded as the right fix if someone can watch
the job.

**Category 2 — stored facts the SPA simply does not render.** My facts table shows
these; the SPA's cards do not:

| row | SPA | reasoning |
|---|---|---|
| Sector | prose only, in the About sentence | kept: it is `enrichCompany`'s own derived field and drives the hub filters |
| Commodities | not rendered | kept: same — the commodity hubs are built from it |
| Country | not rendered | kept: same derived field |
| Phone | not rendered | kept: scraped from the issuer's own exchange listing |
| SEDAR ticker | **destructured as `sedarTicker` and never used** | kept, but this is the weakest of the set |
| Transfer Agent | rendered, different label | **fixed** — see below |

This is a **deliberate, reasoned exception to the parity rule, not parity.** The
rule's original purpose was to stop the crawler publishing figures the product does
not stand behind — `cash_position`, `burn_rate_quarterly`, `insider_holdings`. These
are different in kind: public issuer-level facts, most of them derived by the API's
own enrichment and used as first-class filters by the hub pages. Removing them would
make the page *less* answerable for queries like "what commodities does X explore"
while making it no more accurate. Stating it plainly because I have argued the
opposite rule many times and this is an exception, not a consistency.

**The one genuine parity fix here.** `TransferAgentBlock` labels the field
`isAsx ? "Share Registry" : "Transfer Agent / Share Registry"`. The crawler said
"Transfer agent", which matched neither. Now it matches both cases. `factRows()`
already drops empty values, which mirrors the SPA's `{transferAgent && …}` guard, so
a company with no registry line renders no row on either side.

### 3.39 Filing sections re-verified, and a grep trap worth recording

Filing pages are 96,916 of the URLs, so a divergence there has the widest reach of
anything on the site. Section 3.12's exclusion of `cash_position`,
`burn_rate_quarterly`, `pp_amount`, `pp_price` and `insider_holdings` was made in an
early round and had not been checked against the component since.

**It was correct.** `FilingDetail.tsx` renders exactly seven analysis sections and
none of those five fields. The section list, order and headings now match exactly:

```
AI summary · Why this verdict · Key facts · Resource estimate ·
Grade commentary · Context · What to watch
```

One heading differed — the crawler said "OreWire summary" where the SPA says
**"AI summary"** — and it now matches.

**A trap worth recording, because it nearly produced a wrong conclusion.** The
first grep searched for `cash_position`, `key_facts`, `what_to_watch` and the rest
in snake_case, and returned almost nothing. That looks like evidence that the
component renders nothing — and on that reading I would have "confirmed" the
exclusions for the wrong reason, or worse, concluded the SPA shows bare filings. The
API returns **camelCase** (`filing.verdictReason`, `filing.keyFacts`,
`filing.whatToWatch`); the snake_case names are the database columns. Grepping a
frontend component for backend column names tests the wrong vocabulary entirely.

**Why I chose the SPA's label rather than the branded one.** "OreWire summary" would
put the brand next to the prose, which sounds like an AEO win. It is not, for two
reasons: attribution in answer engines comes from the structured data
(`publisher`, `isBasedOn`), the canonical URL and the page context, not from one
`<h2>`; and the prose is machine-generated from a filing, so "AI summary" is the
honest label. A heading that flatters the brand while slightly overstating the
human editorial role is the wrong trade.

The extra `<h2>Filing detail</h2>` above the facts table is mine — the SPA renders
those fields in a card without a heading. It is a label for the same facts, not an
additional claim.

### 3.40 A round-28 belief was wrong: most news is not thin

Section 3.20 was built on this finding: *"all 6 sampled `news_releases` had
`summary` = a bare dateline or title+publisher"*. From that I reasoned the thin
filter might reduce the news set to **zero**, and section 3.23 added guards for
exactly that. Both were reasonable, and both rested on a biased sample.

`GET /api/news/feed?limit=4` returns, as its first item, a Liberty Gold release
whose `summary` is the **full ~500-character press release body** — dateline,
amounts, project names, dates. Substantive by a wide margin. The six items sampled
in round 28 were French-language Eramet datelines and Kalkine headline-stubs, which
is what happened to be at the top of the feed at that moment.

The thin filter is still correct as a *filter* — those Kalkine stubs should not be
indexed — but the conclusion that `/news` would be empty was wrong, and it
reordered the work: the news index is populated and worth getting right. The
zero-total guards from 3.23 stay as guards rather than as expected states.

Incidentally confirmed by the same response: `summary` and `description` are the
same text for these rows, so `hasSubstantiveSummary()`'s `summary || description`
fallback is the right check. And the Eramet misattribution from section 3.21 is
visible again — the same Eramet release attributed to **Golden Cross Resources
Inc.** (ticker AUX) in French and **Fortune Bay Corp.** (ticker FOR) in English.

**Fixed: the news index rows were showing less than the SPA's.** `News.tsx` renders
ticker, company, title and summary per row; the crawler list showed the title and a
date. `listNewsSitemapRows()` now selects the ticker and the joined company name,
and each row reads `Title — ticker · company · date`. The company join was already
present via `PUBLIC_NEWS_FROM`, so this cost one line of SQL.

**Not replicated, deliberately.** `News.tsx` also shows a *significance* label
derived by `newsSignificanceLabel(item.sentiment, item.title)` and
`getNewsSeverity`. Those are client-side UI classifications computed from
sentiment and the headline text, not stored facts, and reproducing a heuristic
label server-side would risk stating a judgement the product only renders in one
view. The underlying facts — sentiment is not displayed, the headline is — are
unchanged.

**Corrected: the market-news rows were not missing anything.** Round 49 recorded a
suspected gap — that `MarketNews.tsx` renders a `commodity` tag the crawler rows
might omit. Checked, and the suspicion was wrong: `listMarketNews()` already
selects `n.commodity` and the renderer already emits `[source, commodity, date]`.
Those rows carry **more** than the SPA's, since they add a date and an
"about &lt;company&gt;" link, both from columns the query already reads.

One real defect was there, though, and the check found it: an item with no usable
link rendered `href="#"` — a self-referential link handed to a crawler. The SPA
renders no anchor in that case, and neither does the crawler now. The link is also
required to be absolute `http(s)`, matching the check already used for
`filings.source_url`.

Worth stating plainly: this round produced one small fix and one correction of my
own prior note. Round 49's "may omit the commodity tag" was a guess recorded as if
it were a finding, and reading the two functions took less effort than the note
did.

### 3.41 `seo:check` now validates the nginx config instead of only its contents

Everything in this document depends on one artifact that nothing checked:
`frontend/nginx.conf`. A syntax error there stops the frontend container from
starting — a **total outage**, not a degraded SEO feature — and `nginx -t` cannot be
run from these scripts.

`npm run seo:check` now adds four checks:

- **Brace balance**, with comments stripped first. This catches the whole class of
  mistake that actually matters: a missing or extra closing brace in a `map`, an
  `if` block, or any `location`. A brace in a comment cannot unbalance the count,
  and the `{8,128}` quantifier in the IndexNow location contributes one open and one
  close so it cancels rather than masking an imbalance.
- **Both envsubst variables templated** in `nginx.conf`.
- **Both set in the Dockerfile**, since envsubst only substitutes variables present
  in the container environment — an unset one leaves the map malformed and nginx
  refuses to start.
- **No `#` on a continued Dockerfile line**, which ends the logical line early and
  silently drops every variable after it. That was a real defect once.

**Verified by execution** against five fixtures plus two quantifier cases: a
production-shaped config balances; a missing close reports `missing 1`; an extra
close reports the negative case; braces inside comments are ignored; removing an
`if` block's close is still caught; and `{8,128}` cancels without hiding a genuine
imbalance.

The limitation is stated rather than hidden: this is not a parser. It cannot
validate directive names or arguments. It checks the one property whose failure is
fatal and silent.

### 3.42 Two guards for the wiring, and two defects found in the guards themselves

`routes/seo.js` is mounted at `Server/index.js:65` and the IndexNow scheduler is
registered in `lib/schedulers/index.js` — both verified present. `seo:check` now
asserts them, because these are the two failures that would make everything else
moot: a file full of correct routes that nothing mounts answers 404 on every
crawler path, and an unregistered scheduler never sends a freshness ping.

**Executing the new check found two defects in it**, which is the argument for
executing checks at all:

1. **A commented-out mount still passed.** The regex matched inside `// app.use(…)`,
   so the guard would have gone green while the wiring was gone — failing in the
   dangerous direction. Line comments are now stripped before matching.
2. **Ordinary reformatting failed it.** `app.use( require( './routes/seo' ) )` did
   not match, so the first person to add spacing would get a red check on working
   code, and a check that cries wolf gets ignored.

Both fixed and re-verified across 11 fixtures: both quote styles, internal spacing,
a newline before `require`, a trailing comment on the mount line, indented and
unindented comment-outs, a different route mounted, `require`d but never mounted,
and a mount among many other routes.

One case deliberately does **not** match: `app.use('/seo', require('./routes/seo'))`.
Mounting under a prefix would move every route to `/seo/company/…`, none of which
the nginx proxy covers, so the check failing there is correct rather than a false
positive.

### 3.43 The robots.txt Disallow rules bound only `*`, so Googlebot could crawl `/seo/`

Both copies of `robots.txt` — the static `frontend/public/robots.txt` that nginx
serves on www, and `sitemaps.robotsTxt()` — gave every named crawler its **own**
group:

```
User-agent: Googlebot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /seo/
```

**robots.txt rules are not merged across groups.** For any crawler exactly one
group applies — the most specific match — and agent-specific groups are never
combined with `*`. Google's spec says it directly: *"only one group is valid for a
given crawler… other groups are ignored"* ([Google, robots.txt
spec](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec);
[RFC 9309 §2.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.1-2.4)).

So every Disallow bound only `*`. Googlebot, Bingbot, GPTBot and the other 22 named
agents were free to crawl `/admin`, `/api/`, `/watchlist` and — the one that matters
most — **`/seo/`**, the internal QA renderer that serves the same content as
`/company/<slug>` *without* the canonical redirect. Its own comment says it "must
never be indexed as a duplicate". On a domain with no authority being crawled for
the first time, that is ~2,400 duplicate company pages handed to the crawler.

**Verified by execution** with a minimal evaluator implementing the documented
semantics:

| path | old, Googlebot | old, GPTBot | old, `*` | new, all three |
|---|---|---|---|---|
| `/company/carson-river-ventures-corp` | allow | allow | allow | **allow** |
| `/seo/company/…` | **allow** | **allow** | block | **block** |
| `/api/companies` | **allow** | **allow** | block | **block** |
| `/admin` | **allow** | **allow** | block | **block** |

**Fix.** Repeating the `user-agent` line is how robots.txt applies one set of rules
to many agents, and the spec confirms it. Every crawler is now a consecutive
`user-agent` line in a **single** group, so the Disallows bind all of them. The list
is deliberately unbroken — no comments or blank lines between the `user-agent`
lines — because separator handling inside a group is the one place parsers have
historically disagreed, and the per-agent explanations moved into the comment block
above.

The static copy also gained the tracking-parameter Disallows
(`utm_`, `fbclid`, `gclid`) that only the templated copy had, so the two now carry
the same policy.

**This is the most serious defect found in the whole exercise.** Every other
finding affected one page type, one field or one label. This one silently told
Google, Bing and every AI crawler that they were welcome to crawl the duplicate
renderer across the entire site, and it would have been invisible — the file looked
correct, used the conventional shape, and the `*` group read as a sensible default
rather than as the only group the rules applied to.

### 3.44 The guard for 3.43, and the two ways my first version of it was wrong

`seo:check` now parses both copies of `robots.txt` and asserts the intended policy
holds **for a named crawler**, not just for `*`: `/seo/`, `/api/` and `/admin` must
be blocked for every named agent, and `/` and company pages must stay crawlable.

Writing it, then executing it against five regression shapes, found two errors —
both mine, neither in the file:

1. **It only probed agents by name.** Calling the check with `Googlebot`, `GPTBot`
   and three others left a hole: appending a *new* named group would exempt that
   crawler and the guard would still pass. It now enumerates every named agent in
   the file, so a future addition is covered without anyone remembering to add it
   to a list.
2. **It did not merge groups naming the same agent.** RFC 9309 section 2.2.1
   requires it — *"if more than one group matches, the matching groups' rules MUST
   be combined"* — and Google's spec agrees. My evaluator picked the single
   longest-matching group, which would have reported a defect where an agent split
   into a second group is in fact harmless, because its rules combine with the
   group already carrying the Disallows. A guard that flags non-defects is the
   failure mode I warned about in section 3.31.

Final state, six shapes, all correct:

| shape | verdict |
|---|---|
| the fixed single group | passes |
| the original defect (per-agent `Allow: /` groups) | fails |
| a brand new named group appended | fails |
| `Googlebot` split into a second group (merges, harmless) | passes |
| the `/seo/` Disallow deleted | fails |
| the `/api/` Disallow deleted | fails |

**Two rounds, and the same lesson twice**: the thing most likely to be wrong in a
verification is the verification. Round 53's defect was invisible until a checker
executed it; round 54's checker was itself wrong twice before it was trustworthy.

### 3.45 The SPA shell declared the homepage canonical for every route

`frontend/index.html` carried:

```html
<link rel="canonical" href="https://www.orewire.com/" />
```

nginx serves that one file through `try_files … /index.html` for **every
non-proxied path** — `/`, `/insider/<slug>`, `/login`, `/watchlist`, `/profile`, and
anything unrecognised. So every one of those routes declared the **homepage** as its
canonical.

Two consequences, and the second is the one that matters:

- A crawler that runs JavaScript and reaches a route with `useSeo` wired gets the
  canonical rewritten, so the seven wired pages were fine.
- **A crawler that does not run JavaScript** — the AI crawlers this work is partly
  for — takes the shell at face value. `/insider/jeff-cocks` told it "this is a
  duplicate of `/`", and the page would be dropped rather than indexed.

Routes with no `useSeo` (the insider pages, among others) could never rank as
themselves, because they all pointed at the one page.

**Fix.** The canonical is removed. Per-route canonicals come from `useSeo()` where
they are wired; where none is set, the absence of a canonical is the correct
answer, because the page self-canonicalises. This file cannot know which route is
being served, so it is the wrong place to declare one.

**The check enforced the defect.** `seo:check` asserted *"static shell canonical is
absolute"* — a green check that guaranteed the bug stayed. It now asserts the
opposite: the shell must declare no canonical, with the reason inline.

**Third instance of one pattern.** The shell canonical (round 3), the sitemap
position comment (round 22), and the robots.txt groups (round 53) were all written
from the right instinct — "declare a canonical", "keep the index tidy", "allow the
AI crawlers" — and all three were wrong in the same way: **the rule was correct, the
scope it applied to was not.** A canonical is right for a page and wrong for a
shell. A `Disallow` is right for a rule set and wrong for a group. Worth checking
for the same shape in anything else that is stated once and served many times.

### 3.46 Every person name on every company page links to a route that does not exist

Following the class named in 3.45 to its next instance found something worse than a
metadata problem.

`CompanyDetail.tsx` links names to `/insider/<slug>` in two places — each manager and
director, and each insider transaction. Checked:

- no `/insider` page component exists anywhere in `frontend/src`
- `routes.tsx` declares no `/insider` path
- `path="*"` renders `NotFound`

So **every one of those links lands on the 404 page.** That is several dead internal
links on each of ~2,400 company pages.

This vindicates the decision in 3.37 not to reproduce those links on the crawler
page. Had I copied the SPA faithfully there, I would have written thousands of dead
links into crawled HTML — the parity rule would have faithfully propagated a bug.

**Fixed: the 404 page now declares itself.** `NotFound.tsx` had no SEO handling at
all, so it inherited the shell's metadata — the homepage title, the homepage
description and `index, follow`. `useSeo` now sets `noindex, follow` with a real
title and description, and sets the canonical to the requested path so a canonical
from the previously visited route cannot linger.

That fixes the whole class, not just this instance: every unmatched route now
answers honestly instead of presenting as an indexable copy of the homepage.
`seo:check` gained an eighth entry for `pages/NotFound.tsx` and asserts both that it
calls `useSeo` and that it sets `noindex`.

**Still open, and it is a product decision rather than an SEO fix.** The links
themselves are still dead. Building a real `/insider/:slug` page — aggregating a
person's holdings and transactions across companies — is a feature, not a
correction, and the API has no person-level endpoint to build it from. Both
options are the user's to choose: build the page, or unwrap the `<Link>`s so names
render as plain text. I have not silently removed a link the product clearly intends
to have.

**Fourth instance of the 3.45 pattern, and the worst.** Stated once, served many
times: a canonical for a shell, a `Disallow` for a group, a title for a shell, and
now a link target for a route that was never built.

### 3.47 The route inventory: which pages still present as the homepage

Enumerating `routes.tsx` against the components that call `useSeo` completes the
sweep. Of 22 routes, eight set their own metadata. The rest fall into two groups.

**Private routes — no action needed.** `/watchlist`, `/profile`,
`/change-password`, `/login`, `/register` and `/auth/*` all inherit the homepage
metadata, and all six are disallowed in `robots.txt` (which, after 3.43, now binds
every crawler rather than only `*`). Inheriting a title there costs nothing.

**Public content routes — a real gap.** These render actual content and present the
homepage title and description:

| route | note |
|---|---|
| `/market/commodity/:slug` | commodity pages, the most on-topic for a mining audience |
| `/market/currency/:slug` | currency detail |
| `/market/index/:slug` | index detail |
| `/jobs` | public jobs board |
| `/contact`, `/terms`, `/privacy` | static pages |
| `/` | inherits the shell metadata, **which is correct** — the shell's title and description were written for the home page |

`seo:check` now reports each of these as a note: a durable inventory that appears on
every run without blocking a deploy. Recording rather than fixing, because adding
`useSeo` to seven components is real work in files I have not read, and a red check
would block the very deploy this work exists to enable.

**The home page is the interesting case.** It is the only route where inheriting the
shell's metadata is the right answer, and that is by construction: the shell was
written as the home page's metadata and then served everywhere. Which is the 3.45
pattern stated most plainly — the metadata was not wrong, its scope was.

### 3.48 Commodity pages now declare themselves, canonical slug included

Of the gap in 3.47, `/market/commodity/:slug` is the most on-topic for a mining
audience, so it was fixed first. `CommodityDetail.tsx` now calls `useSeo` with a
title and description built from `COMMODITY_META`, which exists for all fifteen
commodities and has a fallback for anything else, so no branch can produce
`undefined` in the metadata.

**The canonical is the part that needed care.** The route accepts legacy short
slugs — `SLVR`, `COPR`, `LITH`, `NICK`, `PLAT`, `PALL` — and the component already
redirects them. The canonical uses `canonicalCommoditySlug(rawSlug)`, so those
consolidate onto the canonical URL rather than competing with it. That is the same
treatment section 3.25 gave legacy company ticker URLs, and it is why I checked
`lib/commodity-slugs.ts` before writing the line instead of reaching for `rawSlug`:
a canonical pointing at a legacy slug would have been a fresh instance of the exact
class of bug this document has spent several rounds removing.

**Placement was checked too.** The component returns early with a `Navigate` for
legacy slugs, so a hook call above that return would change the hook count between
renders and break React. `useSeo` is placed before it, alongside the other hooks.

The remaining unwired public routes from 3.47 are unchanged and still reported as
notes: `/market/currency/:slug`, `/market/index/:slug`, `/jobs`, `/contact`,
`/terms`, `/privacy`.

### 3.49 `/terms` wired, and the one structural trap in doing so

`Terms.tsx` was an implicit-return arrow — `const Terms = () => (<SiteLayout>…)` —
so it had nowhere to put a hook. It is a block body now, with `useSeo` before the
`return`, and the JSX body left untouched so the diff is only the opening and the
two closing lines.

Worth recording because it is the shape to expect on the rest of the 3.47 list:
`Privacy.tsx` and `Contact.tsx` are almost certainly written the same way, and the
conversion is mechanical but must close with `);` **then** `};`. Dropping either
one would be a build failure, and the build is what deploys — with no ability to run
it from here, the file was re-read at both ends after editing rather than assumed
correct.

**Status of the 3.47 gap after this round:**

| route | state |
|---|---|
| `/market/commodity/:slug` | wired (3.48) |
| `/terms` | wired |
| `/privacy`, `/contact`, `/jobs` | still inheriting the shell metadata |
| `/market/currency/:slug`, `/market/index/:slug` | still inheriting |
| `/` | correct by inheritance |

**Judgement, stated plainly:** the remaining entries are low-value. Nobody searches
for a terms page, and `/market/currency/:slug` is tangential to a mining audience.
Completing the list would take three more conversions of the same mechanical shape
for almost no ranking benefit. It is recorded here and reported as notes on every
`seo:check` run, which is the right level of effort for it. The work with actual
leverage is deploying what exists and earning citations, neither of which is in this
repository.

### 3.51 `/contact` was the one unwired route the sitemap actually submits

Reading `staticEntries()` while considering the empty-hub filter turned up a pairing
worth more than the filter: line 89 of `sitemaps.js` emits

```js
urlEntry(absoluteUrl('/contact'), null, 'monthly', '0.3'),
```

and `/contact` was on the 3.47 list of routes with no `useSeo`. So OreWire was
**submitting a contact page to Google whose title and description were the home
page's** — the two findings meeting in one URL.

That promoted it from "low value" to worth fixing: `/terms` and `/privacy` are not
in the sitemap at all, so `/contact` was the only unwired route being actively
advertised.

**Fixed.** `Contact.tsx` was already a block body with hooks, so unlike `Terms.tsx`
it needed no structural conversion — `useSeo` went in after the existing `useState`
calls and before the `return`.

**3.47 status after this round:**

| route | state |
|---|---|
| `/market/commodity/:slug` | wired |
| `/terms`, `/contact` | wired |
| `/privacy`, `/jobs` | still inherit the shell metadata, **not in the sitemap** |
| `/market/currency/:slug`, `/market/index/:slug` | still inherit, not in the sitemap |
| `/` | correct by inheritance |

The remaining unwired routes are not advertised anywhere, which is why they stay on
the note list rather than being converted.

### 3.52 The news item page was the last unexamined page type, and it holds

Every other page type had been read against its SPA component — company (§3.36,
§3.37), filing (§3.39), the listings (§3.49), the hubs (§3.50). `NewsDetail.tsx` had
only ever been read for its *list* sibling. Checked now, field by field:

| `NewsDetail.tsx` renders | crawler news page |
|---|---|
| `<h1>{item.title}` | yes |
| full date, source tag | date · source in the meta line |
| `commodity` tag | yes, in the same meta line |
| `cleanSummary(item.summary) \|\| item.title` | yes |
| "Full release · Source: …" body | **yes** — see below |
| external link to the publisher | yes, `rel="nofollow noopener"`, matching the SPA |
| JSON-LD with title/source/link/company | yes, `ogType: 'article'` |

**The "Full release" section is not an extra field.** `renderNewsPage` splits
`summary || description` on blank lines and renders every paragraph, and §3.49
established that for these rows `summary` and `description` are the same text and
contain the whole press release. So both views publish the same full body; the
crawler just labels it differently.

**Not replicated, and consistently so:** `getNewsSeverity(item.sentiment, title)`
and `getNewsFilingType(title)`. These are the same class of client-side heuristic
label declined in §3.49 for the list rows — a judgement the product renders in one
view from sentiment plus headline text, not a stored fact.

**No defect found.** Stated plainly because it is the useful result: the last
unexamined page type checks out, and the full set — company, filing, news, market
news, and every listing and hub — is now verified against the component it renders,
rather than assumed to match because it was written from the same notes.

### 3.53 Auditing the new assertions for false failures

Rounds 51–57 added a dozen assertions to `seo:check`, and none of them can be run
here. That matters more than an untested feature does: **a false failure in any one
of them blocks the deploy**, and the deploy is the entire point of the exercise. A
check that fails on correct code is worse than no check.

So each new assertion was walked against the code it inspects:

| assertion | verdict |
|---|---|
| nginx brace balance | verified by execution across 5 fixtures, including the real `{8,128}` quantifier |
| `BACKEND_UPSTREAM` / `EXTRA_CRAWLER_UA_PATTERN` templated and set | both present in `nginx.conf` and in `Dockerfile` lines 37+ |
| no `#` on a continued Dockerfile line | the only continued lines are 14 and 37; neither contains `#`, and the comment block (22–36) is standalone and ends in prose. **Passes.** |
| `routes/seo.js` mounted | verified by execution across 11 fixtures; `index.js:65` matches |
| robots.txt group semantics | the parser and evaluator were verified across 6 shapes; both files parse as **one** group, so it passes |
| 8 SPA components call `useSeo` | all 8 present, `NotFound` included, and `NotFound` contains `noindex` |
| `listingRobots(page)` referenced ≥ 5 times | still 5 — the two ternaries added in §3.23 and §3.50 each keep the helper inside their expression |
| `literalIndexRobots === 3` | note-level, so it cannot block a deploy even if the count shifts |

**No false failures found.** Every one of the additions passes on the current code,
which means the next `npm run seo:check` should report clean and the deploy should
not be blocked by my own tooling.

Worth recording because it is the one class of defect this document has produced
twice already — §3.31's regex that flagged a bug that did not exist, and §3.44's
guard that missed a real one. Both were found by running the check; this time the
same risks were walked by reading, which is weaker evidence, and is stated as such.

### 3.54 Deployment state re-verified, with one detail worth acting on

The blocker claim has been repeated in prose for many rounds; it was re-measured
rather than assumed.

**`GET https://backend.orewire.com/seo/status` → `404`, `Cannot GET /seo/status`.**
The renderer is not deployed. Unchanged since it was first checked.

**`GET https://www.orewire.com/robots.txt` → the original minimal file:**

```
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Twitterbot
Allow: /

User-agent: facebookexternalhit
Allow: /

User-agent: *
Allow: /
```

This is **not** the file in `frontend/public/robots.txt` — it predates even the
102-line version that had the §3.43 group defect. Three things follow:

1. Nothing from this work is live. Confirmed a second way: the frontend is serving a
   robots.txt that the repository replaced several rounds ago.
2. **The live file has no `Sitemap:` directive.** So Google will not discover the
   sitemap through robots.txt — it has to be submitted in Search Console and Bing
   Webmaster Tools. Step 5 of `docs/deploy-seo.md` already covers this, and this
   makes it load-bearing rather than optional.
3. The live file leaves **every** path crawlable, including `/admin`, `/api/`,
   `/watchlist` and `/login`, since not even the `*` group has a Disallow. The
   §3.43 fix is therefore not a correction to something live and broken in a subtle
   way — the live state is worse than the version I corrected, and the deployed fix
   will be a strict improvement on both counts.

Recorded because "not deployed" is the single fact that determines whether any of
this matters, and it is cheap to re-check. It was worth re-checking: repeating a
stale claim for ten rounds would have been exactly the assumption error this
document keeps cataloguing.

### 3.55 The deploy check's own endpoint contradicted the sitemap it describes

`/seo/status` is the first thing anyone checks after a deploy, so `docs/deploy-seo.md`
step 2 leans on it. Read while confirming that step is accurate — it is: the route
is public, needs no auth, and returns `site_origin`, `canonical_host` and
`request_host`, which is exactly what you need to confirm the `X-Forwarded-Host`
wiring survived the proxy.

One thing in it was wrong. Its sitemap counts used `Math.max(1, Math.ceil(...))`,
so a zero count still reported **1**, while `sitemapChildren()` omits a child sitemap
entirely when its count is zero (§3.23). The diagnostic endpoint therefore described
an index that does not exist — on the one screen a person looks at when something is
already suspected to be wrong.

Fixed to plain `Math.ceil`. The remaining `Math.max(1, ...)` calls in that file are
pagination (`page` and `totalPages`), where a floor of one is correct and genuinely
different; those are untouched.

Small, and recorded for the same reason as §3.53: this is a **verification artifact**,
and an artifact that lies is worse than no artifact, because it is trusted.

### 3.56 `llms.txt` verified — the last unread artifact, and it holds

Read end to end for the first time. Every link resolves to a route that exists:
`/companies`, `/sitemap.xml`, `/filings`, `/news`, `/market-news`, and
`/company/<slug>` built through `companyUrl()`, so all absolute. The
`listRecentCompanies(50)` fix from §3.33 is in place, so the "Most recently added or
updated" heading matches its contents rather than listing the fifty oldest rows.

It also does the one thing that file is for: *"All content is public and may be
quoted or cited. Please attribute OreWire and link to the specific company or filing
page."* An explicit, machine-readable invitation to cite, with the attribution
instruction attached — which is what AEO actually asks for and which almost nobody
writes down.

**No defect.** Second consecutive round ending that way, which is the expected shape
now: the artifacts have been read, and the remaining list is work rather than
oversight.

### 3.50 One commodity hub is empty, and the sitemap submits it anyway

`staticEntries()` lists every value of `COMMODITY_KEYS`, `CONTINENT_KEYS` and the
exchange set **unconditionally** — no count check. Section 3.23 added an empty-set
guard for the news index after the thin-content filter made an empty `/news`
reachable, but never applied the same reasoning to the hubs.

Checked against production:

| hub | live total |
|---|---|
| `?commodity=Cobalt` | **0** |
| `?commodity=Zinc` | 89 |
| `?continent=Africa` | 86 |
| `?commodity=Gold` | 686 |
| `?commodity=Rare Earths` | 35 |
| `?continent=North America` | 701 |
| `?exchange=TSXV` | 937 |

So `/companies?commodity=Cobalt` is a page listing nothing, advertised in the
sitemap and — because the guard was never applied to hubs — served with
`index, follow`. An empty page submitted to Google as indexable is a soft 404 by
another name.

**Fixed: the empty-hub guard.** `renderCompaniesIndexPage` now sets
`noindex, follow` when `total === 0`, mirroring the news index. Verified present at
both call sites.

**Recorded, not fixed: the sitemap still advertises empty hubs.** Removing them
means filtering `staticEntries()` by count, which requires:

- `commodityCounts()` — already exists
- `hubExchangeCounts()` — already exists
- a continent count — **does not exist**, and `CONTINENT_KEYS` values are raw-data
  column names rather than simple filters, so it is not a one-liner
- `staticEntries()` becoming async, and its caller `childSitemap()` updated

That is four changes across two files for an entry that is now noindexed, so Google
will simply not index it. The guard removes the harm; the filtering removes the
noise. Recorded here rather than attempted with the context available.

**Only four of the sixteen hub values had ever been verified before this round.**
Gold, Rare Earths, North America and TSXV were checked in §3.42; the other twelve
were assumed non-empty because the four sampled were. That assumption was wrong for
at least one of them, which is the same error as the six-item news sample in §3.49 —
a small sample treated as a population. The difference is that this time it was
caught by checking the rest, rather than by a later round noticing.

**All sixteen are now verified.** `GET /api/companies?<filter>&limit=1&page=9999`
returns an empty `data` array but the real `total`, so the whole set cost sixteen
tiny responses rather than sixteen full company rows:

| commodity | n | continent | n | exchange | n |
|---|---|---|---|---|---|
| Gold | 686 | North America | 701 | TSXV | 937 |
| Copper | 378 | South America | 283 | ASX | 810 |
| Silver | 230 | Africa | 86 | CSE | 448 |
| Lithium | 108 | Europe | 65 | TSX | 199 |
| Nickel | 93 | Australia | 40 | | |
| Zinc | 89 | Asia | 34 | | |
| Uranium | 54 | | | | |
| Rare Earths | 35 | | | | |
| **Cobalt** | **0** | | | | |

**Exactly one hub is empty.** So the sitemap advertises exactly one dead entry, and
the guard added above makes it non-indexable rather than a submitted soft 404.

**The filtering fix is smaller than it looked, and still not attempted here.** It
needs no new count function: `countCompaniesForHub({ [kind]: value })` already
handles commodity, exchange and continent filters through the same `hubFilter`, so
one uniform count per hub would do. What it does need is `staticEntries()` becoming
async — and that function is built from array literals and `.map()` calls, so it
becomes a push-based build, about forty lines of restructuring in the sitemap
generator. Getting that wrong breaks the file that Google fetches.

Recorded rather than risked: the guard has already removed the harm (a noindexed
URL is not indexed), and the only thing left is one line of noise in a sitemap.
Forty lines of async restructuring to remove one line of noise, with no way to run
the result, is not a good trade.

---

## 4. Deployment steps required

These are configuration, not code, and must be done in Dokploy and Cloudflare.

**Both services need redeploying, not just one.** Section 0 records the evidence
that production currently runs the pre-change image on both the frontend and the
backend. Deploying only the frontend would proxy crawler requests to a backend
that has no `/company`, `/sitemap.xml` or `/llms.txt` route, which is worse than
doing nothing — every crawler request on those paths would 404.

0. **Run `cd Server && npm run seo:check` before deploying.** It needs no database
   and no network, loads every SEO module (so a syntax or require error that would
   stop the backend from booting fails here instead of in production), and
   cross-checks the nginx proxy paths against the routes that exist.
1. **Set `BACKEND_UPSTREAM` on the frontend service** to the backend that
   renders crawler HTML. Default is `http://backend.orewire.com`; a private
   service URL is faster. Without this the crawler routes and `/sitemap.xml`
   fail. Note this is a **runtime** variable read by nginx at container start,
   unlike every `VITE_*` value in the same service, which is baked in at build
   time — so it needs a restart, not a rebuild. All four SEO variables are
   documented in `.env.docker.example`, `Server/.env.example` and
   `frontend/.env.example`.
2. **Verify the redirect chain and the rendered pages** once deployed:
   - `https://www.orewire.com/robots.txt`
   - `https://www.orewire.com/sitemap.xml`
   - `https://www.orewire.com/llms.txt`
   - `https://www.orewire.com/seo/status`
   - `curl -A "Googlebot" https://www.orewire.com/company/TSXV-CRV` should return
     a 301 to the name URL, then full HTML.
   - Then run **`npm run seo:audit`** from `Server/`. It walks the live sitemap as
     Googlebot and fails on any URL that 404s *or* returns the SPA shell. This is
     the only check that exercises the User-Agent split end to end, and it is what
     would have caught `/news` and `/filings` returning 404 to crawlers.
3. **Submit the sitemap** in Google Search Console and Bing Webmaster Tools, and
   request indexing for a handful of high value company profiles. Do this *after*
   the audit passes, so the first URLs Google tries are not error pages.
4. **Confirm Cloudflare is not caching the crawler responses wrongly** and that
   the `X-Robots-Tag` guard behaves on the real hostnames.
5. **Set `SITE_ORIGIN`** on the backend if the canonical host ever differs from
   `https://www.orewire.com`.
6. **Optionally set `INDEXNOW_KEY`** (8-128 characters of `a-z A-Z 0-9 -`) on the
   backend service to enable IndexNow. After deploying, confirm
   `https://www.orewire.com/<key>.txt` returns the key, then run
   `npm run seo:indexnow`. Google does not use IndexNow; the win here is Bing and
   therefore Copilot.
7. **Verify the hubs render and are linked**: `https://www.orewire.com/companies?commodity=Gold`
   and `/companies?exchange=TSXV` should both list filtered companies, and a
   company profile should link up to both.
8. **Check Cloudflare is not defeating the proxy.** Two settings can break this
   silently:
   - *Bot protection / Bot Fight Mode / a WAF rule* challenging AI crawlers. A
     challenge page is still a 200 for some crawlers, so allowlist the agents
     listed in `robots.txt` (at minimum `GPTBot`, `OAI-SearchBot`,
     `PerplexityBot`, `ClaudeBot`, `Google-Extended`) and confirm with
     `curl -A "GPTBot" https://www.orewire.com/company/TSXV-CRV` that real HTML
     comes back rather than a challenge.
   - *A "Cache Everything" cache rule.* With one in place, confirm the crawler
     request still returns rendered HTML and not the SPA shell. Section 3.8
     explains why the headers alone are not enough if such a rule exists.

---

## 5. Remaining work, ordered by expected impact

1. **Replace dynamic rendering with real server rendering** for the company
   profile, or prerender it at build/revalidate time. Dynamic rendering is a
   documented workaround and Google's guidance treats it as temporary.
2. **Extend entity signals beyond ASX.** Only the company website and the ASX
   announcements page could be derived from URL shapes this codebase already
   proves. TSX, TSXV and CSE listing pages, and a SEDAR+ profile URL, each need a
   verified pattern before being added. Creating a Wikidata item for OreWire
   itself, and linking it with `sameAs`, is the strongest remaining entity move.
3. **Off-page authority, which is what actually wins a company-name query.**
   On-page work makes ranking *possible*; it does not make it *happen*. On a
   company-name query the company's own site, the exchange and SEDAR are strong
   incumbents, so OreWire needs citations from mining communities, forums,
   newsletters and industry directories. The concrete material for that work —
   the exact wording to repeat, the citable facts with the URL to cite for each,
   who to approach and what to avoid — is in
   [`docs/seo-outreach-kit.md`](./seo-outreach-kit.md). It is not a coding task
   and no further code will substitute for it.
4. **Country hubs, and event-driven pings.** Commodity, exchange and continent
   hubs exist; per-country hubs do not. IndexNow submission is now scheduled
   daily, but it is *time* based: pinging from the jobs that actually write a
   filing or a news item would announce a new page within minutes instead of
   within a day.
5. **First-party OG image.** `og:image` currently points at a leftover Lovable
   preview render on a third party bucket. Replace with
   `https://www.orewire.com/og-image.png` (1200x630).
6. **Add a `slug` column** to `companies`, backfilled and indexed, to replace the
   current `regexp_replace` name lookup with an indexed equality match.
7. **Measure.** Track indexing coverage and impressions in Search Console, and
   track AI citations by periodically querying the answer engines for a fixed set
   of company names.

---

## 6. Verification notes

The sandbox shell in this session is non-functional. Every `pwsh` invocation
fails with exit code `3221225794` (`0xC0000142`, `STATUS_DLL_INIT_FAILED`), so
`npm run build`, the vitest suite, `node --check` and even `node --version` could
not be run. A probe from a **separate subagent process** reproduced the identical
failure, so this is an environment limitation rather than accumulated session
state, and it is not something to keep retrying.

Every new file was therefore reviewed by hand, and the following consistency
checks were performed by reading the code rather than executing it:

- **Slug parity.** `slugify()` (JS) and `slugSql()` (SQL) were compared rule by
  rule. Both lowercase and collapse `[^a-z0-9]+` to a single dash, then trim
  dashes. Neither folds accents, so `ó` becomes `-` on both sides and the two
  stay in agreement.
- **Resolver coverage.** Every URL shape the site emits was traced to a resolver:
  numeric id, `EXCHANGE-TICKER`, bare ticker and name slug all resolve in both
  `Server/lib/seo/data.js` and `Server/routes/api/companies.js`. For news:
  `<title-slug>-<id>`, title slug, exact title, and legacy external link all
  resolve in `Server/lib/seo/data.js` and `Server/routes/api/news.js`.
- **No stale call sites.** A repository wide search for the old
  `encodeURIComponent(link || title)` news slug pattern returns only the two
  intentional fallbacks and one deliberately-documented dead component.
  `CompanyDetail.tsx`, `News.tsx`, `NewsReleases.tsx`, `NewsDetail.tsx`,
  `news-severity.ts` and the watchlist alert emails all emit the canonical form.
- **Hub param parity.** The crawler emits `/companies?exchange=TSXV`; the SPA
  canonical builder produces the identical string, and the SPA filter accepts
  both `exchange` and `market` with `TSXV` / `TSX-V` normalised, so a hub link
  filters correctly for users as well as for crawlers.
- **nginx location precedence.** `/robots.txt` deliberately does *not* match the
  new IndexNow regex (the regex demands 8-128 characters and `robots` is 6), so
  it keeps being served statically as intended. The regex is quoted because it
  contains a `}` quantifier, which nginx would otherwise read as a block end.
- **IndexNow gating agrees in two places.** The key is validated against
  `/^[a-zA-Z0-9-]{8,128}$/` in `indexnow.js`, and the nginx regex uses the same
  constraint, so Express and nginx cannot disagree about which path is the key
  file.
- **The backend import graph was traced and is acyclic.** The new SEO modules
  depend only downward: `util` has no dependencies; `schema` needs `util`;
  `data` needs `db`, `util` and `company-enrich`; `pages` and `sitemaps` need
  `util` plus `data`; `indexnow` needs `util`. Nothing under `lib/seo/` is
  imported back by a module it depends on.
- **The crawled insider rows match the SPA's public view exactly.** The caps (top
  five holders, three most recent transactions) were read out of
  `routes/api/companies.js` rather than chosen, so the crawled page shows an
  anonymous visitor nothing they could not already see. Anything beyond that is
  behind registration.
- **Both new sections were confirmed to be public, not paywalled.** `CompanySnapshotCard`
  is rendered unconditionally in `CompanyDetail.tsx` and contains no auth check,
  and the insider table renders for anonymous visitors with a "register to see
  more" prompt (`!registered && moreTx > 0`). Had either been login-gated,
  putting it in the crawled HTML would have been a paywall leak and a divergence
  from the user view, so this was checked before shipping rather than assumed.
- **The two company resolvers now agree on archived rows.** The public API's
  name-slug fallback was missing the `archived_at IS NULL` filter that
  `lib/seo/data.js` has, so an archived company could shadow a live one sharing
  the same name slug. Aligned.
- **The snapshot path cannot generate.** `getCachedCompanySnapshot()` calls
  `getCachedSnapshotView()`, which only selects; it was renamed from
  `getCompanySnapshot` specifically because the old name invited the assumption
  that it might trigger a generation. A missing snapshot omits the section.
- **Every nginx-proxied path was checked against a backend route.** The proxy
  regex matches `/company`, `/companies`, `/news` and `/filings` including the
  bare prefixes. Traced one by one, `/news` and `/filings` had no renderer route
  at all, so both 404'd for crawlers while sitting in the sitemap. The proxied set
  and the handled set are now the same: `/company/:slug`, `/companies`, `/news`,
  `/news/:slug`, `/filings`, `/filings/:id`. The only unmatched shape left is
  `/company/` with an empty slug, which is not linked or listed anywhere.
- **The filings predicate was subtly wrong, and the fix was one word.** The SEO
  query filtered `c.id IS NULL OR c.archived_at IS NULL`, but the public filings
  API filters `f.company_id IS NULL OR c.archived_at IS NULL`. These differ for a
  filing whose `company_id` no longer joins to a company: `c.id IS NULL` is true
  so the row was **included**, whereas the API's first test is false and
  `c.archived_at IS NULL` is NULL, so the API **excludes** it. The crawler page
  was listing filings no visitor could reach. The predicate is now a shared
  constant, `PUBLIC_FILING_WHERE`, and the same test was added to
  `getFilingById()` so an unlisted filing answers 404 instead of rendering an
  orphan page.
- **The deployment state was verified against the live site, not inferred.**
  `www.orewire.com/robots.txt` returns the original pre-change file,
  `www.orewire.com/sitemap.xml` and `/llms.txt` both return the SPA's
  `index.html`, and `backend.orewire.com/seo/status` returns an Express 404. That
  is four independent confirmations that neither service is running this code.
  Every check in this document before that point had been inspecting source.
- **Every SPA content route was checked for a `useSeo` call.** A grep for
  `useSeo` across `frontend/src` is the check: it must return the seven content
  components listed in section 3.17. Before this round it returned two, so five
  sitemap-listed routes were inheriting the homepage canonical from the static
  shell. This is the same class of gap as the crawler-side omissions, just in the
  opposite direction.
- **The Organization node now exists in three places that must be kept in step**:
  `Server/lib/seo/schema.js` (crawler HTML), `frontend/src/lib/seo.ts` (SPA head)
  and the static block in `frontend/index.html` (non-JS crawlers). The `email` and
  `contactPoint` values were applied to all three, and `seo.ts` carries a comment
  pointing at the backend as the reference. This is a genuine drift risk and is
  the reason the values are simple literals rather than anything derived.
- **The filing page was diffed field by field against `FilingDetail.tsx`.** That
  is where the three missing sections were found, and it is now the method for
  checking either direction of the divergence: read the SPA component, list what
  it renders, compare against the crawler renderer. Reading each side in
  isolation had missed this for sixteen rounds.
- **The share price was verified against its source before being rendered.** The
  columns come from `migrate.js`, are written by `saveQuote()` in
  `company-quote-refresh.js`, and that scheduler runs every 30 minutes over every
  ticker on `SUPPORTED_EXCHANGES` — which is exactly `['TSXV', 'TSX', 'CSE',
  'ASX']`, the same set the hubs use. `findCompany()` selects `*`, so the values
  were already on the row and no new query was needed.
- **The listing `robots` directive is driven by one helper in two places.** The
  four paginated renderers all call `listingRobots(page)`, and `Companies.tsx`
  applies the same `page > 1` test, so the crawler and SPA views cannot end up
  disagreeing about whether a given URL should be indexed. Grepping `robots:` in
  `pages.js` confirms the four listings use the helper while the company, news,
  filing and content pages keep a fixed `index, follow`.
- **A Dockerfile syntax error was caught by re-reading the instruction.** The
  new `ENV` was first written with explanatory `#` lines in the middle of the
  `\` continuation. Dockerfile continuations do not permit comments inline, so
  that would have failed the image build — and it is the sort of thing that looks
  fine in a diff. The comments were moved above the instruction. This is the
  third defect in this work that only a careful re-read would have caught, which
  is a fair summary of what the dead shell costs.
- **A collapsed-line sweep found a third instance.** Two edits had joined a
  function signature and its first statement onto one line. Syntactically valid
  JavaScript, so nothing would have failed, but it is a signal that a region
  deserved re-reading. A repository-wide grep for `) {` followed by code on the
  same line found the third case in `schema.js`. With no working syntax checker,
  mechanical checks like this are the available substitute.
- **`llms.txt` was labelling its list dishonestly.** The section headed "Most
  recently added or updated" was filled from the sitemap query, which is ordered
  by `id` for stable pagination, so it listed the fifty *oldest* companies. It
  now uses a dedicated `listRecentCompanies()` ordered by
  `COALESCE(updated_at, created_at) DESC`. A stale list is harmless; a list that
  claims to be fresh and is not is the kind of thing that erodes trust in the
  file.
- **`robots.txt` no longer has two sources claiming to be the same document.**
  The canonical www copy is a static nginx file, deliberately, because
  robots.txt must not be able to 502 — a persistent server error on it makes
  Google stop crawling the site entirely. The backend route therefore only ever
  answers for a non-canonical host, and now returns a `Disallow: /` document
  there, matching the `X-Robots-Tag: noindex` those pages already carry. The two
  files are now legitimately different rather than silently able to drift.
- **The hub FAQ had a misstatement bug, caught by re-reading it after adding
  continents.** The `else` branch is the site-wide answer, and a continent hub
  fell through to it, so `/companies?continent=Africa` would have published its
  regional count as the total number of companies OreWire tracks. Every hub type
  now has its own branch. This is the same failure mode the "counts only" rule
  exists to prevent: a confidently wrong number in the content most likely to be
  quoted.
- **The published statistic cannot disagree with the hub listing.** Both the
  count and the list it describes go through `hubFilter()`, so they are the same
  predicate by construction. They were deliberately not written as two separate
  SQL expressions, which is how this kind of number silently drifts.
- **Aggregate failures are contained twice over.** `commodityCounts()` catches per
  commodity, so a malformed `raw_data` row costs one row of the table rather than
  the page, and the route catches each aggregate again, so the statistics stay
  strictly additive to the company list.
- **The SPA shell's no-cache header had to move.** It was first written on the
  content-route `location`, which looks correct but does nothing: `try_files …
  /index.html` performs an internal redirect, location matching re-runs, and the
  request is finally served by `location /`. The header now lives there. This was
  caught by walking the request lifecycle rather than by reading the directive in
  isolation.
- **The shell fix is wider than strictly necessary, deliberately.** Only the four
  content routes are User-Agent dependent; `/` and `/market-news` serve the same
  shell to everyone and were never at risk. But because the header has to live in
  `location /` (see above), every SPA route now revalidates. Narrowing it would
  need a separate named location for the shell fallback, and an untested nginx
  construct is a bad trade when an invalid config takes the whole frontend down.
- **Frontend build risk is lower than it looks, and so is its safety net.**
  `frontend` builds with `vite build`, which uses esbuild and never runs `tsc`,
  and `tsconfig.app.json` sets `strict: false`, `noUnusedLocals: false` and
  `strictNullChecks: false`. A type error therefore will not fail the build;
  only a real syntax error will. The flip side is that type errors can sit
  undetected, so `npx tsc --noEmit` is worth running once an environment allows
  it.

**The frontend build and the backend boot must still be run before deploying.**
The highest-risk file on boot is `Server/index.js`, because it now `require`s the
SEO router at startup; a bad path there stops the whole backend.
