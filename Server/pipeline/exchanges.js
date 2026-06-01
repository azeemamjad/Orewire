// Exchange-sourced company profile scraper (replaces MarketScreener).
//
// Pulls profile + people straight from each listing venue's official data feed:
//   • CSE        → webapi-primary.thecse.com securities feed (symbol → clean name)
//                  + the listing page's embedded __NEXT_DATA__ JSON (staticCompanyInfo)
//   • ASX        → asx.api.markitdigital.com /about (+ /header, /key-statistics)
//   • TSX / TSXV → app-money.tmx.com GraphQL getQuoteBySymbol
//
// Each scraper returns the same shape so the enrichment runner is source-agnostic:
//   { source, matched, profile: { description, website, headquarters,
//       transfer_agent, phone, shares_outstanding, sector, listing_date, market_cap },
//     people: [ { name, title, kind, role_code } ] }
//
// Field coverage (some issuers leave fields blank — that is expected, not an error):
//   description  website  HQ   transfer_agent/registry  officers/directors  shares
//   CSE   ✓        ✓       ✓    ✓                         ✓                   ✓
//   ASX   ✓        ✓       ✓    ✓ (share registry)        ✓                   ✓
//   TMX   ✓        ✓       ✓    ✗ (not published by TMX)  ✗ (not published)   ✓

