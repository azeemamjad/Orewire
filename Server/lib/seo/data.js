'use strict';

/**
 * All database reads used by the SEO layer live here, so the route handlers stay
 * thin and the queries can be reasoned about (and indexed) in one place.
 *
 * Every query filters `archived_at IS NULL` for companies, because archived
 * companies return 404 on the public site and must never enter a sitemap.
 */

const db = require('../../db');
const { slugSql, hasSubstantiveSummarySql } = require('./util');
const { blockedMarketSourcesClause } = require('../news/blocked-sources');
const { listSymbols } = require('../market/instrument-symbols-store');
const {
  safeParse,
  deriveCommodities,
  deriveContinents,
  deriveCountry,
  COMMODITY_KEYS,
  CONTINENT_KEYS,
} = require('../company-enrich');

const NEWS_TABLE = 'news_releases';

/**
 * Add the same derived fields the public API exposes (commodities, continents,
 * country) so the crawler page and the SPA agree on what the company does.
 */
function enrichCompanyRow(row) {
  if (!row) return row;
  const raw = safeParse(row.raw_data);
  return {
    ...row,
    commodities: deriveCommodities(row, raw),
    continents: deriveContinents(raw),
    country: deriveCountry(raw),
  };
}

/** Normalise an exchange the same way routes/api/companies.js does. */
function normalizeExchange(ex) {
  if (!ex) return null;
  const upper = String(ex).toUpperCase();
  if (upper === 'TSX-V' || upper === 'TSXV') return 'TSXV';
  return upper;
}

/**
 * Resolve a legacy `EXCHANGE-TICKER` (or bare ticker) through `instrument_symbols`.
 *
 * A company's ticker can change: `instrument-symbols-store.js` updates
 * `companies.exchange` and `companies.ticker` in place. The symbols table keeps
 * every listing ever recorded, so this recovers a URL built from a ticker the
 * company no longer uses, and the route then 301s it to the current name-based
 * canonical. Without it, that old URL 404s and whatever equity it had is lost.
 *
 * This is the reason the URL scheme does not depend on the ticker: `companies.name`
 * is only ever inserted, never updated (verified across every writer), while
 * exchange and ticker are genuinely mutable.
 */
async function findCompanyBySymbol(ticker, exchange) {
  const tk = String(ticker || '').toUpperCase();
  if (!tk) return null;
  try {
    const res = await db.query(
      `SELECT c.* FROM instrument_symbols s
         JOIN companies c ON c.id = s.entity_id AND s.entity_type = 'company'
        WHERE c.archived_at IS NULL
          AND UPPER(s.ticker) = $1
          AND ($2::text IS NULL OR UPPER(s.exchange) = $2)
        ORDER BY s.is_default DESC, c.market_cap DESC NULLS LAST
        LIMIT 1`,
      [tk, exchange ? String(exchange).toUpperCase() : null]
    );
    return enrichCompanyRow(res.rows[0] || null);
  } catch (err) {
    // A missing symbols table must not break company resolution.
    console.error('[seo] symbol fallback failed:', err?.message || err);
    return null;
  }
}

/**
 * Resolve a company from a URL parameter. Accepts, in order:
 *   1. a numeric primary key                  -> /company/1234
 *   2. `EXCHANGE-TICKER`                      -> /company/TSXV-CRV
 *   3. that ticker as a past listing          -> /company/TSXV-OLDTICKER
 *   4. a bare ticker, current or past         -> /company/CRV
 *   5. a slugified company name               -> /company/carson-river-ventures-corp
 *
 * Returns the full row (including raw_data) or null. Archived rows are excluded.
 */
