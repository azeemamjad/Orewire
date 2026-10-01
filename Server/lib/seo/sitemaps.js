'use strict';

/**
 * Sitemaps, robots.txt and llms.txt.
 *
 * OreWire has thousands of company profiles and a growing number of filings and
 * news items, none of which were previously listed anywhere a crawler could
 * discover them from. These generators publish that inventory.
 *
 * Limits respected: a <urlset> may hold at most 50,000 URLs and 50 MB
 * uncompressed. We page at 10,000 URLs to keep generation fast and each response
 * small, and expose a <sitemapindex> at /sitemap.xml.
 */

const {
  siteOrigin,
  absoluteUrl,
  companyUrl,
  filingUrl,
  slugify,
  newsUrl,
} = require('./util');
const data = require('./data');

const PAGE_SIZE = 10000;

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');
}

function urlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;
}

function sitemapIndexXml(children) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${children
  .map(
    (c) => `  <sitemap>
    <loc>${xmlEscape(absoluteUrl(c.path))}</loc>${c.lastmod ? `\n    <lastmod>${xmlEscape(c.lastmod)}</lastmod>` : ''}
  </sitemap>`
  )
  .join('\n')}
</sitemapindex>`;
}

function pageCount(total) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** ISO 8601 string for a timestamp, or null when it is missing or unparseable. */
function safeIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The static hub pages that always exist. */
function staticEntries() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    urlEntry(siteOrigin() + '/', today, 'daily', '1.0'),
    urlEntry(absoluteUrl('/companies'), today, 'daily', '0.9'),
    urlEntry(absoluteUrl('/filings'), today, 'daily', '0.8'),
    urlEntry(absoluteUrl('/news'), today, 'hourly', '0.8'),
    urlEntry(absoluteUrl('/market-news'), today, 'hourly', '0.7'),
    urlEntry(absoluteUrl('/contact'), null, 'monthly', '0.3'),

    // Commodity and exchange hubs. These are the crawl paths down into the
    // company profiles, so they are listed rather than left to be discovered.
    ...data.HUB_COMMODITIES.map((commodity) =>
      urlEntry(
        absoluteUrl(`/companies?commodity=${encodeURIComponent(commodity)}`),
        today,
        'weekly',
        '0.8'
      )
    ),
    ...data.HUB_EXCHANGES.map((exchange) =>
      urlEntry(
        absoluteUrl(`/companies?exchange=${encodeURIComponent(exchange)}`),
        today,
        'weekly',
        '0.8'
      )
    ),
    ...data.HUB_CONTINENTS.map((continent) =>
      urlEntry(
        absoluteUrl(`/companies?continent=${encodeURIComponent(continent)}`),
        today,
        'weekly',
        '0.7'
      )
    ),
  ];
}

/**
 * The list of child sitemaps, computed from live row counts.
 *
 * A kind with zero rows produces NO child sitemap rather than an empty one. That
 * became a real possibility when thin news items were excluded (section 3.20): an
 * empty `<urlset>` is valid XML and a warning in Search Console, and there is no
 * reason to advertise a sitemap that lists nothing.
 */
async function sitemapChildren() {
  const [companies, news, filings] = await Promise.all([
    data.countCompanies(),
    data.countNews(),
    data.countFilings(),
  ]);

  const children = [];
  const addPages = (kind, total) => {
    for (let i = 1; i <= pageCount(total); i += 1) {
      children.push({ path: `/sitemaps/${kind}-${i}.xml` });
    }
  };

  if (companies > 0) addPages('companies', companies);
  if (news > 0) addPages('news', news);
  if (filings > 0) addPages('filings', filings);

  children.push({ path: '/sitemaps/static.xml' });
  return children;
}

/**
 * Build one child sitemap. `name` looks like `companies-2`, `news-1`,
 * `filings-3` or `static`. Returns null for anything unrecognised.
 */
async function childSitemap(name) {
  if (name === 'static') {
    return urlset(staticEntries());
  }

  const match = /^(companies|news|filings)-(\d+)$/.exec(String(name || ''));
  if (!match) return null;

  const [, kind, pageRaw] = match;
  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  if (kind === 'companies') {
    const rows = await data.listCompanySitemapRows(offset, PAGE_SIZE);
    if (!rows.length && page > 1) return null;
    return urlset(
      rows.map((r) =>
        urlEntry(
          absoluteUrl(companyUrl(r.name)),
          // lastmod is the newest filing for the company, not updated_at — see
          // the note on listCompanySitemapRows().
          safeIso(r.lastmod || r.created_at),
          'weekly',
          '0.7'
        )
      )
    );
  }

  if (kind === 'news') {
    const rows = await data.listNewsSitemapRows(offset, PAGE_SIZE);
    if (!rows.length && page > 1) return null;
    return urlset(
      rows.map((r) =>
        urlEntry(
          absoluteUrl(newsUrl(r)),
          safeIso(r.pub_date || r.created_at),
          'monthly',
          '0.5'
        )
      )
    );
  }

  const rows = await data.listFilingsSitemapRows(offset, PAGE_SIZE);
  if (!rows.length && page > 1) return null;
  return urlset(
    rows.map((r) =>
      urlEntry(
        absoluteUrl(filingUrl(r.id)),
        safeIso(r.created_at),
        'monthly',
        '0.5'
      )
    )
  );
}

/**
 * robots.txt.
 *
 * Two deliberate choices:
 *  - AI crawlers are ALLOWED, including training crawlers. OreWire's problem is
 *    invisibility, not scraped content; being absent from the corpora that models
 *    are trained and grounded on is a direct cause of never being cited.
 *  - The private, authenticated and duplicate surfaces are disallowed so crawl
 *    budget lands on company profiles instead.
 */
function robotsTxt() {
  const origin = siteOrigin();

  const aiAgents = [
    ['GPTBot', 'OpenAI training crawler'],
    ['OAI-SearchBot', 'ChatGPT search index'],
    ['ChatGPT-User', 'ChatGPT live browsing on a user request'],
    ['PerplexityBot', 'Perplexity search index'],
    ['Perplexity-User', 'Perplexity live fetching on a user request'],
    ['ClaudeBot', 'Anthropic crawler'],
    ['Claude-User', 'Claude live fetching on a user request'],
    ['Claude-SearchBot', 'Claude search index'],
    ['Google-Extended', 'Gemini / Vertex grounding and training'],
    ['Applebot', 'Siri and Spotlight'],
    ['Applebot-Extended', 'Apple Intelligence grounding and training'],
    ['DuckAssistBot', 'DuckDuckGo AI answers'],
    ['Amazonbot', 'Amazon Alexa answers'],
    ['meta-externalagent', 'Meta AI'],
    ['cohere-ai', 'Cohere'],
    ['MistralAI-User', 'Mistral live fetching'],
    ['YouBot', 'You.com'],
    ['CCBot', 'Common Crawl, the open corpus most models train on'],
  ];

  // Every crawler goes in ONE group as consecutive `user-agent` lines.
  //
  // robots.txt rules are NOT merged across groups: for any crawler only the most
  // specific matching group applies, and agent-specific groups are never combined
  // with `*`. This function used to give each agent its own `Allow: /` group, which
  // exempted every named crawler from every Disallow below — including /seo/, the
  // internal renderer that serves the same content as /company/<slug> without the
  // canonical redirect, so it must never be indexed as a duplicate.
  //
  // The list is unbroken on purpose: no comments or blank lines between the
  // `user-agent` lines, because separator handling inside a group is the one place
  // parsers have historically disagreed.
  const agentNames = [
    ...aiAgents.map(([agent]) => agent),
    'Googlebot',
    'Googlebot-Image',
    'Bingbot',
    'Twitterbot',
    'facebookexternalhit',
    'LinkedInBot',
    'Slackbot',
    '*',
  ];

  const agentList = agentNames.map((agent) => `User-agent: ${agent}`).join('\n');

  const agentLegend = aiAgents.map(([agent, why]) => `${agent} (${why})`).join(', ');

  return `# OreWire robots.txt
