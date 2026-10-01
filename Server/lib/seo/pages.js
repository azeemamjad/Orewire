'use strict';

/**
 * Server rendered HTML documents for crawlers.
 *
 * OreWire's public site is a client rendered React SPA. Crawlers that do not run
 * JavaScript (most AI and social crawlers, and every LLM fetcher) previously saw
 * one generic <title> and an empty <div id="root">. These functions produce the
 * fully populated document that nginx serves instead when the request comes from
 * a crawler — a technique Google documents as dynamic rendering.
 *
 * The content here is derived from the same database rows the SPA renders from
 * the API, so the crawler view and the user view agree on every fact.
 */

const { escapeHtml, escapeJson, summarise, absoluteUrl, companyUrl, companyLegacySlug, compactNumber, isoDay, newsUrl, filingUrl, hasSubstantiveSummary } = require('./util');
const schema = require('./schema');
const { siteOrigin } = require('./util');
const { HUB_EXCHANGES } = require('./data');

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;background:#fff}
a{color:#0b5cab}
header.site{border-bottom:1px solid #e5e7eb;padding:14px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header.site a{font-weight:600;text-decoration:none}
nav.crumbs{font-size:13px;color:#666;padding:12px 20px 0}
nav.crumbs a{color:#666}
main{max-width:860px;margin:0 auto;padding:20px}
h1{font-size:30px;line-height:1.25;margin:0 0 6px}
h2{font-size:20px;margin:32px 0 10px;border-bottom:1px solid #eee;padding-bottom:6px}
h3{font-size:16px;margin:18px 0 6px}
p.lede{font-size:17px;color:#333}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top}
th{color:#555;font-weight:600;width:210px}
ul,ol{padding-left:22px}
li{margin:5px 0}
.meta{color:#666;font-size:13px}
.tag{display:inline-block;border:1px solid #ddd;border-radius:3px;padding:1px 7px;font-size:12px;margin:0 5px 5px 0}
footer.site{border-top:1px solid #e5e7eb;margin-top:40px;padding:22px 20px;font-size:13px;color:#666}
footer.site a{margin-right:14px}
.q{font-weight:600;margin:14px 0 2px}
@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e8eaed}a{color:#7cb7ff}th,td{border-color:#262a31}h2{border-color:#262a31}header.site,footer.site{border-color:#262a31}.meta,nav.crumbs{color:#9aa0a6}}
`.trim();

/** Shared chrome. `crumbs` is an array of { name, path }. */
function layout({ title, description, canonicalPath, robots, ogType = 'website', image, jsonLd, crumbs = [], bodyHtml }) {
  const canonical = absoluteUrl(canonicalPath);
  const graph = schema.graphScript(jsonLd);
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs
        .map((c, i) =>
          i === crumbs.length - 1
            ? `<span aria-current="page">${escapeHtml(c.name)}</span>`
            : `<a href="${escapeHtml(absoluteUrl(c.path))}">${escapeHtml(c.name)}</a> › `
        )
        .join('')}</nav>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="${escapeHtml(robots)}">
<meta property="og:type" content="${escapeHtml(ogType)}">
<meta property="og:site_name" content="OreWire">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
<link rel="icon" href="/favicon.ico">
${graph}
<style>${STYLE}</style>
</head>
<body>
<header class="site">
  <a href="${escapeHtml(siteOrigin())}/">OreWire</a>
  <a href="${escapeHtml(siteOrigin())}/companies">Companies</a>
  <a href="${escapeHtml(siteOrigin())}/filings">Filings</a>
  <a href="${escapeHtml(siteOrigin())}/news">News</a>
  <a href="${escapeHtml(siteOrigin())}/market-news">Market news</a>
</header>
${crumbHtml}
<main>
${bodyHtml}
</main>
<footer class="site">
  <p>OreWire publishes stock prices, decoded regulatory filings and news release summaries for mining and resource companies across the TSX, TSX-V, CSE and ASX.</p>
  <p>
    <a href="${escapeHtml(siteOrigin())}/companies">All companies</a>
    <a href="${escapeHtml(siteOrigin())}/filings">Filings</a>
    <a href="${escapeHtml(siteOrigin())}/news">News releases</a>
    <a href="${escapeHtml(siteOrigin())}/market-news">Market news</a>
    <a href="${escapeHtml(siteOrigin())}/contact">Contact</a>
  </p>
  <p>Information on OreWire is for general information only and is not investment advice.</p>
</footer>
</body>
</html>`;
}

function factRows(pairs) {
  const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return '';
  return `<table><tbody>${rows
    .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${v}</td></tr>`)
    .join('')}</tbody></table>`;
}

function filingListHtml(filings) {
  if (!filings || !filings.length) return '';
  return `<h2>Recent filings</h2>
<table><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Summary</th></tr></thead><tbody>
${filings
  .map((f) => {
    const date = isoDay(f.created_at) || '';
    const type = escapeHtml(f.filing_type || f.commodity || 'Filing');
    const sum = escapeHtml(summarise(f.summary || f.verdict || '', 220));
    return `<tr><td><a href="${escapeHtml(absoluteUrl('/filings/' + f.id))}">${escapeHtml(date)}</a></td><td>${type}</td><td>${sum}</td></tr>`;
  })
  .join('\n')}
</tbody></table>`;
}

function newsListHtml(news) {
  if (!news || !news.length) return '';
  return `<h2>Recent news releases</h2>
<ul>
${news
  .map((n) => {
    const date = isoDay(n.pub_date || n.created_at) || '';
    const href = newsUrl(n);
    return `<li><a href="${escapeHtml(absoluteUrl(href))}">${escapeHtml(n.title)}</a> <span class="meta">${escapeHtml(date)}${n.source ? ' · ' + escapeHtml(n.source) : ''}</span></li>`;
  })
  .join('\n')}
</ul>`;
}

// Same honorific strip the SPA applies before display, in PeopleSection.
const HONORIFIC_RE = /^\s*(mr|mrs|ms|mx|dr|prof|professor|sir|miss|madam|hon)\.?\s+/i;

function peopleGroupHtml(heading, people) {
  if (!people || !people.length) return '';
  return `<h2>${escapeHtml(heading)}</h2>
<ul>
${people
  .map((p) => {
    const stripped = String(p.name || '').replace(HONORIFIC_RE, '').trim();
    const name = stripped || p.name;
    return `<li><strong>${escapeHtml(name)}</strong>${p.title ? ' — ' + escapeHtml(p.title) : ''}${
      p.since_year ? ` <span class="meta">(since ${escapeHtml(String(p.since_year))})</span>` : ''
    }</li>`;
  })
  .join('\n')}
</ul>`;
}

/**
 * Management and board, mirroring the SPA's PeopleSection.
 *
 * The SPA renders these as two separate sections — "Management" for
 * `kind === 'manager'` and "Board of Directors" for `kind === 'director'` — and
 * omits each when it is empty. Emitting a single combined "Management and
 * directors" heading lost both, and a heading is what an answer engine matches a
 * question like "who is on the board of X" against. The grouping is not
 * cosmetic; it is the structure that makes the section answerable.
 *
 * Each section is emitted only when it has members, so a company with managers
 * but no directors (which is common here) does not get an empty heading.
 */
function peopleListHtml(people) {
  const list = Array.isArray(people) ? people : [];
  return [
    peopleGroupHtml('Management', list.filter((p) => p.kind === 'manager')),
    peopleGroupHtml('Board of Directors', list.filter((p) => p.kind === 'director')),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Build the AEO question/answer pairs for a company so answer engines can quote them. */
function companyFaqs(company, filings, news, quote, otherListings) {
  const ex = company.exchange || '';
  const tk = company.ticker || '';
  const listed = ex && tk ? `${ex}:${tk}` : tk || ex || 'not available';
  const qas = [];

  qas.push({
    question: `What is ${company.name}'s stock ticker?`,
    answer: `${company.name} trades under the ticker ${tk || 'n/a'}${ex ? ` on the ${ex}` : ''}.`,
  });

  // Only when a recent cached quote exists. The answer carries the timestamp, so
  // it stays true whenever it is read, and it names no currency because the
  // quote cache does not record one.
  if (quote) {
    qas.push({
      question: `What is ${company.name}'s share price?`,
      answer: `OreWire's most recent quote for ${company.name}${
        ex && tk ? ` (${ex}:${tk})` : ''
      } is ${quote.price}, as of ${quote.stamp} UTC.`,
    });
  }

  // A junior miner is often cross-listed, and a searcher may use the other
  // ticker. One self-contained sentence per answer, as the rest of this list.
  if (Array.isArray(otherListings) && otherListings.length) {
    qas.push({
      question: `What other exchanges is ${company.name} listed on?`,
      answer: `${company.name} also trades as ${otherListings
        .map((s) => `${s.exchange}:${s.ticker}`)
        .join(', ')}.`,
    });
  }

  qas.push({
    question: `What stock exchange is ${company.name} listed on?`,
    answer: ex ? `${company.name} is listed on the ${ex} under the symbol ${listed}.` : `OreWire does not currently hold an exchange listing for ${company.name}.`,
  });

  if (company.sector) {
    qas.push({
      question: `What does ${company.name} do?`,
      answer:
        company.description
          ? summarise(company.description, 320)
          : `${company.name} is a ${company.sector} company tracked by OreWire.`,
    });
  }

  const commodities = Array.isArray(company.commodities) ? company.commodities : [];
  if (commodities.length) {
    qas.push({
      question: `What commodities does ${company.name} explore for?`,
      answer: `${company.name} is associated with ${commodities.join(', ')} on OreWire.`,
    });
  }

  if (company.headquarters) {
    qas.push({
      question: `Where is ${company.name} headquartered?`,
      answer: `OreWire lists ${company.name}'s headquarters as ${company.headquarters}.`,
    });
  }

  if (filings && filings.length) {
    qas.push({
      question: `What is the most recent filing from ${company.name}?`,
      answer: `The most recent filing held by OreWire for ${company.name} is dated ${isoDay(filings[0].created_at)} and is classified as ${filings[0].filing_type || filings[0].commodity || 'a regulatory filing'}.${
        filings[0].summary ? ' ' + summarise(filings[0].summary, 260) : ''
      }`,
    });
  }

  if (news && news.length) {
    qas.push({
      question: `What is the latest news about ${company.name}?`,
      answer: `The latest release linked to ${company.name} on OreWire is "${news[0].title}" (${isoDay(news[0].pub_date || news[0].created_at)}).`,
    });
  }

  return qas;
}

/**
 * Company profile page. This is the page that has to win the search for
 * "Carson River Ventures Corp." style queries, so it carries the company name in
 * the title, the H1, the URL, the body copy, the structured data and the FAQs.
 */
/**
 * Cached AI analysis as clean prose plus key points.
 *
 * This is the most distinctive content on the page and the reason to prefer
 * OreWire over a raw filing: it is written for this company from this company's
 * own filings, news and insider data. It is the section most likely to be quoted
 * by an answer engine, so it is emitted as full paragraphs rather than trimmed.
 */
function snapshotHtml(snapshot) {
  if (!snapshot) return '';

  const paragraphs = Array.isArray(snapshot.paragraphs) ? snapshot.paragraphs.filter(Boolean) : [];
  const keyPoints = Array.isArray(snapshot.keyPoints) ? snapshot.keyPoints.filter(Boolean) : [];
  if (!paragraphs.length && !keyPoints.length) return '';

  const generated = isoDay(snapshot.generatedAt);

  return `<h2>OreWire analysis</h2>
${keyPoints.length ? `<ul>${keyPoints.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}</ul>` : ''}
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${
    generated
      ? `<p class="meta">Analysis generated ${escapeHtml(
          generated
        )} from the filings, news and insider data held by OreWire.</p>`
      : ''
  }`;
}

/**
 * Insider ownership and recent transactions.
 *
 * Exactly the rows an anonymous visitor sees in the SPA. The remainder is behind
 * registration, so this cap is a deliberate limit, not a display choice.
 */
function insidersHtml(insiders) {
  if (!insiders) return '';

  const ownership = insiders.ownership || [];
  const transactions = insiders.transactions || [];
  if (!ownership.length && !transactions.length) return '';

  const num = (value) => (value != null ? Number(value).toLocaleString('en-US') : '');

  const ownershipTable = ownership.length
    ? `<table>
<thead><tr><th scope="col">Holder</th><th scope="col">Title</th><th scope="col">Shares</th><th scope="col">Ownership</th><th scope="col">Last transaction</th></tr></thead>
<tbody>
${ownership
  .map(
    (o) =>
      `<tr><td>${escapeHtml(o.insider_name || '')}</td><td>${escapeHtml(o.title || '')}</td><td>${num(
        o.total_shares
      )}</td><td>${
        o.percent_ownership != null ? escapeHtml(String(o.percent_ownership)) + '%' : ''
      }</td><td>${escapeHtml(isoDay(o.last_transaction_date) || o.last_transaction || '')}</td></tr>`
  )
  .join('\n')}
</tbody>
</table>`
    : '';

  const txTable = transactions.length
    ? `<table>
<thead><tr><th scope="col">Date</th><th scope="col">Insider</th><th scope="col">Type</th><th scope="col">Shares</th><th scope="col">Price</th></tr></thead>
<tbody>
${transactions
  .map(
    (t) =>
      `<tr><td>${escapeHtml(isoDay(t.transaction_date) || '')}</td><td>${escapeHtml(
        t.insider_name || ''
      )}</td><td>${escapeHtml(t.transaction_type || '')}</td><td>${num(t.shares)}</td><td>${
        t.price != null ? escapeHtml(String(t.price)) : ''
      }</td></tr>`
  )
  .join('\n')}
</tbody>
</table>`
    : '';

  return `<h2>Insider ownership</h2>
${ownershipTable}
${
    ownership.length
      ? '<p class="meta">The largest holders OreWire holds on file. Registered users can see the full ownership table and transaction history.</p>'
      : ''
  }
${txTable ? `<h3>Recent insider transactions</h3>${txTable}` : ''}`;
}

/**
 * OreWire's cached share price, when there is a recent one.
 *
 * Four deliberate constraints, and each one is load bearing:
 *
 *  - It is READ from `companies.quote_price`, never fetched. The crawler path
 *    must not make an external call with an unbounded latency.
 *  - **No currency is asserted.** The quote cache has no currency column, and
 *    mining companies listed on the TSX and TSXV are not all reporting in CAD,
 *    so naming one would be wrong for some of them. The interactive profile
 *    shows the reporting currency.
 *  - It is omitted entirely once older than `SEO_QUOTE_MAX_AGE_MINUTES` (24h by
 *    default). The movers board treats 35 minutes as stale, which is right for a
 *    live board; a profile page can carry an older number, but only while it is
 *    still labelled as a timestamped last price rather than a current one.
 *  - It is kept OUT of the JSON-LD. A stale figure surfaced as structured data
 *    could reach a rich result, where the timestamp would be stripped from it.
 */
/**
 * Market capitalisation, computed the way the SPA computes it.
 *
 * `CompanyDetail.tsx` does not display `companies.market_cap` when it has a price
 * and a share count. It computes `displayPrice * sharesOut`, preferring
 * TradingView fundamentals, and only falls back to the stored column:
 *
 *   const sharesOut     = fund?.shares_outstanding ?? data.shares_outstanding ?? data.total_float
 *   const computedMcap  = displayPrice != null && sharesOut != null ? displayPrice * sharesOut : null
 *   const marketCap     = computedMcap ?? fund?.market_cap ?? data.market_cap
 *
 * Publishing the stored column therefore contradicted the page it describes — for
 * Agnico Eagle the stored figure is 141.48B against a computed 132.1B — and it was
 * internally inconsistent with the share count and price printed beside it.
 *
 * Exact equality with a browser is not achievable: the SPA can prefer TradingView
 * fundamentals, fetched live, and its price can come from a live quote rather than
 * the cache. What this guarantees is that the page's own numbers agree with each
 * other, which is what a crawler-served document has to get right.
 */
function marketCapValue(company, quote) {
  const shares = Number(company.shares_outstanding ?? company.total_float);
  const price = quote && Number.isFinite(quote.priceNumeric) ? quote.priceNumeric : null;
  if (price && Number.isFinite(shares) && shares > 0) return price * shares;
  return company.market_cap;
}

function quoteSummary(company) {
  if (!company || company.quote_price == null) return null;

  const updatedAt = company.quote_updated_at ? new Date(company.quote_updated_at) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return null;

  const configured = Number(process.env.SEO_QUOTE_MAX_AGE_MINUTES || 1440);
  const maxAgeMinutes = Number.isFinite(configured) && configured > 0 ? configured : 1440;
  if (Date.now() - updatedAt.getTime() > maxAgeMinutes * 60 * 1000) return null;

  const price = Number(company.quote_price);
  // A price of exactly zero means "no data", not a free share. Publishing
  // "0.0000" against a real issuer would be a false statement about its market,
  // and the page would be citing it as the last quote.
  if (!Number.isFinite(price) || price <= 0) return null;

  // Sub-dollar small caps need more precision than a dollar-plus price. The same
  // precision is used for the absolute change, so the two read consistently.
  const dp = price < 1 ? 4 : 2;

  return {
    price: price.toFixed(dp),
    // The numeric value, for anything that must compute rather than display.
    // `price` stays a formatted string for rendering.
    priceNumeric: price,
    dp,
    changePct:
      company.quote_change_pct != null && Number.isFinite(Number(company.quote_change_pct))
        ? Number(company.quote_change_pct)
        : null,
    changeAbs:
      company.quote_change_abs != null && Number.isFinite(Number(company.quote_change_abs))
        ? Number(company.quote_change_abs)
        : null,
    volume:
      company.quote_volume != null && Number.isFinite(Number(company.quote_volume))
        ? Number(company.quote_volume)
        : null,
    stamp: updatedAt.toISOString().replace('T', ' ').slice(0, 16),
  };
}

function quoteHtml(quote, company) {
  if (!quote) return '';

  const bits = [`<strong>${escapeHtml(quote.price)}</strong>`];
  if (quote.changePct != null) {
    const sign = quote.changePct > 0 ? '+' : '';
    bits.push(`change ${escapeHtml(sign + quote.changePct.toFixed(2))}%`);
  }
  if (quote.changeAbs != null) {
    const sign = quote.changeAbs > 0 ? '+' : '';
    bits.push(`${escapeHtml(sign + quote.changeAbs.toFixed(quote.dp))}`);
  }
  if (quote.volume != null) {
    bits.push(`volume ${quote.volume.toLocaleString('en-US')}`);
  }

  return `<h2>Share price</h2>
<p>The most recent quote OreWire holds for ${escapeHtml(company.name)} is ${bits.join(', ')}, as of ${escapeHtml(
    quote.stamp
  )} UTC.</p>
<p class="meta">This is the last price OreWire recorded, not a live quote, and no currency is asserted here. The interactive profile shows the current price and the company's reporting currency.</p>`;
}

function renderCompanyPage({ company, filings, news, people, snapshot, insiders, symbols }) {
  const commodities = Array.isArray(company.commodities) ? company.commodities : [];
  const canonicalPath = companyUrl(company.name);
  const legacySlug = companyLegacySlug(company.exchange, company.ticker);

  const listed = company.exchange && company.ticker ? `${company.exchange}:${company.ticker}` : company.ticker || '';
  // Deliberately does NOT say "stock price". The crawled HTML carries market
  // capitalisation, shares outstanding, exchange and ticker, but not a live
  // quote: fetching one here would put an external call with no latency
  // guarantee on the crawler path. Overclaiming in a title is a real quality
  // problem, so the title promises exactly what the page delivers.
  const title = `${company.name}${listed ? ` (${listed})` : ''} Filings, News & Company Profile | OreWire`;
  const description = summarise(
    company.description ||
      `${company.name}${listed ? ` (${listed})` : ''} company profile on OreWire: market capitalisation, share data, decoded regulatory filings, management and news release summaries${
        commodities.length ? ` for ${commodities.join(', ')}` : ''
      }.`,
    155
  );

  const lede = `${company.name}${listed ? ` trades as ${listed}` : ''}${
    company.sector ? `, a ${company.sector.toLowerCase()} company` : ''
  }${company.headquarters ? ` headquartered in ${company.headquarters}` : ''}. This page collects the OreWire profile, the latest regulatory filings and the most recent news releases for the company.`;

  // Secondary listings only. The primary one is already the Exchange and Ticker
  // rows, and a company with a single listing should not show a duplicated one.
  const primaryExchange = String(company.exchange || '').toUpperCase();
  const primaryTicker = String(company.ticker || '').toUpperCase();
  const otherListings = (Array.isArray(symbols) ? symbols : []).filter(
    (s) =>
      s &&
      s.exchange &&
      s.ticker &&
      !(String(s.exchange).toUpperCase() === primaryExchange &&
        String(s.ticker).toUpperCase() === primaryTicker)
  );

  // Computed before the facts table because market capitalisation needs it.
  const quote = quoteSummary(company);

  const facts = factRows([
    ['Exchange', escapeHtml(company.exchange || '')],
    ['Ticker', escapeHtml(company.ticker || '')],
    ['SEDAR ticker', escapeHtml(company.sedar_ticker || '')],
    [
      'Other listings',
      otherListings
        .map((s) => `<span class="tag">${escapeHtml(s.exchange)}:${escapeHtml(s.ticker)}</span>`)
        .join(''),
    ],
    ['Sector', escapeHtml(company.sector || '')],
    ['Commodities', commodities.length ? commodities.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join('') : ''],
    ['Headquarters', escapeHtml(company.headquarters || '')],
    ['Country', escapeHtml(company.country || '')],
    ['Market capitalisation', escapeHtml(compactNumber(marketCapValue(company, quote)) || '')],
    // total_float is the fallback the SPA uses for the same figure
    // (`data.shares_outstanding ?? data.total_float`), so the two agree when
    // one column is empty. `listing_date` and `region` exist on the row but are
    // deliberately not published, because the SPA does not surface them either.
    ['Shares outstanding', escapeHtml(compactNumber(company.shares_outstanding ?? company.total_float) || '')],
    // The SPA labels this "Share Registry" for ASX issuers and
    // "Transfer Agent / Share Registry" otherwise (TransferAgentBlock in
    // CompanyDetail.tsx), so the crawler uses the same wording rather than
    // inventing a third one.
    [
      String(company.exchange || '').toUpperCase() === 'ASX'
        ? 'Share Registry'
        : 'Transfer Agent / Share Registry',
      escapeHtml(company.transfer_agent || ''),
    ],
    [
      'Website',
      company.website
        ? `<a href="${escapeHtml(company.website)}" rel="nofollow noopener" target="_blank">${escapeHtml(company.website.replace(/^https?:\/\//, ''))}</a>`
        : '',
    ],
    ['Phone', escapeHtml(company.phone || '')],
  ]);

  const faqs = companyFaqs(company, filings, news, quote, otherListings);
  const faqHtml = faqs.length
    ? `<h2>Frequently asked questions</h2>${faqs
        .map(
          (qa) =>
            `<p class="q">${escapeHtml(qa.question)}</p><p>${escapeHtml(qa.answer)}</p>`
        )
        .join('\n')}`
    : '';

  const jsonLd = [
    schema.organizationNode(),
    schema.websiteNode(),
    schema.corporationNode(company),
    schema.breadcrumbNode([
      { name: 'Home', path: '/' },
      { name: 'Companies', path: '/companies' },
      { name: company.name, path: canonicalPath },
    ]),
    schema.faqNode(faqs),
  ];

  if (news && news.length) {
    jsonLd.push(...news.slice(0, 5).map((n) => schema.newsArticleNode({ ...n, company_name: company.name })));
  }

  const bodyHtml = `
<h1>${escapeHtml(company.name)}${listed ? ` (${escapeHtml(listed)})` : ''}</h1>
<p class="lede">${escapeHtml(lede)}</p>
${quoteHtml(quote, company)}
<h2>Company profile</h2>
${facts || '<p class="meta">OreWire has no profile details for this company yet.</p>'}
${
  company.description
    ? `<h3>About ${escapeHtml(company.name)}</h3><p>${escapeHtml(company.description)}</p>`
    : ''
}
${snapshotHtml(snapshot)}
${contextLinksHtml(company, commodities)}
${peopleListHtml(people)}
${filingListHtml(filings)}
${newsListHtml(news)}
${insidersHtml(insiders)}
${faqHtml}
<p class="meta">Company data on OreWire is compiled from public exchange and regulatory sources${
    legacySlug ? ` and is also reachable at /company/${escapeHtml(legacySlug)}` : ''
  }. Nothing here is investment advice.</p>`;

  return layout({
    title,
    description,
    canonicalPath,
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    ogType: 'website',
    jsonLd,
    crumbs: [
      { name: 'Home', path: '/' },
      { name: 'Companies', path: '/companies' },
      { name: company.name, path: canonicalPath },
    ],
    bodyHtml,
  });
}

/**
 * Upward internal links from a company profile to its hubs.
 *
 * These are the links that let a crawler walk from the index down to a profile
 * and back up again, instead of relying on the sitemap alone.
 */
function contextLinksHtml(company, commodities) {
  const parts = [];

  if (commodities.length) {
    parts.push(
      `<h3>Commodity exposure</h3><p>${escapeHtml(company.name)} is tracked by OreWire under ${commodities
        .map(
          (c) =>
            `<a href="${escapeHtml(absoluteUrl(companiesIndexPath({ hub: { commodity: c } })))}">${escapeHtml(c)}</a>`
        )
        .join(', ')}.</p>`
    );
  }

  const raw = String(company.exchange || '').toUpperCase();
  const exchange = raw === 'TSX-V' ? 'TSXV' : raw;
  if (exchange && HUB_EXCHANGES.includes(exchange)) {
    parts.push(
      `<p>See <a href="${escapeHtml(
        absoluteUrl(companiesIndexPath({ hub: { exchange } }))
      )}">all mining and resource companies listed on the ${escapeHtml(exchange)}</a>.</p>`
    );
  }

  const continents = Array.isArray(company.continents) ? company.continents : [];
  if (continents.length) {
    parts.push(
      `<p>Operating region: ${continents
        .map(
          (c) =>
            `<a href="${escapeHtml(absoluteUrl(companiesIndexPath({ hub: { continent: c } })))}">${escapeHtml(c)}</a>`
        )
        .join(', ')}.</p>`
    );
  }

  return parts.join('\n');
}

/**
 * Canonical path for the company index, hub or not, at any page number.
 *
 * Built by hand rather than with `URLSearchParams` on purpose. URLSearchParams
 * serialises with application/x-www-form-urlencoded, encoding a space as `+`,
 * while the sitemap builds these same URLs with `encodeURIComponent`, which gives
 * `%20`. Three hub values contain a space — `Rare Earths`, `North America` and
 * `South America` — so the sitemap advertised `/companies?commodity=Rare%20Earths`
 * while the page declared its canonical to be `…Rare+Earths`. Two URLs for one
 * page, and the sitemap disagreeing with the canonical it points at.
 *
 * Parameter order (commodity, exchange, continent, page) must match the SPA's
 * builder in `Companies.tsx` exactly, or the two views emit different canonicals
 * for the same hub.
 */
function companiesIndexPath({ hub, page } = {}) {
  const parts = [];
  if (hub && hub.commodity) parts.push(`commodity=${encodeURIComponent(hub.commodity)}`);
  if (hub && hub.exchange) parts.push(`exchange=${encodeURIComponent(hub.exchange)}`);
  if (hub && hub.continent) parts.push(`continent=${encodeURIComponent(hub.continent)}`);
  if (page && page > 1) parts.push(`page=${page}`);
  return parts.length ? `/companies?${parts.join('&')}` : '/companies';
}

/**
 * Hub cross-links.
 *
 * These turn the index into a crawl hub: every company profile links up to a
 * commodity and an exchange hub, and each hub links back down to the profiles.
 * Without that, discovery of ~2,000 pages depends entirely on the sitemap.
 */
function hubLinksHtml(hub, hubLinks) {
  if (!hubLinks) return '';
  const commodities = hubLinks.commodities || [];
  const exchanges = hubLinks.exchanges || [];
  const parts = [];

  if (commodities.length) {
    parts.push(
      `<h2>Browse by commodity</h2><p>${commodities
        .map((c) =>
          hub && c === hub.commodity
            ? `<strong>${escapeHtml(c)}</strong>`
            : `<a href="${escapeHtml(absoluteUrl(companiesIndexPath({ hub: { commodity: c } })))}">${escapeHtml(c)}</a>`
        )
        .join(' · ')}</p>`
    );
  }

  if (exchanges.length) {
    parts.push(
      `<h2>Browse by exchange</h2><p>${exchanges
        .map((e) =>
          hub && e === hub.exchange
            ? `<strong>${escapeHtml(e)}</strong>`
            : `<a href="${escapeHtml(absoluteUrl(companiesIndexPath({ hub: { exchange: e } })))}">${escapeHtml(e)}</a>`
        )
        .join(' · ')}</p>`
    );
  }

  const continents = hubLinks.continents || [];
  if (continents.length) {
    parts.push(
      `<h2>Browse by region</h2><p>${continents
        .map((c) =>
          hub && c === hub.continent
            ? `<strong>${escapeHtml(c)}</strong>`
            : `<a href="${escapeHtml(absoluteUrl(companiesIndexPath({ hub: { continent: c } })))}">${escapeHtml(c)}</a>`
        )
        .join(' · ')}</p>`
    );
  }

  return parts.join('\n');
}

/**
 * Citable aggregate statistics for the index hub.
 *
 * Published as a real <table> with a complete question as the heading and a
 * plain sentence above it, because that is the shape both search engines and
 * language models can lift intact. Counts only: see the note in
 * lib/seo/data.js about why a combined market capitalisation is not published.
 */
function commodityStatsHtml(stats) {
  if (!stats || !stats.byCommodity || !stats.byCommodity.length) return '';

  const rows = stats.byCommodity
    .map(
      (entry) =>
        `<tr><td><a href="${escapeHtml(
          absoluteUrl(companiesIndexPath({ hub: { commodity: entry.commodity } }))
        )}">${escapeHtml(entry.commodity)}</a></td><td>${entry.count.toLocaleString('en-US')}</td></tr>`
    )
    .join('\n');

  return `<h2>How many mining companies does OreWire track for each commodity?</h2>
<p>OreWire tracks ${stats.total.toLocaleString('en-US')} mining and resource companies in total. The table shows how many of them are active in each commodity.</p>
<table>
<thead><tr><th scope="col">Commodity</th><th scope="col">Companies</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/** Exchange breakdown for a hub, answering "where are these companies listed?". */
function exchangeBreakdownHtml(rows, hub) {
  if (!rows || !rows.length) return '';

  const subject =
    hub && hub.commodity
      ? `${hub.commodity.toLowerCase()} companies`
      : hub && hub.continent
        ? `companies operating in ${hub.continent}`
        : 'mining and resource companies';
  const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const body = rows
    .map((r) => `<tr><td>${escapeHtml(r.exchange)}</td><td>${r.count.toLocaleString('en-US')}</td></tr>`)
    .join('\n');

  return `<h2>Which exchanges are ${escapeHtml(subject)} listed on?</h2>
<p>OreWire lists ${totalCount.toLocaleString('en-US')} ${escapeHtml(subject)} across the following exchanges.</p>
<table>
<thead><tr><th scope="col">Exchange</th><th scope="col">Companies</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

/**
 * Answer-engine questions for the index and its hub pages. Each answer is one
 * self-contained sentence carrying the number, so it can be quoted verbatim.
 */
function companiesIndexFaqs({ total, hub, stats }) {
  const count = Number(total || 0).toLocaleString('en-US');
  const faqs = [];

  if (hub && hub.commodity) {
    const lower = String(hub.commodity).toLowerCase();
    faqs.push({
      question: `How many ${lower} companies does OreWire track?`,
      answer: `OreWire tracks ${count} ${lower} mining and exploration companies listed on the TSX, TSX-V, CSE and ASX.`,
    });
  } else if (hub && hub.continent) {
    faqs.push({
      question: `How many mining companies operate in ${hub.continent}?`,
      answer: `OreWire tracks ${count} mining, exploration and resource companies operating in ${hub.continent}.`,
    });
  } else if (hub && hub.exchange) {
    faqs.push({
      question: `How many mining companies are listed on the ${hub.exchange}?`,
      answer: `OreWire tracks ${count} mining and resource companies listed on the ${hub.exchange}.`,
    });
  } else {
    // Reached only when there is genuinely no hub filter, so `count` really is
    // the whole catalogue. A continent hub used to fall through to here and
    // published its regional count as the site-wide total.
    faqs.push({
      question: 'How many mining companies does OreWire track?',
      answer: `OreWire tracks ${count} mining, exploration and resource companies listed on the TSX, TSX-V, CSE and ASX.`,
    });
  }

  if (stats && stats.byCommodity && stats.byCommodity.length) {
    const top = stats.byCommodity[0];
    faqs.push({
      question: 'Which commodity has the most mining companies on OreWire?',
      answer: `${top.commodity} has the most, with ${top.count.toLocaleString('en-US')} companies tracked by OreWire.`,
    });
  }

  faqs.push({
    question: 'Which stock exchanges do the companies on OreWire trade on?',
    answer:
      'OreWire covers companies listed on the TSX and TSX-V in Canada, the CSE in Canada and the ASX in Australia.',
  });

  return faqs;
}

/**
 * Robots directive for a paginated listing.
 *
 * Page one is the page worth ranking. Everything after it is a thin slice of the
 * same list, and there are roughly 380 paginated hub pages across commodities,
 * exchanges and regions — letting all of them into the index spends crawl and
 * index budget on pages that will never win a query, at the expense of the
 * company profiles that can.
 *
 * They stay `follow` on purpose. Discovery of deeper companies then still works
 * through the pager links, and every profile is listed in the sitemap anyway, so
 * nothing becomes unreachable.
 */
function listingRobots(page) {
  return page > 1 ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1';
}

function renderCompaniesIndexPage({ companies, page, totalPages, total, hub, hubLinks, stats, exchangeCounts }) {
  const commodity = (hub && hub.commodity) || null;
  const exchange = (hub && hub.exchange) || null;
  const continent = (hub && hub.continent) || null;
  const canonicalPath = companiesIndexPath({ hub, page });
  const pageSuffix = page > 1 ? ` (page ${page} of ${totalPages})` : '';
  const count = total.toLocaleString('en-US');

  let title;
  let heading;
  let lede;

  if (commodity) {
    title = `${commodity} Mining and Exploration Companies${pageSuffix} | OreWire`;
    heading = `${commodity} mining and exploration companies`;
    lede = `OreWire tracks ${count} ${String(commodity).toLowerCase()} companies listed on the TSX, TSX-V, CSE and ASX, each with stock data, decoded regulatory filings and news release summaries.`;
  } else if (continent) {
    title = `Mining and Resource Companies in ${continent}${pageSuffix} | OreWire`;
    heading = `Mining and resource companies in ${continent}`;
    lede = `OreWire tracks ${count} mining, exploration and resource companies operating in ${continent}, each with stock data, decoded regulatory filings and news release summaries.`;
  } else if (exchange) {
    title = `Mining and Resource Companies on the ${exchange}${pageSuffix} | OreWire`;
    heading = `Mining and resource companies listed on the ${exchange}`;
    lede = `OreWire tracks ${count} mining and resource companies listed on the ${exchange}, each with stock data, decoded regulatory filings and news release summaries.`;
  } else {
    title =
      page > 1
        ? `Mining and Resource Companies (page ${page} of ${totalPages}) | OreWire`
        : `Mining and Resource Companies Listed on TSX, TSX-V, CSE and ASX | OreWire`;
    heading = 'Mining and resource companies';
    lede = `OreWire tracks ${count} mining, exploration and resource companies across the TSX, TSX-V, CSE and ASX. Each profile collects the company's stock data, regulatory filings and news releases.`;
  }

  const description = summarise(lede, 155);

  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Companies', path: '/companies' },
  ];
  if (commodity || exchange || continent) {
    crumbs.push({
      name: commodity || (continent ? `Companies in ${continent}` : `${exchange} listed`),
      path: canonicalPath,
    });
  }

  const bodyHtml = `
<h1>${escapeHtml(heading)}</h1>
<p class="lede">${escapeHtml(lede)}</p>
<ul>
${companies
  .map((c) => {
    const listed = c.exchange && c.ticker ? ` (${c.exchange}:${c.ticker})` : '';
    const tags = Array.isArray(c.commodities) && c.commodities.length
      ? ` <span class="meta">${escapeHtml(c.commodities.join(', '))}</span>`
      : '';
    return `<li><a href="${escapeHtml(absoluteUrl(companyUrl(c.name)))}">${escapeHtml(c.name)}</a>${escapeHtml(listed)}${tags}</li>`;
  })
  .join('\n')}
</ul>
${pagerHtml({ hub, page, totalPages })}
${page === 1 ? commodityStatsHtml(stats) : ''}
${page === 1 ? exchangeBreakdownHtml(exchangeCounts, hub) : ''}
${hubLinksHtml(hub, hubLinks)}`;

  const indexFaqs = page === 1 ? companiesIndexFaqs({ total, hub, stats }) : [];

  return layout({
    title,
    description,
    canonicalPath,
    // An empty hub must not be indexed. This is reachable, not theoretical:
    // `?commodity=Cobalt` returns total 0 in production, and `staticEntries()`
    // lists every commodity unconditionally — so an empty list was being submitted
    // to Google as an indexable page. Same guard section 3.23 added for the news
    // index, which was never applied to the hubs.
    //
    // The sitemap should also stop advertising empty hubs. That needs commodity
    // and continent counts plumbed into staticEntries(), and is recorded as a
    // follow-up rather than attempted here.
    robots: total === 0 ? 'noindex, follow' : listingRobots(page),
    jsonLd: [
      schema.organizationNode(),
      schema.websiteNode(),
      schema.breadcrumbNode(crumbs),
      ...(page === 1 && stats && stats.total
        ? [
            schema.datasetNode({
              name: 'Mining and resource company counts by commodity on OreWire',
              description: `Counts of the ${stats.total} mining and resource companies OreWire tracks, grouped by commodity.`,
              path: canonicalPath,
              keywords: ['mining companies', 'commodity', 'TSX', 'TSXV', 'CSE', 'ASX'],
            }),
          ]
        : []),
      schema.faqNode(indexFaqs),
    ],
    crumbs,
    bodyHtml,
  });
}

function pagerHtml({ hub, page, totalPages }) {
  const path = (target) => absoluteUrl(companiesIndexPath({ hub, page: target }));
  const parts = [];
  if (page > 1) parts.push(`<a href="${escapeHtml(path(page - 1))}">← Previous</a>`);
  parts.push(`<span class="meta">Page ${page} of ${totalPages}</span>`);
  if (page < totalPages) parts.push(`<a href="${escapeHtml(path(page + 1))}">Next →</a>`);
  return `<p>${parts.join(' &nbsp; ')}</p>`;
}

/** Generic pager for the non-hub list pages. */
function simplePagerHtml(basePath, page, totalPages) {
  const parts = [];
  if (page > 1) parts.push(`<a href="${escapeHtml(absoluteUrl(`${basePath}?page=${page - 1}`))}">← Previous</a>`);
  parts.push(`<span class="meta">Page ${page} of ${totalPages}</span>`);
  if (page < totalPages) parts.push(`<a href="${escapeHtml(absoluteUrl(`${basePath}?page=${page + 1}`))}">Next →</a>`);
  return `<p>${parts.join(' &nbsp; ')}</p>`;
}

/**
 * The news index.
 *
 * This exists because nginx proxies crawler requests for `/news` to the
 * renderer, and `/news` is listed in the sitemap. Without a route here that URL
 * answered 404 to every crawler: a sitemap advertising a Not Found page.
 */
function renderNewsIndexPage({ items, page, totalPages, total }) {
  const canonicalPath = page > 1 ? `/news?page=${page}` : '/news';
  const title =
    page > 1
      ? `Mining and Resource News Releases (page ${page} of ${totalPages}) | OreWire`
      : 'Mining and Resource News Releases | OreWire';
  const description = summarise(
    `Browse ${total.toLocaleString('en-US')} mining and resource company news releases, each summarised in plain English by OreWire.`,
    155
  );

  const bodyHtml = `
<h1>Mining and resource news releases</h1>
<p class="lede">OreWire summarises ${total.toLocaleString(
    'en-US'
  )} news releases from mining, exploration and resource companies listed on the TSX, TSX-V, CSE and ASX.</p>
${
    total === 0
      ? '<p class="meta">No release currently carries a substantive summary. OreWire publishes a release page only when it has real content for it.</p>'
      : ''
  }
<ul>
${items
  .map((n) => {
    const date = isoDay(n.pub_date || n.created_at) || '';
    // The SPA's news rows carry the company and its ticker above the title
    // (News.tsx), and the crawler was showing the title alone. The ticker falls
    // back to the company's own because news_releases.ticker is not always set.
    const meta = [n.ticker, n.company_name, date].filter(Boolean);
    return `<li><a href="${escapeHtml(absoluteUrl(newsUrl(n)))}">${escapeHtml(n.title)}</a>${
      meta.length ? ` <span class="meta">${escapeHtml(meta.join(' · '))}</span>` : ''
    }</li>`;
  })
  .join('\n')}
</ul>
${simplePagerHtml('/news', page, totalPages)}`;

  return layout({
    title,
    description,
    canonicalPath,
    // An index with nothing on it must not be indexed. This is reachable rather
    // than theoretical: the thin-summary filter (section 3.20) can legitimately
    // reduce the news set to zero, and an empty list is a soft 404.
    robots: total === 0 ? 'noindex, follow' : listingRobots(page),
    jsonLd: [
      schema.organizationNode(),
      schema.websiteNode(),
      schema.breadcrumbNode([
        { name: 'Home', path: '/' },
        { name: 'News', path: canonicalPath },
      ]),
    ],
    crumbs: [
      { name: 'Home', path: '/' },
      { name: 'News', path: '/news' },
    ],
    bodyHtml,
  });
}

/** The filings index, for the same reason as the news index above. */
function renderFilingsIndexPage({ filings, page, totalPages, total }) {
  const canonicalPath = page > 1 ? `/filings?page=${page}` : '/filings';
  const title =
    page > 1
      ? `Decoded Mining Filings (page ${page} of ${totalPages}) | OreWire`
      : 'Decoded Mining and Resource Filings | OreWire';
  const description = summarise(
    `Browse ${total.toLocaleString('en-US')} mining and resource regulatory filings decoded and graded by OreWire.`,
    155
  );

  const rows = filings
    .map((f) => {
      const company = f.company_canonical_name || f.company_name || '';
      const ticker = f.company_ticker ? ` (${escapeHtml(f.company_ticker)})` : '';
      return `<tr><td><a href="${escapeHtml(absoluteUrl(filingUrl(f.id)))}">${escapeHtml(
        isoDay(f.created_at) || ''
      )}</a></td><td>${company ? `<a href="${escapeHtml(absoluteUrl(companyUrl(company)))}">${escapeHtml(company)}</a>${ticker}` : ''}</td><td>${escapeHtml(
        f.filing_type || ''
      )}</td></tr>`;
    })
    .join('\n');

  const bodyHtml = `
<h1>Decoded mining and resource filings</h1>
<p class="lede">OreWire decodes ${total.toLocaleString('en-US')} regulatory filings from mining and resource companies, summarising what was filed and what it means.</p>
<table>
<thead><tr><th scope="col">Filed</th><th scope="col">Company</th><th scope="col">Type</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${simplePagerHtml('/filings', page, totalPages)}`;

  return layout({
    title,
    description,
    canonicalPath,
    robots: listingRobots(page),
    jsonLd: [
      schema.organizationNode(),
      schema.websiteNode(),
      schema.breadcrumbNode([
        { name: 'Home', path: '/' },
        { name: 'Filings', path: canonicalPath },
      ]),
    ],
    crumbs: [
      { name: 'Home', path: '/' },
      { name: 'Filings', path: '/filings' },
    ],
    bodyHtml,
  });
}

/**
 * The market news index.
 *
 * Listed in the sitemap and reachable by a person through the SPA, but until
 * now it was not proxied to the renderer, so a crawler that does not run
 * JavaScript got the empty SPA shell. Items link out to the publisher with
 * rel="nofollow noopener", matching how the SPA renders them.
 */
function renderMarketNewsIndexPage({ items, page, totalPages, total }) {
  const canonicalPath = page > 1 ? `/market-news?page=${page}` : '/market-news';
  const title =
    page > 1
      ? `Commodity and Market News (page ${page} of ${totalPages}) | OreWire`
      : 'Commodity and Market News for Mining Investors | OreWire';
  const description = summarise(
    `Commodity, metals and market headlines relevant to mining investors, curated by OreWire. ${total.toLocaleString(
      'en-US'
    )} items indexed.`,
    155
  );

  const bodyHtml = `
<h1>Commodity and market news</h1>
<p class="lede">OreWire indexes ${total.toLocaleString(
    'en-US'
  )} commodity, metals and market headlines relevant to mining and resource investors. Each item links to the original publisher.</p>
<ul>
${items
  .map((n) => {
    const date = isoDay(n.pub_date || n.created_at) || '';
    const meta = [n.source, n.commodity, date].filter(Boolean).join(' · ');
    const company = n.company_name
      ? ` <span class="meta">about <a href="${escapeHtml(
          absoluteUrl(companyUrl(n.company_name))
        )}">${escapeHtml(n.company_name)}</a></span>`
      : '';
    // An item with no usable link renders as plain text. Emitting href="#" would
    // hand a crawler a self-referential link, and the SPA renders no anchor in
    // that case either.
    const titleHtml =
      n.link && /^https?:\/\//i.test(String(n.link))
        ? `<a href="${escapeHtml(n.link)}" rel="nofollow noopener" target="_blank">${escapeHtml(n.title)}</a>`
        : escapeHtml(n.title);
    return `<li>${titleHtml} <span class="meta">${escapeHtml(meta)}</span>${company}</li>`;
  })
  .join('\n')}
</ul>
${simplePagerHtml('/market-news', page, totalPages)}`;

  return layout({
    title,
    description,
    canonicalPath,
    robots: listingRobots(page),
    jsonLd: [
      schema.organizationNode(),
      schema.websiteNode(),
      schema.breadcrumbNode([
        { name: 'Home', path: '/' },
        { name: 'Market news', path: canonicalPath },
      ]),
    ],
    crumbs: [
      { name: 'Home', path: '/' },
      { name: 'Market news', path: '/market-news' },
    ],
    bodyHtml,
  });
}

function renderNewsPage({ item }) {
  const canonicalPath = newsUrl(item);
  const title = `${item.title} | OreWire`;
  const description = summarise(item.summary || item.description || item.title, 155);
  const bodyParts = String(item.summary || item.description || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const bodyHtml = `
<h1>${escapeHtml(item.title)}</h1>
<p class="meta">${escapeHtml(isoDay(item.pub_date || item.created_at) || '')}${
    item.source ? ' · ' + escapeHtml(item.source) : ''
  }${item.commodity ? ' · ' + escapeHtml(item.commodity) : ''}</p>
${bodyParts.length ? bodyParts.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n') : '<p class="meta">No summary is available for this release yet.</p>'}
${
  item.company_name
    ? `<p>Related company: <a href="${escapeHtml(absoluteUrl(companyUrl(item.company_name)))}">${escapeHtml(item.company_name)}</a></p>`
    : ''
}
${item.link ? `<p><a href="${escapeHtml(item.link)}" rel="nofollow noopener" target="_blank">Read the original release</a></p>` : ''}`;

  return layout({
    title,
    description,
    canonicalPath,
    robots: hasSubstantiveSummary(item)
      ? 'index, follow, max-image-preview:large, max-snippet:-1'
      : 'noindex, follow',
    ogType: 'article',
    jsonLd: [
      schema.organizationNode(),
      schema.websiteNode(),
      schema.newsArticleNode(item),
      schema.breadcrumbNode([
        { name: 'Home', path: '/' },
        { name: 'News', path: '/news' },
        { name: item.title, path: canonicalPath },
      ]),
    ],
    crumbs: [
      { name: 'Home', path: '/' },
      { name: 'News', path: '/news' },
      { name: item.title, path: canonicalPath },
    ],
    bodyHtml,
  });
}

function renderFilingPage({ filing }) {
  const canonicalPath = `/filings/${filing.id}`;
  const companyName = filing.company_canonical_name || filing.company_name;
  const title = `${companyName} — ${filing.filing_type || filing.commodity || 'Filing'} (${isoDay(filing.created_at)}) | OreWire`;
  const description = summarise(
    filing.summary || `${filing.filing_type || 'Regulatory filing'} filed by ${companyName} and decoded by OreWire.`,
    155
  );

  const facts = factRows([
    ['Company', companyName ? `<a href="${escapeHtml(absoluteUrl(companyUrl(companyName)))}">${escapeHtml(companyName)}</a>` : ''],
    ['Ticker', escapeHtml(filing.company_ticker || filing.exchange || '')],
    ['Filing type', escapeHtml(filing.filing_type || '')],
    ['Commodity', escapeHtml(filing.commodity || '')],
    ['Filed', escapeHtml(isoDay(filing.created_at) || '')],
    ['OreWire verdict', escapeHtml(filing.verdict || '')],
    ['Status', escapeHtml(filing.status || '')],
  ]);

  // The section list, order and headings mirror FilingDetail.tsx exactly:
  // AI summary, Why this verdict, Key facts, Resource estimate, Grade commentary,
  // Context, What to watch. Anything the SPA deliberately does not surface (cash
  // position, burn rate, placement pricing, insider holdings) is still left out —
  // re-verified against the component rather than assumed.
  const analysisSection = (heading, body) =>
    body ? `<h2>${escapeHtml(heading)}</h2><p>${escapeHtml(body)}</p>` : '';

  const bodyHtml = `
<h1>${escapeHtml(companyName)} — ${escapeHtml(filing.filing_type || filing.commodity || 'Filing')}</h1>
<p class="meta">Filed ${escapeHtml(isoDay(filing.created_at) || '')}</p>
${analysisSection('AI summary', filing.summary)}
${analysisSection('Why this verdict', filing.verdict_reason)}
${analysisSection('Key facts', filing.key_facts)}
${analysisSection('Resource estimate', filing.resource_estimate)}
${analysisSection('Grade commentary', filing.grade_commentary)}
${analysisSection('Context', filing.context)}
${analysisSection('What to watch', filing.what_to_watch)}
<h2>Filing detail</h2>
${facts}
${
    filing.source_url && /^https?:\/\//i.test(String(filing.source_url))
      ? `<p><a href="${escapeHtml(filing.source_url)}" rel="noopener" target="_blank">View the original filing at the source</a></p>`
      : ''
  }`;

  return layout({
    title,
    description,
    canonicalPath,
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    ogType: 'article',
    jsonLd: [
      schema.organizationNode(),
      schema.websiteNode(),
      schema.filingNode(filing),
      schema.breadcrumbNode([
        { name: 'Home', path: '/' },
        { name: 'Filings', path: '/filings' },
        { name: `${companyName} filing ${filing.id}`, path: canonicalPath },
      ]),
    ],
    crumbs: [
      { name: 'Home', path: '/' },
      { name: 'Filings', path: '/filings' },
      { name: `${companyName} filing`, path: canonicalPath },
    ],
    bodyHtml,
  });
}

/** Generic page used for hand written hub pages (about, hubs, etc.). */
function renderContentPage({ title, description, canonicalPath, heading, bodyHtml: inner, jsonLd = [] }) {
  return layout({
    title,
    description,
    canonicalPath,
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    jsonLd: [schema.organizationNode(), schema.websiteNode(), ...jsonLd],
    crumbs: [
      { name: 'Home', path: '/' },
      { name: heading, path: canonicalPath },
    ],
    bodyHtml: `<h1>${escapeHtml(heading)}</h1>${inner}`,
  });
}

function renderNotFound() {
  return layout({
    title: 'Not found | OreWire',
    description: 'The page you requested could not be found on OreWire.',
    canonicalPath: '/',
    robots: 'noindex, follow',
    jsonLd: [],
    crumbs: [{ name: 'Home', path: '/' }],
    bodyHtml: '<h1>Page not found</h1><p>That company, filing or news item is not in the OreWire index. <a href="/companies">Browse all companies</a>.</p>',
  });
}

module.exports = {
  layout,
  renderCompanyPage,
  renderCompaniesIndexPage,
  companiesIndexPath,
  renderNewsIndexPage,
  renderFilingsIndexPage,
  renderMarketNewsIndexPage,
  renderNewsPage,
  renderFilingPage,
  renderContentPage,
  renderNotFound,
  companyFaqs,
  escapeJson,
};