const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'application/json,text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' };

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) { const e = new Error(`HTTP ${res.status} on ${url}`); e.status = res.status; throw e; }
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) { const e = new Error(`HTTP ${res.status} on ${url}`); e.status = res.status; throw e; }
  return res.text();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stripHtml(html) {
  if (!html) return null;
  const text = cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
  return text || null;
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function clean(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t || null;
}

// Officer/director classification from a free-text title.
// kind drives the frontend grouping (manager → "Executive", else "Director").
function classifyPerson(title) {
  const t = (title || '').toLowerCase();
  let role_code = null;
  if (/\bc\.?e\.?o\b|chief executive/.test(t)) role_code = 'CEO';
  else if (/\bc\.?f\.?o\b|chief financial/.test(t)) role_code = 'CFO';
  else if (/\bc\.?o\.?o\b|chief operating/.test(t)) role_code = 'COO';
  else if (/\bc\.?t\.?o\b|chief technology/.test(t)) role_code = 'CTO';
  else if (/president/.test(t)) role_code = 'PSD';
  else if (/chair/.test(t)) role_code = 'CHM';
  else if (/secretary/.test(t)) role_code = 'SEC';
  else if (/director/.test(t)) role_code = 'DIR';
  const isOfficer = /(chief|\bc[efot]o\b|president|secretary|treasurer|vice[- ]?president|\bvp\b|controller|officer)/.test(t);
  const kind = isOfficer ? 'manager' : (/director|chair|board/.test(t) ? 'director' : 'manager');
  return { kind, role_code };
}

function dedupePeople(people) {
  const seen = new Set();
  const out = [];
  for (const p of people) {
    if (!p.name) continue;
    const key = `${p.name.toLowerCase()}|${p.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSE  (Canadian Securities Exchange)
// ---------------------------------------------------------------------------

const CSE_SEC = 'https://webapi-primary.thecse.com/trading/listed/securities';
const CSE_LISTING = 'https://thecse.com/listings';

function slugifyCse(name) {
  return String(name).toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatCseAddress(a) {
  if (!a || typeof a !== 'object') return null;
  const line1 = [a.thoroughfare, a.premise].filter(Boolean).join(', ');
  const region = [a.administrativeArea, a.postalCode].filter(Boolean).join(' ');
  const parts = [line1, a.locality, region, a.country].map(clean).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function scrapeCse({ ticker }) {
  if (!ticker) return { source: 'cse', matched: false, note: 'no ticker' };
  const sym = ticker.toUpperCase();
  let meta;
  try {
    meta = (await getJson(`${CSE_SEC}/${encodeURIComponent(sym)}.json`)).metadata;
  } catch (e) {
    if (e.status === 404) return { source: 'cse', matched: false, note: 'symbol not found on CSE' };
    throw e;
  }
  if (!meta || !meta.security_name) return { source: 'cse', matched: false, note: 'no metadata' };

  const slug = slugifyCse(meta.security_name);
  const html = await getText(`${CSE_LISTING}/${slug}/`);
  const nd = parseNextData(html);
  const info = nd && nd.props && nd.props.pageProps && nd.props.pageProps.staticCompanyInfo;
  if (!info) return { source: 'cse', matched: false, note: `listing page had no data (slug=${slug})` };
  // Guard against a slug collision pointing at the wrong issuer.
  if (info.symbol && info.symbol.toUpperCase() !== sym) {
    return { source: 'cse', matched: false, note: `slug mismatch (${info.symbol} != ${sym})` };
  }

  const people = dedupePeople([
    ...(Array.isArray(info.companyOfficers) ? info.companyOfficers : [])
      .map(o => ({ name: clean(o.name), title: clean(o.title), ...classifyPerson(o.title) }))
      .filter(p => p.name),
    ...(info.corporateSecretary
      ? [{ name: clean(info.corporateSecretary), title: 'Corporate Secretary', kind: 'manager', role_code: 'SEC' }]
      : []),
  ]);

  const profile = {
    description:  stripHtml(info.companyDescription),
    website:      clean(info.url) || clean(meta.company_website_url),
    headquarters: formatCseAddress(info.address),
    transfer_agent: clean(info.transferAgent),
    phone:        clean(info.phone),
    shares_outstanding: toInt(info.issuedAndOutstanding) ?? toInt(meta.outstanding_shares),
    sector:       clean(info.sector) || clean(meta.sector),
    listing_date: clean(meta.listing_date),
    market_cap:   null,
  };
  return { source: 'cse', matched: true, slug, profile, people };
}

// ---------------------------------------------------------------------------
// ASX  (Australian Securities Exchange)
// ---------------------------------------------------------------------------

const ASX_API = 'https://asx.api.markitdigital.com/asx-research/1.0/companies';

async function scrapeAsx({ ticker }) {
  if (!ticker) return { source: 'asx', matched: false, note: 'no ticker' };
  const sym = ticker.toUpperCase();
  let about;
  try {
    about = (await getJson(`${ASX_API}/${encodeURIComponent(sym)}/about`)).data;
  } catch (e) {
    if (e.status === 404) return { source: 'asx', matched: false, note: 'symbol not found on ASX' };
    throw e;
  }
  if (!about) return { source: 'asx', matched: false, note: 'no /about data' };

  // Sector + market cap (header) and shares outstanding (key-statistics) are best-effort.
  let header = null, stats = null;
  try { header = (await getJson(`${ASX_API}/${encodeURIComponent(sym)}/header`)).data; } catch { /* optional */ }
  try { stats = (await getJson(`${ASX_API}/${encodeURIComponent(sym)}/key-statistics`)).data; } catch { /* optional */ }

  // Share registry → transfer_agent column ("Transfer Agent (CA) / Share Registry (AUS)").
  let registry = null;
  const reg = about.addressShareRegistry;
  if (reg) registry = clean([reg.attention, reg.address].filter(Boolean).join(' — ')) || clean(reg.attention);

  const people = dedupePeople([
    ...(Array.isArray(about.directors) ? about.directors : [])
      .map(d => ({ name: clean(d.name), title: clean(d.title) || 'Director', kind: 'director', role_code: classifyPerson(d.title).role_code || 'DIR' }))
      .filter(p => p.name),
    ...(Array.isArray(about.secretaries) ? about.secretaries : [])
      .map(s => ({ name: clean(s.name), title: clean(s.title) || 'Company Secretary', kind: 'manager', role_code: 'SEC' }))
      .filter(p => p.name),
  ]);

  const profile = {
    description:  clean(about.description),
    website:      clean(about.websiteUrl),
    headquarters: clean(about.addressContact && about.addressContact.address),
    transfer_agent: registry,
    phone:        clean(about.addressContact && about.addressContact.phone),
    shares_outstanding: toInt(stats && stats.numOfShares),
    sector:       clean(header && header.sector),
    listing_date: clean(header && header.dateListed),
    market_cap:   (header && Number.isFinite(header.marketCap)) ? header.marketCap : null,
  };
  return { source: 'asx', matched: true, profile, people };
}

// ---------------------------------------------------------------------------
// TMX  (TSX / TSX Venture)
// ---------------------------------------------------------------------------

const TMX_GQL = 'https://app-money.tmx.com/graphql';
const TMX_QUERY = `query getQuoteBySymbol($symbol: String, $locale: String) {
  getQuoteBySymbol(symbol: $symbol, locale: $locale) {
    symbol name exShortName exchangeName sector industry longDescription
    website fullAddress phoneNumber shareOutStanding MarketCap
  }
}`;

async function scrapeTmx({ ticker }) {
  if (!ticker) return { source: 'tmx', matched: false, note: 'no ticker' };
  const sym = ticker.toUpperCase();
  const res = await fetch(TMX_GQL, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', locale: 'en' },
    body: JSON.stringify({ operationName: 'getQuoteBySymbol', variables: { symbol: sym, locale: 'en' }, query: TMX_QUERY }),
  });
  if (!res.ok) throw new Error(`TMX HTTP ${res.status}`);
  const json = await res.json();
  const q = json && json.data && json.data.getQuoteBySymbol;
  if (!q || !q.name) return { source: 'tmx', matched: false, note: 'symbol not found on TMX' };

  const profile = {
    description:  clean(q.longDescription),
    website:      clean(q.website),
    headquarters: clean(q.fullAddress),
    transfer_agent: null, // not published by TMX Money
    phone:        clean(q.phoneNumber),
    shares_outstanding: toInt(q.shareOutStanding),
    sector:       clean(q.sector),
    listing_date: null,
    market_cap:   (Number.isFinite(q.MarketCap)) ? q.MarketCap : null,
  };
  // TMX exposes no officers/directors feed — people stays empty for TSX/TSXV.
  return { source: 'tmx', matched: true, profile, people: [] };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function normExchange(ex) {
  const u = String(ex || '').toUpperCase().replace('-', '');
  if (u === 'TSXV' || u === 'TSX') return u;
  if (u === 'CSE' || u === 'CNSX') return 'CSE';
  if (u === 'ASX') return 'ASX';
  return u;
}

async function scrapeCompany({ exchange, ticker /*, name */ }) {
  const ex = normExchange(exchange);
  if (ex === 'CSE') return scrapeCse({ ticker });
  if (ex === 'ASX') return scrapeAsx({ ticker });
  if (ex === 'TSX' || ex === 'TSXV') return scrapeTmx({ ticker });
  return { source: null, matched: false, note: `unsupported exchange "${exchange}"` };
}

module.exports = {
  scrapeCompany,
  scrapeCse,
  scrapeAsx,
  scrapeTmx,
  slugifyCse,
  classifyPerson,
};