async function findCompany(param) {
  const raw = String(param || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const res = await db.query('SELECT * FROM companies WHERE id = $1 AND archived_at IS NULL', [raw]);
    return enrichCompanyRow(res.rows[0] || null);
  }

  const upper = raw.toUpperCase();

  // 2. EXCHANGE-TICKER. The exchange is everything before the first dash; tickers
  //    on TSX/TSXV/CSE/ASX never contain a dash themselves.
  const dashIdx = raw.indexOf('-');
  if (dashIdx > 0) {
    const exchange = normalizeExchange(raw.slice(0, dashIdx));
    const ticker = raw.slice(dashIdx + 1);
    const res = await db.query(
      `SELECT * FROM companies
        WHERE archived_at IS NULL AND exchange = $1 AND UPPER(ticker) = $2
        LIMIT 1`,
      [exchange, ticker.toUpperCase()]
    );
    if (res.rows[0]) return enrichCompanyRow(res.rows[0]);

    // 2b. The same shape, but the ticker may be one the company has since
    //     changed. instrument_symbols still holds it.
    const viaSymbol = await findCompanyBySymbol(ticker, exchange);
    if (viaSymbol) return viaSymbol;
  }

  // 3. Bare ticker.
  if (!raw.includes('-')) {
    const res = await db.query(
      'SELECT * FROM companies WHERE archived_at IS NULL AND UPPER(ticker) = $1 LIMIT 1',
      [upper]
    );
    if (res.rows[0]) return enrichCompanyRow(res.rows[0]);

    const viaSymbol = await findCompanyBySymbol(upper, null);
    if (viaSymbol) return viaSymbol;
  }

  // 4. Slugified name. Highest market cap wins if two listings share a name slug.
  const res = await db.query(
    `SELECT * FROM companies
      WHERE archived_at IS NULL AND ${slugSql('name')} = $1
      ORDER BY market_cap DESC NULLS LAST, id ASC
      LIMIT 1`,
    [raw.toLowerCase()]
  );
  return enrichCompanyRow(res.rows[0] || null);
}

/**
 * Filings that must never be published against a company.
 *
 * `company_mismatch` is set by the ingest when a document was filed under one
 * company while the analysis identified a *different* issuer in the document
 * itself (`raw_response.data_extracted.issuer_names_from_document`).
 *
 * Verified in production: filing 20594 is attributed to `company_id` 1415 with
 * `company_name` "Carson River Ventures Corp.", but its PDF is
 * `simplysolvent07312026-nr.pdf` and its summary describes Simply Solventless
 * Concentrates' management cease trade order. Rendered on Carson River's page,
 * that attaches another company's regulatory distress to a named public company.
 *
 * This filter is a mitigation, not the fix. The fix is upstream: attribute the
 * filing to the issuer the document names, or leave it unattributed. Until then
 * these filings stay out of everything public rather than being published
 * misattributed.
 */
const PUBLISHABLE_FILING_STATUS = `(f.status IS NULL OR f.status <> 'company_mismatch')`;

/**
 * Every listing a company has, not just its primary one.
 *
 * A junior miner is often listed in more than one place — a TSX-V listing plus a
 * US OTC one, for example — and a searcher may well use the other ticker. The SPA
 * shows all of them in its identifiers card, so the crawled page should too.
 *
 * Read from `instrument_symbols`, which is local, unlike ISIN and CUSIP: those
 * come from a live TradingView call (`fetchTvFundamentals`) and are deliberately
 * not fetched on the crawler path.
 */
async function getCompanySymbols(companyId) {
  if (!companyId) return [];
  try {
    return await listSymbols('company', { entityId: companyId });
  } catch (err) {
    console.error('[seo] company symbols failed:', err?.message || err);
    return [];
  }
}

/** Recent filings for a company, newest first. */
async function getCompanyFilings(company, limit = 15) {
  const res = await db.query(
    `SELECT f.id, f.filing_type, f.commodity, f.created_at, a.verdict, a.summary
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
      WHERE (f.company_id = $1
         OR TRIM(REPLACE(REPLACE(f.company_name, '.', ''), ',', '')) =
            TRIM(REPLACE(REPLACE($2, '.', ''), ',', '')))
        AND ${PUBLISHABLE_FILING_STATUS}
      ORDER BY f.created_at DESC
      LIMIT $3`,
    [company.id, company.name, limit]
  );
  return res.rows;
}

/** Recent news releases linked to a company, newest first. */
async function getCompanyNews(company, limit = 10) {
  const res = await db.query(
    `SELECT n.id, n.title, n.link, n.source, n.pub_date, n.description, n.summary,
            n.commodity, n.sentiment, n.category, n.ticker, n.company_id
       FROM ${NEWS_TABLE} n
      WHERE n.relevant = TRUE
        AND (n.company_id = $1 OR n.ticker = $2)
      ORDER BY n.pub_date DESC NULLS LAST, n.id DESC
      LIMIT $3`,
    [company.id, company.ticker, limit]
  );
  return res.rows;
}

