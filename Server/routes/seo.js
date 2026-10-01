'use strict';

/**
 * Public SEO / AEO / GEO surface.
 *
 * Mounted at the application root (not under /api) so the paths are exactly the
 * ones crawlers expect:
 *
 *   GET /robots.txt
 *   GET /llms.txt
 *   GET /sitemap.xml
 *   GET /sitemaps/:name.xml
 *   GET /company/:slug        crawler HTML for a company profile
 *   GET /companies            crawler HTML for the company index
 *   GET /news/:slug           crawler HTML for a news release
 *   GET /filings/:id          crawler HTML for a filing
 *
 * nginx (frontend service) proxies crawler user agents on these paths to this
 * service; ordinary browsers keep getting the React SPA.
 */

const express = require('express');
const { siteOrigin, companyUrl, absoluteUrl, slugify } = require('../lib/seo/util');
const data = require('../lib/seo/data');
const pages = require('../lib/seo/pages');
const sitemaps = require('../lib/seo/sitemaps');
const indexnow = require('../lib/seo/indexnow');

const router = express.Router();

// Machine readable files (robots.txt, sitemaps, llms.txt, the IndexNow key) are
// byte-identical for every user agent, so a shared cache may hold them.
const FILE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/**
 * Rendered HTML must never enter a shared cache.
 *
 * nginx decides whether a request reaches this renderer by looking at
 * User-Agent, so the SAME URL legitimately returns the SPA shell to a person and
 * this HTML to a crawler. An edge cache keyed on the URL alone cannot tell those
 * apart and could hand a visitor the crawler page. `Vary` is the correct signal
 * for spec-compliant caches, but Cloudflare ignores `Vary` for its cache key, so
 * `no-store` is what actually guarantees correctness here.
 */
function sendHtml(res, html, status = 200) {
  res.status(status);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Vary', 'User-Agent');
  res.send(html);
}

function sendXml(res, xml, status = 200) {
  res.status(status);
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', FILE_CACHE);
  res.send(xml);
}

function sendText(res, body, status = 200) {
  res.status(status);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', FILE_CACHE);
  res.send(body);
}

/**
 * The host we want indexed. When the request arrives on any other host (the raw
 * backend domain, a preview URL, localhost) the response is still served, but it
 * is marked noindex so the canonical www copy is the only one Google keeps.
 */
function canonicalHost() {
  try {
    return new URL(siteOrigin()).host.toLowerCase();
  } catch {
    return 'www.orewire.com';
  }
}

function requestHost(req) {
  const forwarded = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  return (forwarded || req.headers.host || '').toLowerCase();
}