# Canonical host: ${origin}
# Machine readable summaries: ${origin}/llms.txt
#
# Rules are NOT merged across groups. For any crawler exactly one group applies,
# and agent-specific groups are never combined with the \`*\` group. Every crawler
# below therefore shares a single group, so the Disallow rules bind all of them.
#
# Listed: ${agentLegend}, Googlebot, Googlebot-Image, Bingbot, Twitterbot,
# facebookexternalhit, LinkedInBot, Slackbot, and everything else via *.
#
# If some agent ever needs a DIFFERENT policy, give it its own group AND repeat
# every Disallow line inside that group.

${agentList}

# One set of rules for every agent listed above.
Allow: /

# Private or duplicate surfaces: keep crawl budget on company profiles.
Disallow: /admin
Disallow: /api/
Disallow: /watchlist
Disallow: /profile
Disallow: /change-password
Disallow: /login
Disallow: /register
Disallow: /auth/
# Internal QA renderer: same content as /company/<slug> without the canonical
# redirect, so it must not be indexed as a duplicate.
Disallow: /seo/
Disallow: /*?*utm_
Disallow: /*?*fbclid=
Disallow: /*?*gclid=

Sitemap: ${origin}/sitemap.xml
`;
}

/**
 * robots.txt for a non-canonical host: the raw backend domain, a preview URL,
 * localhost.
 *
 * Everything served there already carries `X-Robots-Tag: noindex` because the
 * canonical www copy is the one that should rank. Saying so here as well removes
 * any chance of the backend host being crawled and indexed as a duplicate of the
 * site, and it means the two robots.txt files in this project no longer claim to
 * be the same document.
 *
 * Note the public site keeps its robots.txt as a static nginx file on purpose:
 * robots.txt must not be able to 502, because a persistent server error on it
 * makes Google stop crawling altogether. Only this non-canonical variant is
 * generated.
 */