async function getCompanyPeople(companyId, limit = 25) {
  const res = await db.query(
    `SELECT name, title, role_code, kind, since_year, age
       FROM company_people
      WHERE company_id = $1
      ORDER BY kind DESC, since_year ASC NULLS LAST, name ASC
      LIMIT $2`,
    [companyId, limit]
  );
  return res.rows;
}

/**
 * Cached AI company analysis, or null when none has been generated yet.
 *
 * Read only. The renderer runs on the crawler path, where triggering a model
 * call would be an unbounded latency and cost risk. Required lazily because
 * companies/snapshot.js pulls in the AI client at module load, and this layer
 * should not depend on that just to render a page.
 */
async function getCachedCompanySnapshot(companyId) {
  if (!companyId) return null;
  try {
    const { getCachedSnapshotView } = require('../company-snapshot');
    return await getCachedSnapshotView(companyId);
  } catch (err) {
    console.error('[seo] snapshot read failed:', err?.message || err);
    return null;
  }
}

/**
 * Insider ownership and recent transactions.
 *
 * Capped at exactly what an anonymous visitor sees in the SPA: the top five
 * holders and the three most recent transactions. The cap is load bearing, not
 * cosmetic. The rest sits behind registration, so publishing more here would
 * both undercut the paywall and make the crawled page differ from the page a
 * person gets, which is the one line dynamic rendering must not cross.
 */
async function getCompanyInsiders(companyId, { owners = 5, transactions = 3 } = {}) {
  if (!companyId) return { ownership: [], transactions: [] };

  const [ownership, tx] = await Promise.all([
    db.query(
      `SELECT insider_name, title, total_shares, percent_ownership, last_transaction, last_transaction_date
         FROM insider_ownership
        WHERE company_id = $1
        ORDER BY COALESCE(percent_ownership, 0) DESC, COALESCE(total_shares, 0) DESC
        LIMIT $2`,
      [companyId, owners]
    ),
    db.query(
      `SELECT insider_name, title, transaction_type, shares, price, transaction_date, total_holdings_after
         FROM insider_transactions
        WHERE company_id = $1
        ORDER BY transaction_date DESC NULLS LAST, id DESC
        LIMIT $2`,
      [companyId, transactions]
    ),
  ]);

  return { ownership: ownership.rows, transactions: tx.rows };
}