function applyHostGuard(req, res) {
  const host = requestHost(req);
  if (host && host !== canonicalHost()) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Machine readable files
// ---------------------------------------------------------------------------

router.get('/robots.txt', (req, res) => {
  // applyHostGuard marks a non-canonical host noindex; here that also decides
  // which robots.txt to serve. The canonical www copy is a static nginx file,
  // so this route only ever answers for the backend or a preview host.
  const isCanonical = applyHostGuard(req, res);
  sendText(res, isCanonical ? sitemaps.robotsTxt() : sitemaps.notCanonicalRobotsTxt());
});

router.get('/llms.txt', (req, res) => {
  applyHostGuard(req, res);
  sitemaps
    .llmsTxt()
    .then((body) => sendText(res, body))
    .catch((err) => {
      console.error('[seo] llms.txt failed:', err?.message || err);
      sendText(res, '# OreWire\n\n> Mining and resource company intelligence.\n', 503);
    });
});

router.get('/sitemap.xml', (req, res) => {
  applyHostGuard(req, res);
  sitemaps
    .sitemapChildren()
    .then((children) => sendXml(res, sitemaps.sitemapIndexXml(children)))
    .catch((err) => {
      console.error('[seo] sitemap index failed:', err?.message || err);
      res.status(503).send('Sitemap unavailable');
    });
});

router.get('/sitemaps/:name.xml', (req, res) => {
  applyHostGuard(req, res);
  const name = String(req.params.name || '').replace(/\.xml$/, '');
  sitemaps
    .childSitemap(name)
    .then((xml) => {
      if (!xml) return res.status(404).send('Not found');
      return sendXml(res, xml);
    })
    .catch((err) => {
      console.error('[seo] child sitemap failed:', err?.message || err);
      res.status(503).send('Sitemap unavailable');
    });
});

/**
 * IndexNow key file.
 *
 * IndexNow verifies ownership by fetching `/<key>.txt` and comparing the body to
 * the key, so this must be served from the site root. Registered only when a
 * well-formed key is configured, and the key is validated against
 * /^[a-zA-Z0-9-]{8,128}$/ before it is used as a route path.
 */
if (indexnow.enabled()) {
  router.get(`/${indexnow.key()}.txt`, (req, res) => {
    applyHostGuard(req, res);
    sendText(res, indexnow.key());
  });
}

// ---------------------------------------------------------------------------
// Rendered content pages
// ---------------------------------------------------------------------------

/** Company profile. Redirects legacy ticker URLs to the canonical name URL. */
router.get('/company/:slug', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    const company = await data.findCompany(req.params.slug);
    if (!company) return sendHtml(res, pages.renderNotFound(), 404);

    const canonicalPath = companyUrl(company.name);
    if (req.path !== canonicalPath) {
      // 301 rather than serving duplicate content on two URLs. Absolute, so no
      // crawler has to guess the scheme or host.
      return res.redirect(301, absoluteUrl(canonicalPath));
    }

    const [filings, news, people, snapshot, insiders, symbols] = await Promise.all([
      data.getCompanyFilings(company, 15).catch(() => []),
      data.getCompanyNews(company, 10).catch(() => []),
      data.getCompanyPeople(company.id, 25).catch(() => []),
      // Cached analysis only. Never triggers an AI generation on the crawler path.
      data.getCachedCompanySnapshot(company.id).catch(() => null),
      data.getCompanyInsiders(company.id).catch(() => null),
      data.getCompanySymbols(company.id).catch(() => []),
    ]);

    return sendHtml(
      res,
      pages.renderCompanyPage({ company, filings, news, people, snapshot, insiders, symbols })
    );
  } catch (err) {
    console.error('[seo] company render failed:', err?.message || err);
    return next();
  }
});

/** Company index, paginated, and the commodity / exchange hub pages. */
router.get('/companies', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 100;

    // A hub page exists only for a commodity, exchange or continent we actually
    // publish. Anything else is ignored rather than rendering an empty list.
    const commodityRaw = String(req.query.commodity || '').trim();
    const exchangeRaw = String(req.query.exchange || '').trim();
    const continentRaw = String(req.query.continent || '').trim();
    const hub = {};
    if (data.isHubCommodity(commodityRaw)) hub.commodity = commodityRaw;
    if (data.isHubExchange(exchangeRaw)) hub.exchange = data.normalizeHubExchange(exchangeRaw);
    if (data.isHubContinent(continentRaw)) hub.continent = continentRaw;
    const isHub = Boolean(hub.commodity || hub.exchange || hub.continent);

    const offset = (page - 1) * perPage;
    const [companies, total] = isHub
      ? await Promise.all([
          data.listCompaniesForHub(hub, offset, perPage),
          data.countCompaniesForHub(hub),
        ])
      : await Promise.all([
          data.listCompanySitemapRows(offset, perPage),
          data.countCompanies(),
        ]);

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    // The aggregate tables and the FAQ only appear on page one, so the extra
    // queries are only paid for there. Commodity counts describe the whole
    // catalogue, so they are only meaningful on the un-filtered index; an
    // exchange breakdown of a single exchange is a one-row table, so it is
    // skipped on exchange hubs.
    //
    // The statistics are strictly additive: each is caught independently so a
    // failing aggregate degrades the page to just the company list rather than
    // taking it down. They are a bonus, not the point of the page.
    let stats = null;
    let exchangeCounts = null;
    if (page === 1) {
      const wantCommodityStats = !isHub;
      const wantExchangeBreakdown = !(isHub && hub.exchange);
      [stats, exchangeCounts] = await Promise.all([
        wantCommodityStats
          ? data.commodityCounts().catch((err) => {
              console.error('[seo] commodity stats failed:', err?.message || err);
              return null;
            })
          : Promise.resolve(null),
        wantExchangeBreakdown
          ? data.hubExchangeCounts(hub).catch((err) => {
              console.error('[seo] exchange breakdown failed:', err?.message || err);
              return null;
            })
          : Promise.resolve(null),
      ]);
    }

    return sendHtml(
      res,
      pages.renderCompaniesIndexPage({
        companies,
        page,
        totalPages,
        total,
        hub: isHub ? hub : null,
        hubLinks: {
          commodities: data.HUB_COMMODITIES,
          exchanges: data.HUB_EXCHANGES,
          continents: data.HUB_CONTINENTS,
        },
        stats,
        exchangeCounts,
      })
    );
  } catch (err) {
    console.error('[seo] companies index render failed:', err?.message || err);
    return next();
  }
});