function notCanonicalRobotsTxt() {
  return `# Non-canonical host.
#
# The public site is ${siteOrigin()} and that is the only host meant to be
# indexed. Pages served here carry X-Robots-Tag: noindex, so crawling them
# achieves nothing. Use the canonical host's sitemap:
#   ${siteOrigin()}/sitemap.xml

User-agent: *
Disallow: /
`;
}

/**
 * llms.txt — a short, markdown index for language models (see llmstxt.org).
 *
 * Adoption is still uneven, so this is treated as a cheap supplement to real
 * indexable HTML, never as a substitute for it.
 */
async function llmsTxt() {
  const origin = siteOrigin();
  const lines = [];

  lines.push('# OreWire');
  lines.push('');
  lines.push(
    '> OreWire publishes stock data, decoded regulatory filings and news release summaries for more than 2,000 mining and resource companies listed on the TSX, TSX-V, CSE and ASX.'
  );
  lines.push('');
  lines.push(
    'OreWire company profiles are public and free to read. Each profile carries the company name, exchange, ticker, sector, commodity exposure, headquarters, market capitalisation, the latest regulatory filings with a plain-English summary and verdict, and the most recent news releases.'
  );
  lines.push('');

  let top = [];
  try {
    // Ordered by recency, matching the heading below. The sitemap query is
    // ordered by id for stable pagination and would list the oldest rows.
    top = await data.listRecentCompanies(50);
  } catch {
    top = [];
  }

  lines.push('## Company profiles');
  lines.push('');
  lines.push(`- [All companies](${origin}/companies): browsable index of every company on OreWire`);
  lines.push(`- [Sitemap](${origin}/sitemap.xml): machine readable list of every company, filing and news URL`);
  lines.push('');

  if (top.length) {
    lines.push('### Most recently added or updated');
    lines.push('');
    for (const c of top) {
      const listed = c.exchange && c.ticker ? ` (${c.exchange}:${c.ticker})` : '';
      lines.push(`- [${c.name}${listed}](${origin}${companyUrl(c.name)})`);
    }
    lines.push('');
  }

  lines.push('## Data');
  lines.push('');
  lines.push(`- [Filings](${origin}/filings): regulatory filings decoded and graded by OreWire`);
  lines.push(`- [News releases](${origin}/news): company news releases with summaries`);
  lines.push(`- [Market news](${origin}/market-news): commodity and market headlines`);
  lines.push('');

  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- All content is public and may be quoted or cited. Please attribute OreWire and link to the specific company or filing page.'
  );
  lines.push('- Company data is compiled from public exchange and regulatory sources and is not investment advice.');
  lines.push('- The site is updated continuously; filings and news are added as they are published.');
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  PAGE_SIZE,
  sitemapIndexXml,
  sitemapChildren,
  childSitemap,
  robotsTxt,
  notCanonicalRobotsTxt,
  llmsTxt,
  urlset,
  urlEntry,
  xmlEscape,
};