async function getNewsById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const res = await db.query(
    `SELECT n.*, c.name AS company_name, c.exchange AS company_exchange
       FROM ${NEWS_TABLE} n
       LEFT JOIN companies c ON c.id = n.company_id
      WHERE n.id = $1
      LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
}

/** Look a news item up by its external link, its exact title, or its title slug. */
async function getNewsByLinkOrTitle(value) {
  const needle = String(value || '').trim();
  if (!needle) return null;
  const res = await db.query(
    `SELECT n.*, c.name AS company_name, c.exchange AS company_exchange
       FROM ${NEWS_TABLE} n
       LEFT JOIN companies c ON c.id = n.company_id
      WHERE n.link = $1
         OR n.title = $1
         OR ${slugSql('n.title')} = $1
      ORDER BY n.pub_date DESC NULLS LAST
      LIMIT 1`,
    [needle]
  );
  return res.rows[0] || null;
}

/**
 * A single filing.
 *
 * Returns null when the filing is not publicly listed, so the SEO route answers
 * 404 rather than rendering an orphan page for a filing the public list excludes.
 * Same predicate as PUBLIC_FILING_WHERE, with `f` for filings and `c` for the
 * joined company.
 */
async function getFilingById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const res = await db.query(
    `SELECT f.*, a.summary, a.verdict, a.verdict_reason, a.key_facts, a.what_to_watch,
            a.resource_estimate, a.grade_commentary, a.context,
            c.name AS company_canonical_name, c.ticker AS company_ticker,
            c.exchange AS company_exchange, c.market_cap AS company_market_cap
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
       LEFT JOIN companies c ON c.id = f.company_id
      WHERE f.id = $1
        AND (f.company_id IS NULL OR c.archived_at IS NULL)
        AND ${PUBLISHABLE_FILING_STATUS}
      LIMIT 1`,
    [id]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Sitemap sources
// ---------------------------------------------------------------------------

async function countCompanies() {
  const res = await db.query('SELECT COUNT(*)::int AS c FROM companies WHERE archived_at IS NULL');
  return res.rows[0]?.c || 0;
}

/**
 * Company rows for a sitemap page. A company with recent filings or news is
 * "fresher" than its updated_at suggests, so we reuse updated_at and let the
 * nightly jobs touch it when they write.
 */
/**
 * Company rows for a sitemap page.
 *
 * `lastmod` is derived from the newest **filing** for the company, falling back
 * to when the profile row was created. It is deliberately not `updated_at`:
 * `saveQuote()` sets `updated_at = NOW()` on every 30-minute quote refresh, so
 * using it would tell Google that all 2,394 profiles changed half an hour ago, on
 * every fetch. Inaccurate `lastmod` is worse than none, because it teaches the
 * crawler to ignore the field entirely.
 */
async function listCompanySitemapRows(offset, limit) {
  const res = await db.query(
    `SELECT c.id, c.name, c.exchange, c.ticker, c.created_at,
            COALESCE(MAX(f.created_at), c.created_at) AS lastmod
       FROM companies c
       LEFT JOIN filings f ON f.company_id = c.id
      WHERE c.archived_at IS NULL AND c.name IS NOT NULL AND c.name <> ''
      GROUP BY c.id, c.name, c.exchange, c.ticker, c.created_at
      ORDER BY c.id ASC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

/**
 * Filings created at or after a cutoff, with the company each belongs to.
 *
 * Used by the IndexNow freshness ping. This keys on `filings.created_at` and
 * deliberately NOT on `companies.updated_at`.
 *
 * `saveQuote()` in lib/market/company-quote-refresh.js sets `updated_at = NOW()`
 * on every quote refresh, which runs **every 30 minutes**. So `updated_at` moves
 * for essentially every company twice an hour whether or not anything on its page
 * changed. A ping built on it degraded into a daily resubmission of the entire
 * catalogue — the exact thing the ping exists to avoid, since the point of
 * IndexNow is to say "this is new", not "this exists".
 */
async function listFilingsCreatedSince(sinceIso, limit = 5000) {
  const res = await db.query(
    `SELECT f.id, f.created_at, COALESCE(c.name, f.company_name) AS company_name
       FROM filings f
       LEFT JOIN companies c ON c.id = f.company_id
      WHERE f.created_at >= $1
        AND ${PUBLISHABLE_FILING_STATUS}
      ORDER BY f.created_at DESC
      LIMIT $2`,
    [sinceIso, limit]
  );
  return res.rows;
}

/**
 * News releases first seen at or after a cutoff.
 *
 * Restricted to rows with a substantive summary, because thin news pages are
 * `noindex` (section 3.20) and there is no point asking a crawler to fetch a page
 * that will not be indexed. The company is deliberately not joined in: news
 * attribution is unreliable (section 3.21), and a wrong company pinged is a
 * smaller error than a wrong company page kept fresh.
 */
async function listNewsCreatedSince(sinceIso, limit = 5000) {
  const res = await db.query(
    `SELECT n.id, n.title, n.link, n.pub_date, n.created_at
       FROM ${NEWS_TABLE} n
      WHERE n.created_at >= $1
        AND n.relevant = TRUE
        AND ${hasSubstantiveSummarySql('n')}
      ORDER BY n.created_at DESC
      LIMIT $2`,
    [sinceIso, limit]
  );
  return res.rows;
}

/**
 * The most recently updated companies, newest first.
 *
 * Distinct from listCompanySitemapRows(), which is ordered by id for stable
 * sitemap pagination. llms.txt used the sitemap query and labelled the result
 * "most recently added or updated", which was simply untrue: it listed the
 * fifty oldest rows.
 */
async function listRecentCompanies(limit = 50) {
  const res = await db.query(
    `SELECT id, name, exchange, ticker
       FROM companies
      WHERE archived_at IS NULL AND name IS NOT NULL AND name <> ''
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT $1`,
    [limit]
  );
  return res.rows;
}

/**
 * Public news, matching the filter the public feed itself uses.
 *
 * The archived-company exclusion is the same one `buildFeedFilters()` adds in
 * lib/news/db.js, and it was missing here. `news_releases` was the only listing
 * whose crawler surface included items for companies the site has hidden — and a
 * news page for an archived company links to a company URL that 404s, which is a
 * dead internal link handed to a crawler.
 */
const PUBLIC_NEWS_FROM = `FROM ${NEWS_TABLE} n
        LEFT JOIN companies c ON c.id = n.company_id`;

const PUBLIC_NEWS_WHERE = `WHERE n.relevant = TRUE
        AND (n.company_id IS NULL OR c.archived_at IS NULL)
        AND title IS NOT NULL AND title <> ''
        AND ${hasSubstantiveSummarySql('n')}`;

async function countNews() {
  // Must match listNewsSitemapRows() exactly, or the sitemap advertises pages
  // that contain nothing.
  const res = await db.query(
    `SELECT COUNT(*)::int AS c ${PUBLIC_NEWS_FROM} ${PUBLIC_NEWS_WHERE}`
  );
  return res.rows[0]?.c || 0;
}

async function listNewsSitemapRows(offset, limit) {
  const res = await db.query(
    `SELECT n.id, n.title, n.pub_date, n.created_at, n.ticker,
            c.name AS company_name
       ${PUBLIC_NEWS_FROM}
       ${PUBLIC_NEWS_WHERE}
      ORDER BY n.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Market news
//
// The WHERE clause here is a deliberate copy of the public feed's, from
// routes/api/news.js queryFeedTable(): `relevant = TRUE`, the blocked publisher
// clause, and the archived-company exclusion from buildFeedFilters(). Rendering
// these rows with a looser filter would publish items the site has chosen not to
// show, which is both a policy breach and a divergence from the user view.
// ---------------------------------------------------------------------------

const MARKET_NEWS_TABLE = 'market_news';
const MARKET_NEWS_WHERE = `WHERE n.relevant = TRUE
        AND (n.company_id IS NULL OR c.archived_at IS NULL)${blockedMarketSourcesClause('n')}`;

async function countMarketNews() {
  const res = await db.query(
    `SELECT COUNT(*)::int AS c
       FROM ${MARKET_NEWS_TABLE} n
       LEFT JOIN companies c ON c.id = n.company_id
       ${MARKET_NEWS_WHERE}`
  );
  return res.rows[0]?.c || 0;
}

async function listMarketNews(offset, limit) {
  const res = await db.query(
    `SELECT n.id, n.title, n.link, n.source, n.pub_date, n.description, n.summary,
            n.commodity, n.sentiment, n.ticker, n.created_at,
            c.name AS company_name
       FROM ${MARKET_NEWS_TABLE} n
       LEFT JOIN companies c ON c.id = n.company_id
       ${MARKET_NEWS_WHERE}
      ORDER BY n.pub_date DESC NULLS LAST, n.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

/**
 * Filings visible to the public.
 *
 * The predicate is deliberately the same one the public filings API uses
 * (routes/api/filings.js): `f.company_id IS NULL OR c.archived_at IS NULL`.
 *
 * It is NOT `c.id IS NULL OR c.archived_at IS NULL`, which is what this started
 * as and is subtly wrong. When a filing carries a company_id that no longer
 * joins to a company, `c.id IS NULL` is true and the row is included, whereas
 * the API excludes it (its first test is false and `c.archived_at IS NULL` is
 * NULL, so the row fails). The difference is filings a visitor cannot actually
 * reach, listed on a crawler page.
 */
const PUBLIC_FILING_WHERE = `WHERE (f.company_id IS NULL OR c.archived_at IS NULL)
        AND ${PUBLISHABLE_FILING_STATUS}`;

/**
 * Filings worth submitting to a search engine.
 *
 * Stricter than PUBLIC_FILING_WHERE on purpose, and for a different reason: this
 * one is about whether the page has content, not about whether it can be trusted.
 *
 * `f.analyzed = 1` is the load-bearing test. `analyzedFlagForAnalysis()` in
 * lib/scraper/analyzer/constants.js returns 0 both for filings still pending
 * analysis (779 of them in production) and for extraction failures — and an
 * extraction failure is not just an empty page, it is a **template**: every one
 * carries the identical canned summary "This filing could not be processed
 * automatically because no readable text was found." Publishing those would be
 * duplicate content at whatever scale the OCR failures reach.
 *
 * The summary-length floor stays as a second gate. It is what excluded these by
 * accident before the status test was added, which is not a property to rely on:
 * editing that canned sentence would have silently started indexing them.
 *
 * This is an indexing decision, not a publication one. These filings are still
 * listable and still resolve at `/filings/<id>`; `getFilingById()` uses
 * PUBLIC_FILING_WHERE, not this.
 */
const INDEXABLE_FILING_WHERE = `${PUBLIC_FILING_WHERE}
        AND f.analyzed = 1
        AND LENGTH(TRIM(COALESCE(a.summary, ''))) >= 120`;

async function countFilings() {
  const res = await db.query(
    `SELECT COUNT(*)::int AS c
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
       LEFT JOIN companies c ON c.id = f.company_id
       ${INDEXABLE_FILING_WHERE}`
  );
  return res.rows[0]?.c || 0;
}

async function listFilingsSitemapRows(offset, limit) {
  const res = await db.query(
    `SELECT f.id, f.created_at, f.filing_type, f.company_name,
            c.name AS company_canonical_name, c.ticker AS company_ticker
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
       LEFT JOIN companies c ON c.id = f.company_id
       ${INDEXABLE_FILING_WHERE}
      ORDER BY f.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

/** Distinct exchanges, for the /companies filter landing pages. */
async function listExchanges() {
  const res = await db.query(
    `SELECT DISTINCT exchange FROM companies
      WHERE exchange IS NOT NULL AND archived_at IS NULL
      ORDER BY exchange`
  );
  return res.rows.map((r) => r.exchange).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Hub pages (/companies?commodity=…, /companies?exchange=…)
// ---------------------------------------------------------------------------

/** Exchanges that get their own hub page. */
const HUB_EXCHANGES = ['TSX', 'TSXV', 'CSE', 'ASX'];

/** Commodities that get their own hub page, in the order they are listed. */
const HUB_COMMODITIES = Object.keys(COMMODITY_KEYS);

/**
 * Continents that get their own hub page.
 *
 * These map onto the SPA's existing `?continent=` filter, unlike the exchange
 * hubs which needed an alias, so a hub link filters correctly for a person as
 * well as for a crawler with no extra work.
 */
const HUB_CONTINENTS = Object.keys(CONTINENT_KEYS);

/** Swap TSX-V for the stored TSXV, matching normalizeExchange() elsewhere. */
function normalizeHubExchange(exchange) {
  const upper = String(exchange || '').toUpperCase();
  if (upper === 'TSX-V') return 'TSXV';
  return upper;
}

/**
 * WHERE fragment for a hub page.
 *
 * Deliberately mirrors the commodity and exchange filters in
 * routes/api/companies.js rather than importing them, so that a change to the
 * public list filter cannot silently alter what a crawler is shown. The shapes
 * are asserted equal by the hub page listing the same companies the SPA does.
 */
function hubFilter({ commodity, exchange, continent } = {}) {
  const clauses = ['archived_at IS NULL', "name IS NOT NULL", "name <> ''"];
  const params = [];

  const ex = exchange ? normalizeHubExchange(exchange) : null;
  if (ex) {
    params.push(ex);
    clauses.push(`exchange = $${params.length}`);
  }

  const keys = commodity ? COMMODITY_KEYS[commodity] : null;
  if (keys && keys.length) {
    const flagMap = { Gold: 'has_gold', Silver: 'has_silver', Copper: 'has_copper' };
    const flagCol = flagMap[commodity];
    params.push(keys[0]);
    const check = `(raw_data::jsonb->>$${params.length}) IN ('Y','y','TRUE','true','1')`;
    clauses.push(flagCol ? `(${flagCol} = 1 OR ${check})` : check);
  }

  // Continent, mirroring continentClause() in routes/api/companies.js: a
  // presence check on the raw_data key, with North America as the union of
  // CANADA and USA. CONTINENT_KEYS['North America'] is intentionally null, so
  // the membership test below is on the key, not on the value.
  if (continent && Object.prototype.hasOwnProperty.call(CONTINENT_KEYS, continent)) {
    if (continent === 'North America') {
      clauses.push(
        `((raw_data::jsonb->>'CANADA') IS NOT NULL OR (raw_data::jsonb->>'USA') IS NOT NULL)`
      );
    } else {
      const column = CONTINENT_KEYS[continent];
      if (column) {
        params.push(column);
        clauses.push(`(raw_data::jsonb->>$${params.length}) IS NOT NULL`);
      }
    }
  }

  return { whereSql: 'WHERE ' + clauses.join(' AND '), params };
}

async function countCompaniesForHub(filter) {
  const { whereSql, params } = hubFilter(filter);
  const res = await db.query(`SELECT COUNT(*)::int AS c FROM companies ${whereSql}`, params);
  return res.rows[0]?.c || 0;
}

async function listCompaniesForHub(filter, offset, limit) {
  const { whereSql, params } = hubFilter(filter);
  const res = await db.query(
    `SELECT id, name, exchange, ticker, market_cap, raw_data, updated_at, created_at
       FROM companies
       ${whereSql}
      ORDER BY market_cap DESC NULLS LAST, name ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return res.rows.map(enrichCompanyRow);
}

/** Is this a commodity we publish a hub page for? */
function isHubCommodity(value) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(COMMODITY_KEYS, value));
}

/** Is this an exchange we publish a hub page for? */
function isHubExchange(value) {
  return HUB_EXCHANGES.includes(normalizeHubExchange(value));
}

/** Is this a continent we publish a hub page for? */
function isHubContinent(value) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(CONTINENT_KEYS, value));
}