/**
 * Resolve a news slug. Two shapes are accepted:
 *   - the SPA form, an encoded external link or title
 *   - the canonical form `<title-slug>-<id>`
 */
async function resolveNews(slugRaw) {
  const slug = String(slugRaw || '');

  // Two accepted shapes:
  //   - canonical `<title-slug>-<id>`
  //   - a bare numeric id, which newsUrl() emits when an item has an id but no
  //     usable title. Without this second case `/news/7` 404s: the trailing-id
  //     pattern below needs the dash, and the fallback looks the value up as a
  //     link or title and finds nothing.
  const trailingId = /-(\d+)$/.exec(slug);
  const bareId = /^\d+$/.test(slug) ? slug : null;
  const idCandidate = trailingId ? trailingId[1] : bareId;

  if (idCandidate) {
    const byId = await data.getNewsById(idCandidate);
    // In the canonical form the title slug must also match, so an external URL
    // that merely ends in digits is not mistaken for an id. A bare id has no
    // slug to check against.
    if (byId && (bareId || slug === `${slugify(byId.title)}-${byId.id}`)) return byId;
  }

  const decoded = (() => {
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  })();
  return data.getNewsByLinkOrTitle(decoded);
}

/**
 * News index.
 *
 * nginx proxies crawler requests for `/news` here and the sitemap lists it, so
 * without this route that URL answered 404 to every crawler: a sitemap
 * advertising a Not Found page, and a Search Console error on a hub URL.
 */
router.get('/news', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 100;
    const [items, total] = await Promise.all([
      data.listNewsSitemapRows((page - 1) * perPage, perPage),
      data.countNews(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    return sendHtml(res, pages.renderNewsIndexPage({ items, page, totalPages, total }));
  } catch (err) {
    console.error('[seo] news index render failed:', err?.message || err);
    return next();
  }
});

/** Filings index. Same reasoning as the news index above. */
router.get('/filings', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 100;
    const [filings, total] = await Promise.all([
      data.listFilingsSitemapRows((page - 1) * perPage, perPage),
      data.countFilings(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    return sendHtml(res, pages.renderFilingsIndexPage({ filings, page, totalPages, total }));
  } catch (err) {
    console.error('[seo] filings index render failed:', err?.message || err);
    return next();
  }
});

/**
 * Market news index.
 *
 * This one was not a 404 like `/news` and `/filings` were, because nginx did not
 * proxy it at all — so a crawler that runs JavaScript still saw the page, but an
 * AI crawler saw the empty SPA shell. It is listed in the sitemap, so it is
 * proxied and rendered now.
 */
router.get('/market-news', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 100;
    const [items, total] = await Promise.all([
      data.listMarketNews((page - 1) * perPage, perPage),
      data.countMarketNews(),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    return sendHtml(res, pages.renderMarketNewsIndexPage({ items, page, totalPages, total }));
  } catch (err) {
    console.error('[seo] market news index render failed:', err?.message || err);
    return next();
  }
});

router.get('/news/:slug', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    const item = await resolveNews(req.params.slug);
    if (!item) return sendHtml(res, pages.renderNotFound(), 404);
    return sendHtml(res, pages.renderNewsPage({ item }));
  } catch (err) {
    console.error('[seo] news render failed:', err?.message || err);
    return next();
  }
});

