#!/usr/bin/env node
'use strict';

/**
 * Static self-audit for the SEO layer. No database, no network.
 *
 * Every invariant in this file was previously verified by hand, because the
 * environment this work was done in had no working shell. That is not a good
 * arrangement. Three defects were caught only by re-reading code, and one of them
 * — `/news` and `/filings` listed in the sitemap, proxied by nginx, and answering
 * 404 because no route existed — was live for several rounds before anyone
 * noticed.
 *
 * This script turns those manual checks into something runnable:
 *
 *   1. requires every SEO module, which surfaces syntax and require errors that
 *      would otherwise first appear when the backend boots;
 *   2. asserts the exports the rest of the codebase depends on actually exist;
 *   3. cross-checks the paths nginx proxies against the routes that exist;
 *   4. validates that nginx.conf is structurally sound (balanced braces, both
 *      envsubst variables templated and set in the Dockerfile) — a syntax error
 *      there is a total frontend outage, not a degraded SEO feature, and there is
 *      no way to run `nginx -t` from here;
 *   4. checks the SPA declares its own metadata on every content route, and that
 *      the paginated renderers use the shared robots helper.
 *
 * Usage
 *   node scripts/check-seo.js
 *   npm run seo:check
 *
 * Run this BEFORE deploying. Run `npm run seo:audit` AFTER deploying, which
 * checks the live site instead.
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');
const REPO_DIR = path.join(SERVER_DIR, '..');
const FRONTEND_DIR = path.join(REPO_DIR, 'frontend');

const failures = [];
const warnings = [];
const notes = [];

function ok(message) {
  console.log(`  ok    ${message}`);
}

function warn(message, detail) {
  warnings.push({ message, detail });
  console.log(`  WARN  ${message}`);
  if (detail) console.log(`          ${detail}`);
}

function fail(message, detail) {
  failures.push({ message, detail });
  console.log(`  FAIL  ${message}`);
  if (detail) console.log(`          ${detail}`);
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Every SEO module loads.
//
// This is the highest value check in the file. A syntax error or a bad require
// path anywhere under lib/seo/ stops the backend from booting, which takes the
// whole API down — not just the SEO routes. `Server/index.js` requires
// routes/seo.js at startup, so that is loaded here too.
// ---------------------------------------------------------------------------

console.log('\nmodule loading');

const MODULES = [
  ['lib/seo/util', '../lib/seo/util'],
  ['lib/seo/schema', '../lib/seo/schema'],
  ['lib/seo/data', '../lib/seo/data'],
  ['lib/seo/pages', '../lib/seo/pages'],
  ['lib/seo/sitemaps', '../lib/seo/sitemaps'],
  ['lib/seo/indexnow', '../lib/seo/indexnow'],
  ['lib/schedulers/seo-indexnow', '../lib/schedulers/seo-indexnow'],
  ['routes/seo', '../routes/seo'],
];

const loaded = {};
for (const [label, rel] of MODULES) {
  try {
    loaded[label] = require(rel);
    ok(`${label} loads`);
  } catch (err) {
    fail(`${label} failed to load`, err && err.message ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// 2. Expected exports exist.
//
// These are the names the routes and the scheduler actually call. A rename that
// misses a call site is the exact failure mode that produced a ReferenceError in
// renderFilingsIndexPage (filingUrl was used but not imported).
// ---------------------------------------------------------------------------

console.log('\nexports');

const EXPECTED_EXPORTS = {
  'lib/seo/util': [
    'siteOrigin', 'slugify', 'slugSql', 'absoluteUrl', 'companyUrl',
    'companyLegacySlug', 'newsUrl', 'filingUrl', 'escapeHtml', 'summarise',
    'compactNumber', 'isoDate', 'isoDay',
    'THIN_SUMMARY_CHARS', 'hasSubstantiveSummary', 'hasSubstantiveSummarySql',
  ],
  'lib/seo/schema': [
    'organizationNode', 'websiteNode', 'corporationNode', 'breadcrumbNode',
    'newsArticleNode', 'filingNode', 'faqNode', 'datasetNode', 'graphScript',
  ],
  'lib/seo/data': [
    'findCompany', 'getCompanyFilings', 'getCompanyNews', 'getCompanyPeople',
    'getCachedCompanySnapshot', 'getCompanyInsiders', 'getCompanySymbols', 'getFilingById',
    'listCompaniesForHub', 'countCompaniesForHub', 'listCompanySitemapRows',
    'listFilingsCreatedSince', 'listNewsCreatedSince',
    'listRecentCompanies', 'listNewsSitemapRows', 'listFilingsSitemapRows',
    'listMarketNews', 'countMarketNews', 'commodityCounts', 'hubExchangeCounts',
    'HUB_COMMODITIES', 'HUB_EXCHANGES', 'HUB_CONTINENTS',
    'isHubCommodity', 'isHubExchange', 'isHubContinent', 'normalizeHubExchange',
  ],
  'lib/seo/pages': [
    'renderCompanyPage', 'renderCompaniesIndexPage', 'companiesIndexPath',
    'renderNewsIndexPage', 'renderFilingsIndexPage', 'renderMarketNewsIndexPage',
    'renderNewsPage', 'renderFilingPage', 'renderNotFound',
  ],
  'lib/seo/sitemaps': [
    'sitemapIndexXml', 'sitemapChildren', 'childSitemap', 'robotsTxt',
    'notCanonicalRobotsTxt', 'llmsTxt', 'PAGE_SIZE',
  ],
  'lib/seo/indexnow': ['key', 'enabled', 'keyLocation', 'submit'],
};

for (const [label, names] of Object.entries(EXPECTED_EXPORTS)) {
  const mod = loaded[label];
  if (!mod) {
    fail(`${label} exports not checked (module did not load)`);
    continue;
  }
  const missing = names.filter((n) => mod[n] === undefined);
  if (missing.length) {
    fail(`${label} is missing export(s)`, missing.join(', '));
  } else {
    ok(`${label} exports all ${names.length} expected names`);
  }
}

// ---------------------------------------------------------------------------
// 3. Every path nginx proxies to the renderer has a route.
//
// This is the check that would have caught /news and /filings returning 404 to
// every crawler while sitting in the sitemap.
// ---------------------------------------------------------------------------

console.log('\nnginx proxy paths vs routes');

const nginxConf = readIfExists(path.join(FRONTEND_DIR, 'nginx.conf'));
const seoRoutesSrc = readIfExists(path.join(SERVER_DIR, 'routes', 'seo.js'));

if (!nginxConf) {
  fail('frontend/nginx.conf not found');
} else if (!seoRoutesSrc) {
  fail('Server/routes/seo.js not found');
} else {
  const proxyMatch = /location\s+~\s+\^\/\(([^)]+)\)/.exec(nginxConf);
  if (!proxyMatch) {
    fail('could not find the crawler content-proxy location in nginx.conf');
  } else {
    const proxied = proxyMatch[1].split('|').map((s) => s.trim()).filter(Boolean);
    ok(`nginx proxies ${proxied.length} path prefix(es): ${proxied.join(', ')}`);

    for (const prefix of proxied) {
      // A route counts if the router declares the bare path or a sub-path of it.
      const hasRoute =
        seoRoutesSrc.includes(`'/${prefix}'`) || seoRoutesSrc.includes(`'/${prefix}/`);
      if (hasRoute) {
        ok(`/${prefix} has a route in routes/seo.js`);
      } else {
        fail(
          `/${prefix} is proxied by nginx but routes/seo.js declares no route for it`,
          'crawler requests for this path will 404 from the renderer'
        );
      }
    }
  }

  // The machine-readable files are proxied unconditionally, by exact location.
  for (const [label, needle] of [
    ['/sitemap.xml', 'location = /sitemap.xml'],
    ['/sitemaps/', 'location ^~ /sitemaps/'],
    ['/llms.txt', 'location = /llms.txt'],
  ]) {
    if (nginxConf.includes(needle)) ok(`${label} is proxied`);
    else fail(`${label} has no proxy location in nginx.conf`);
  }

  // Guard rails on the crawler map itself.
  if (/\bEXTRA_CRAWLER_UA_PATTERN\b/.test(nginxConf)) ok('extra-crawler pattern map present');
  else fail('EXTRA_CRAWLER_UA_PATTERN map is missing from nginx.conf');

  if (/proxy_set_header\s+X-Forwarded-Host/.test(readIfExists(path.join(FRONTEND_DIR, 'orewire-proxy-headers.inc')) || '')) {
    ok('X-Forwarded-Host is forwarded (the canonical-host guard depends on it)');
  } else {
    fail('X-Forwarded-Host is not forwarded; the canonical-host guard would misfire');
  }

  // Structural validity. A syntax error here stops the FRONTEND container from
  // starting, which is a total outage rather than a degraded SEO feature, and
  // there is no way to run `nginx -t` from these scripts. Brace balance catches
  // the whole class of mistake that actually matters — a missing or extra closing
  // brace in a map, an if block or a location — without pretending to be a parser.
  //
  // Regex quantifiers like `{8,128}` in the IndexNow location contribute one open
  // and one close brace, so they cancel and do not mask a real imbalance.
  {
    let depth = 0;
    let wentNegative = false;
    const lines = nginxConf.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      // nginx comments run to end of line; strip them so a brace in a comment
      // cannot unbalance the count.
      const code = lines[i].replace(/#.*$/, '');
      for (const ch of code) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth < 0) wentNegative = true;
        }
      }
    }

    if (depth === 0 && !wentNegative) ok('nginx.conf braces balance');
    else if (wentNegative) fail('nginx.conf closes a block that was never opened (a "}" before its "{")');
    else fail(`nginx.conf is missing ${depth} closing brace(s); nginx would refuse to start`);
  }

  // envsubst only substitutes variables that exist in the container environment.
  // Both are provided by the Dockerfile ENV, so both must appear in the template.
  for (const varName of ['BACKEND_UPSTREAM', 'EXTRA_CRAWLER_UA_PATTERN']) {
    if (nginxConf.includes(`\${${varName}}`)) ok(`${varName} is templated in nginx.conf`);
    else fail(`${varName} is not templated in nginx.conf`);
  }

  // The Dockerfile ENV must define both, or envsubst leaves the placeholder empty
  // and nginx fails to start on a malformed map.
  {
    const dockerfile = readIfExists(path.join(FRONTEND_DIR, 'Dockerfile')) || '';
    if (!dockerfile) {
      fail('frontend/Dockerfile not found');
    } else {
      for (const varName of ['BACKEND_UPSTREAM', 'EXTRA_CRAWLER_UA_PATTERN']) {
        if (new RegExp(`${varName}=`).test(dockerfile)) ok(`Dockerfile sets ${varName}`);
        else fail(`Dockerfile does not set ${varName}; envsubst would leave it empty`);
      }
      // A '#' on a continued line ends the logical line early, silently dropping
      // every variable after it. This was a real defect once.
      const commentedContinuation = dockerfile
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => line.trimEnd().endsWith('\\') && /#/.test(line));
      if (commentedContinuation.length === 0) {
        ok('no comment inside a Dockerfile line continuation');
      } else {
        fail(
          `Dockerfile has a '#' on a continued line (line ${commentedContinuation[0].n}); everything after it is dropped`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3c. The renderer must actually be mounted, and the scheduler registered.
//
// These are the two wiring failures that would make everything else moot: a file
// full of correct routes that index.js never mounts answers 404 on every crawler
// path, and a scheduler that is never registered never sends a freshness ping.
// Both are one line, and both are silent.
// ---------------------------------------------------------------------------

console.log('\nbackend wiring');

{
  const indexSrc = readIfExists(path.join(SERVER_DIR, 'index.js')) || '';

  // Line comments are stripped before matching. Without that, a mount that has
  // been commented out still satisfies the check — the guard would pass while the
  // wiring was gone, which is the dangerous direction for a guard to fail in.
  const indexCode = indexSrc
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  // Both quote styles and internal spacing are tolerated. A check that reports a
  // false failure the first time someone reformats a line gets ignored.
  if (/app\.use\(\s*require\(\s*['"]\.\/routes\/seo['"]\s*\)\s*\)/.test(indexCode)) {
    ok('routes/seo.js is mounted in index.js');
  } else {
    fail('routes/seo.js is not mounted in index.js; every crawler path would 404');
  }

  const schedSrc = readIfExists(path.join(SERVER_DIR, 'lib/schedulers/index.js')) || '';
  if (/startIndexNowScheduler/.test(schedSrc)) {
    ok('the IndexNow freshness scheduler is registered');
  } else {
    notes.push('note: the IndexNow scheduler is not registered, so freshness pings will not run');
  }
}

// ---------------------------------------------------------------------------
// 3d. robots.txt group semantics.
//
// The worst defect found in this project lived here. robots.txt rules are NOT
// merged across groups: for any crawler exactly one group applies — the most
// specific match — and agent-specific groups are never combined with `*`. Both
// copies of robots.txt gave every named crawler its own `Allow: /` group, which
// exempted Googlebot, Bingbot and 18 AI crawlers from every Disallow, including
// `/seo/`: the internal renderer that duplicates every company page without its
// canonical redirect.
//
// The file looked correct and used the conventional shape. This parses it and
// asserts the intended policy holds for a NAMED crawler, not only for `*`.
// ---------------------------------------------------------------------------

console.log('\nrobots.txt group semantics');

// Consecutive user-agent lines followed by rules form one group. A user-agent
// line appearing after a rule starts a new group.
function parseRobotsGroups(text) {
  const groups = [];
  let current = null;
  let lastField = 'none';
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || lastField !== 'user-agent') {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastField = 'user-agent';
      continue;
    }
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ type: field, path: value });
      lastField = field;
    }
  }
  return groups;
}

// Exactly one group applies: the longest user-agent match, else `*`. Within that
// group the longest matching rule wins; on a tie Allow wins.
//
// Every group naming the same agent is MERGED. RFC 9309 section 2.2.1 requires it
// ("if more than one group matches, the matching groups' rules MUST be combined"),
// and Google's spec says the same. The `*` group is used only when no specific
// group matches, and is never merged with one. Getting this wrong makes the guard
// report a defect where a split-out named group is harmless, because its rules are
// combined with the group that already carries the Disallows.
function robotsAllows(groups, agent, targetPath) {
  const a = String(agent).toLowerCase();

  const specific = groups.filter((g) =>
    g.agents.some((name) => name !== '*' && (a === name || a.startsWith(name)))
  );
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  if (!chosen.length) return true;

  let winner = null;
  for (const g of chosen) {
    for (const rule of g.rules) {
      if (!rule.path || !targetPath.startsWith(rule.path)) continue;
      if (!winner || rule.path.length > winner.path.length) winner = rule;
      else if (rule.path.length === winner.path.length && rule.type === 'allow') winner = rule;
    }
  }
  if (!winner) return true;
  return winner.type === 'allow';
}

{
  const MUST_BLOCK = ['/seo/company/x', '/api/companies', '/admin'];
  const MUST_ALLOW = ['/', '/company/carson-river-ventures-corp'];
  const PROBE_AGENTS = ['Googlebot', 'Bingbot', 'GPTBot', 'ClaudeBot', 'PerplexityBot'];

  const sources = [];

  const staticRobots = readIfExists(path.join(FRONTEND_DIR, 'public', 'robots.txt'));
  if (staticRobots) sources.push(['frontend/public/robots.txt', staticRobots]);
  else fail('frontend/public/robots.txt not found');

  const sitemapsMod = loaded['lib/seo/sitemaps'];
  if (sitemapsMod && typeof sitemapsMod.robotsTxt === 'function') {
    sources.push(['sitemaps.robotsTxt()', sitemapsMod.robotsTxt()]);
  } else {
    fail('could not obtain sitemaps.robotsTxt() to check its group structure');
  }

  for (const [label, text] of sources) {
    const groups = parseRobotsGroups(text);

    // Every named agent in the file, not just a fixed probe list. Probing only by
    // name would leave a hole: adding one new named group would silently exempt
    // that crawler again, and the guard would still pass.
    const namedAgents = [...new Set(groups.flatMap((g) => g.agents))].filter((a) => a !== '*');
    const probeAgents = [...new Set([...namedAgents, ...PROBE_AGENTS])];

    let problems = 0;

    for (const agent of probeAgents) {
      for (const p of MUST_BLOCK) {
        if (robotsAllows(groups, agent, p)) {
          fail(
            `${label}: ${agent} may crawl ${p}. A named group is not merged with *, so its Disallow rules do not apply`
          );
          problems += 1;
        }
      }
      for (const p of MUST_ALLOW) {
        if (!robotsAllows(groups, agent, p)) {
          fail(`${label}: ${agent} is blocked from ${p}, which must stay crawlable`);
          problems += 1;
        }
      }
    }

    if (problems === 0) {
      ok(`${label}: named crawlers get the same policy as * (${groups.length} group(s))`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. SPA metadata coverage and shared renderer helpers.
// ---------------------------------------------------------------------------

console.log('\nSPA metadata');

const SPA_CONTENT_COMPONENTS = [
  ['features/companies/pages/CompanyDetail.tsx', '/company/:slug'],
  ['features/companies/pages/Companies.tsx', '/companies'],
  ['features/news/pages/News.tsx', '/news'],
  ['features/news/pages/NewsDetail.tsx', '/news/:slug'],
  ['features/news/pages/MarketNews.tsx', '/market-news'],
  ['features/news/pages/FilingsList.tsx', '/filings'],
  ['features/news/pages/FilingDetail.tsx', '/filings/:id'],
  // Unmatched routes. Without its own metadata the 404 falls back to the shell's
  // homepage title, description and `index, follow` — and CompanyDetail links
  // every person name to /insider/<slug>, for which no route exists, so these are
  // several soft 404s per company page.
  ['pages/NotFound.tsx', '(unmatched routes)'],
];

for (const [rel, route] of SPA_CONTENT_COMPONENTS) {
  const src = readIfExists(path.join(FRONTEND_DIR, 'src', rel));
  if (!src) {
    fail(`${rel} not found`);
  } else if (!src.includes('useSeo')) {
    fail(
      `${route} (${rel}) does not call useSeo`,
      'it will inherit the shell homepage title and description, and claim index, follow'
    );
  } else if (route === '(unmatched routes)' && !/noindex/.test(src)) {
    fail(`${rel} calls useSeo but does not set noindex; a 404 must not be indexable`);
  } else {
    ok(`${route} sets its own metadata`);
  }
}

// Public routes that render real content but set no metadata of their own, so they
// present the SPA shell's homepage title and description instead. Reported as notes
// rather than failures: this is a known gap, not a reason to block a deploy.
//
// The private routes are absent on purpose — /watchlist, /profile,
// /change-password, /login, /register and /auth/* are all disallowed in
// robots.txt, so inheriting the homepage metadata there costs nothing.
const SPA_UNWIRED_PUBLIC_ROUTES = [
  ['features/markets/pages/CommodityDetail.tsx', '/market/commodity/:slug'],
  ['features/markets/pages/CurrencyDetail.tsx', '/market/currency/:slug'],
  ['features/markets/pages/IndexDetail.tsx', '/market/index/:slug'],
  ['features/jobs/pages/Jobs.tsx', '/jobs'],
  ['features/static/pages/Contact.tsx', '/contact'],
  ['features/static/pages/Terms.tsx', '/terms'],
  ['features/static/pages/Privacy.tsx', '/privacy'],
  // The home page is the one route whose inherited metadata IS correct, since the
  // shell's title and description were written for it.
  ['features/home/pages/Index.tsx', '/ (inherited, and correct)'],
];

for (const [rel, route] of SPA_UNWIRED_PUBLIC_ROUTES) {
  const src = readIfExists(path.join(FRONTEND_DIR, 'src', rel));
  if (!src) continue;
  if (src.includes('useSeo')) {
    ok(`${route} sets its own metadata`);
  } else {
    notes.push(
      `note: ${route} (${rel}) does not call useSeo, so it serves the homepage title and description`
    );
  }
}

console.log('\nrenderer helpers');
const pagesSrc = readIfExists(path.join(SERVER_DIR, 'lib', 'seo', 'pages.js')) || '';
// All four paginated listings must reference the shared helper. Three use it
// directly; the news index uses it in a ternary that also handles the empty-set
// case. The function definition matches too, so the expected total is 5.
const listingRefs = (pagesSrc.match(/listingRobots\(page\)/g) || []).length;
if (listingRefs >= 5) ok(`all 4 paginated renderers reference listingRobots(page) (${listingRefs} refs)`);
else fail(`only ${listingRefs} references to listingRobots(page); expected at least 5 (1 definition + 4 renderers)`);

// The company, filing and content pages carry a fixed directive. The news page
// and the news index are conditional (thin summary, empty set) and are asserted
// separately below rather than counted here.
const literalIndexRobots = (pagesSrc.match(/robots: 'index, follow/g) || []).length;
if (literalIndexRobots === 3) ok('company, filing and content pages keep a fixed index, follow directive');
else notes.push(`note: ${literalIndexRobots} fixed "index, follow" directives found (expected 3)`);

if (/hasSubstantiveSummary\(item\)/.test(pagesSrc)) {
  ok('the news page gates its robots directive on having a real summary');
} else {
  fail('the news page does not gate its robots directive on summary substance');
}

if (/total === 0 \? 'noindex, follow'/.test(pagesSrc)) {
  ok('the news index noindexes itself when it has nothing to list');
} else {
  fail('the news index does not guard against being empty');
}

// The shell's canonical must be absolute, not a bare "/".
const shellHtml = readIfExists(path.join(FRONTEND_DIR, 'index.html'));
if (!shellHtml) {
  fail('frontend/index.html not found');
} else {
  // The shell must NOT hardcode a canonical. nginx serves this one file for every
  // non-proxied path, so a canonical here makes every client-rendered route claim
  // to be a duplicate of whatever it points at. This check previously asserted the
  // opposite and so enforced the defect: index.html carried
  // `rel="canonical" href="https://www.orewire.com/"`, which declared /insider/*,
  // /login and every other unwired route to be copies of the homepage.
  if (/<link[^>]+rel="canonical"/i.test(shellHtml)) {
    fail(
      'frontend/index.html declares a canonical; it serves every non-proxied route, so that canonical applies to all of them'
    );
  } else {
    ok('shell declares no canonical (per-route canonicals come from useSeo)');
  }
  if (/rel="alternate"[^>]*href="\/sitemap\.xml"/.test(shellHtml)) ok('shell links the sitemap');
  else notes.push('note: static shell does not link /sitemap.xml');

  // Brand assets. Neither of these can be fixed by code — they need a real file
  // — so they are warnings rather than failures, but they are reported on every
  // run so they cannot quietly stay unfixed.
  const ogImage = /<meta\s+property="og:image"\s+content="([^"]+)"/.exec(shellHtml);
  if (!ogImage) {
    warn('no og:image in the static shell', 'social shares will render without a card image');
  } else if (!/^https:\/\/www\.orewire\.com\//.test(ogImage[1])) {
    warn(
      'og:image is not served from orewire.com',
      `${ogImage[1]}\n          Replace with https://www.orewire.com/og-image.png (1200x630) and delete the third party URL.`
    );
  } else {
    ok('og:image is first party');
  }

  const logoFile = path.join(FRONTEND_DIR, 'public', 'logo.png');
  if (fs.existsSync(logoFile)) {
    ok('frontend/public/logo.png exists');
  } else {
    warn(
      'no frontend/public/logo.png',
      'Organization.logo is therefore omitted from the structured data. Add a square\n          raster logo (Google accepts PNG/JPEG/SVG), then set logo in schema.js, seo.ts\n          and index.html.'
    );
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '-'.repeat(70));
for (const n of notes) console.log(n);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) — none block a deploy:`);
  for (const w of warnings) console.log(`  - ${w.message}${w.detail ? `\n      ${w.detail}` : ''}`);
}

if (failures.length) {
  console.log(`\nFAILED: ${failures.length} check(s)`);
  for (const f of failures) console.log(`  - ${f.message}${f.detail ? `: ${f.detail}` : ''}`);
  console.log('\nThis is a static check. Fix these before deploying, then run it again.');
  process.exit(1);
}

console.log(`\nAll static SEO checks passed${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
console.log('Deploy, then run `npm run seo:audit` to verify the live site.');
process.exit(0);