// ---------------------------------------------------------------------------
// Aggregate statistics
//
// Research on generative engine optimisation converges on the same point:
// passages carrying a concrete, verifiable statistic are far more likely to be
// quoted by an answer engine than prose. OreWire already owns these numbers, and
// "how many gold companies are listed on the TSXV" is a real question people ask.
//
// COUNTS ONLY, never a combined market capitalisation. `market_cap` is stored in
// mixed currencies (CAD, AUD, USD), so a total would be arithmetically
// meaningless. A wrong statistic is worse than no statistic: it is the fastest
// way to lose the credibility that makes a source quotable at all.
// ---------------------------------------------------------------------------

/**
 * Total company count plus a count per commodity.
 *
 * Deliberately implemented by calling countCompaniesForHub() once per commodity
 * rather than as one query with conditional aggregates. Two reasons:
 *
 *  1. Consistency. The number published on the index must equal the number of
 *     companies actually listed on that commodity's hub page. Going through the
 *     same hubFilter() makes divergence impossible; a hand written FILTER
 *     expression could drift from it silently.
 *  2. Blast radius. The commodity predicates cast raw_data to jsonb, which
 *     throws on a malformed row. One bad row then takes the whole index page
 *     down. Here a single commodity can fail on its own.
 *
 * Called only on page one of the un-filtered index, so the handful of queries is
 * paid for once per crawl of one page.
 */