router.get('/filings/:id', async (req, res, next) => {
  try {
    applyHostGuard(req, res);
    if (!/^\d+$/.test(String(req.params.id || ''))) return sendHtml(res, pages.renderNotFound(), 404);
    const filing = await data.getFilingById(req.params.id);
    if (!filing) return sendHtml(res, pages.renderNotFound(), 404);
    return sendHtml(res, pages.renderFilingPage({ filing }));
  } catch (err) {
    console.error('[seo] filing render failed:', err?.message || err);
    return next();
  }
});

/**
 * Always-rendered variants, useful for QA and as a fallback when an edge rule
 * cannot be trusted: /seo/company/TSXV-CRV renders the crawler page for anyone.
 */
router.get('/seo/company/:slug', async (req, res, next) => {
  try {
    const company = await data.findCompany(req.params.slug);
    if (!company) return sendHtml(res, pages.renderNotFound(), 404);
    const [filings, news, people, snapshot, insiders, symbols] = await Promise.all([
      data.getCompanyFilings(company, 15).catch(() => []),
      data.getCompanyNews(company, 10).catch(() => []),
      data.getCompanyPeople(company.id, 25).catch(() => []),
      data.getCachedCompanySnapshot(company.id).catch(() => null),
      data.getCompanyInsiders(company.id).catch(() => null),
      data.getCompanySymbols(company.id).catch(() => []),
    ]);
    return sendHtml(
      res,
      pages.renderCompanyPage({ company, filings, news, people, snapshot, insiders, symbols })
    );
  } catch (err) {
    console.error('[seo] seo company render failed:', err?.message || err);
    return next();
  }
});

/** Human readable summary of what the SEO layer is currently publishing. */
router.get('/seo/status', async (req, res) => {
  try {
    const [companies, news, filings] = await Promise.all([
      data.countCompanies(),
      data.countNews(),
      data.countFilings(),
    ]);
    res.json({
      site_origin: siteOrigin(),
      canonical_host: canonicalHost(),
      request_host: requestHost(req),
      companies,
      news,
      filings,
      hubs: {
        commodity: data.HUB_COMMODITIES,
        exchange: data.HUB_EXCHANGES,
        continent: data.HUB_CONTINENTS,
        note: 'Hub pages are /companies?commodity=<name>, /companies?exchange=<EXCHANGE> and /companies?continent=<name>.',
      },
      indexnow: {
        enabled: indexnow.enabled(),
        key_location: indexnow.enabled() ? indexnow.keyLocation() : null,
        note: 'Set INDEXNOW_KEY to enable. Submit with scripts/submit-indexnow.js.',
      },
      sitemaps: {
        index: '/sitemap.xml',
        // No Math.max(1, ...) here. sitemapChildren() omits a child sitemap
        // entirely when its count is zero (section 3.23), so reporting 1 would
        // contradict the index it is describing — and this endpoint is the first
        // thing anyone checks after a deploy.
        companies: Math.ceil(companies / sitemaps.PAGE_SIZE),
        news: Math.ceil(news / sitemaps.PAGE_SIZE),
        filings: Math.ceil(filings / sitemaps.PAGE_SIZE),
      },
      endpoints: [
        '/robots.txt',
        '/llms.txt',
        '/sitemap.xml',
        '/sitemaps/static.xml',
        '/company/:slug',
        '/companies',
        '/companies?commodity=<name>',
        '/companies?exchange=<EXCHANGE>',
        '/companies?continent=<name>',
        '/news',
        '/news/:slug',
        '/market-news',
        '/filings',
        '/filings/:id',
      ],
      note: 'Company pages are canonical at /company/<company-name-slug>',
    });
  } catch (err) {
    res.status(503).json({ error: err?.message || 'unavailable' });
  }
});

module.exports = router;