async function commodityCounts() {
  const labels = Object.keys(COMMODITY_KEYS);

  const results = await Promise.all(
    labels.map(async (label) => {
      try {
        return { commodity: label, count: await countCompaniesForHub({ commodity: label }) };
      } catch (err) {
        console.error(`[seo] commodity count failed for "${label}":`, err?.message || err);
        return { commodity: label, count: 0 };
      }
    })
  );

  let total = 0;
  try {
    total = await countCompanies();
  } catch (err) {
    console.error('[seo] total company count failed:', err?.message || err);
  }

  return {
    total,
    byCommodity: results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
  };
}

/** Company count per exchange for a hub filter, for the breakdown table. */
async function hubExchangeCounts(filter) {
  const { whereSql, params } = hubFilter(filter);
  const res = await db.query(
    `SELECT COALESCE(exchange, 'Unlisted') AS exchange, COUNT(*)::int AS count
       FROM companies
       ${whereSql}
      GROUP BY 1
      ORDER BY count DESC, 1 ASC`,
    params
  );
  return res.rows.map((r) => ({ exchange: r.exchange, count: Number(r.count) || 0 }));
}

module.exports = {
  NEWS_TABLE,
  enrichCompanyRow,
  normalizeExchange,
  findCompany,
  getCompanyFilings,
  getCompanyNews,
  getCompanyPeople,
  getCompanySymbols,
  getCachedCompanySnapshot,
  getCompanyInsiders,
  getNewsById,
  getNewsByLinkOrTitle,
  getFilingById,
  countCompanies,
  listCompanySitemapRows,
  listFilingsCreatedSince,
  listNewsCreatedSince,
  listRecentCompanies,
  countNews,
  listNewsSitemapRows,
  countFilings,
  listFilingsSitemapRows,
  countMarketNews,
  listMarketNews,
  listExchanges,
  HUB_EXCHANGES,
  HUB_COMMODITIES,
  HUB_CONTINENTS,
  normalizeHubExchange,
  hubFilter,
  countCompaniesForHub,
  listCompaniesForHub,
  isHubCommodity,
  isHubExchange,
  isHubContinent,
  commodityCounts,
  hubExchangeCounts,
};
