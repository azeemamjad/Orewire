// MarketScreener scraper: company description, website, headquarters, managers/directors.
// Strategy:
//   1. searchSlug(query) hits /search/?q=... and returns the best /quote/stock/<SLUG>/ match.
//   2. fetchProfile(slug) parses /quote/stock/<slug>/company/ for description, website, HQ.
//   3. fetchPeople(slug) parses /quote/stock/<slug>/managers/ for the people table.

const cheerio = require('cheerio');
const { fetchWithProxy } = require('./proxy-fetch');
const { addLog } = require('./state');

const BASE = 'https://www.marketscreener.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

async function getHtml(url) {
  const res = await fetchWithProxy(url, {
    headers: HEADERS,
    redirect: 'follow',
  }, { logger: (m) => addLog('warn', `[Profiles] ${m}`) });
  if (!res.ok) throw new Error(`MS ${res.status} on ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// 1) Search by ticker / name → slug
// ---------------------------------------------------------------------------

// Map our exchange codes to MarketScreener's exchange labels (substring match).
const EXCHANGE_LABEL = {
  TSX: ['Toronto S.E.', 'TSX'],
  TSXV: ['TSX Venture', 'Toronto Venture'],
  CSE: ['Canadian Securities', 'CSE'],
  ASX: ['Australian S.E.', 'ASX'],
};

function _parseSearchResults(html) {
  const $ = cheerio.load(html);
  const hits = [];
  // The results table has rows where the name cell links to /quote/stock/SLUG/
  // AND a sibling cell has aria-label="Stock exchange".
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a[href^="/quote/stock/"]').first();
    if (!link.length) return;
    const href = link.attr('href');
    const m = href && href.match(/^\/quote\/stock\/([A-Z0-9-]+-\d+)\/?/);
    if (!m) return;
    const exchangeCell = $tr.find('td[aria-label="Stock exchange"]').first();
    if (!exchangeCell.length) return; // not a real search-result row
    const name = link.text().trim().replace(/\s+/g, ' ');
    // The ticker cell is the bold one right after the name; aria-label can be empty,
    // so we look for a centered/bold cell that follows the name link.
    let ticker = '';
    const tds = $tr.find('td');
    tds.each((_, td) => {
      const $td = $(td);
      const cls = $td.attr('class') || '';
      if (/txt-bold/.test(cls) && /table-child--w(60|80|100)/.test(cls)) {
        const t = $td.text().trim();
        if (t && t.length <= 12 && !ticker) ticker = t;
      }
    });
    const exchange = exchangeCell.text().trim().replace(/\s+/g, ' ');
    hits.push({ slug: m[1], name, ticker, exchange });
  });
  return hits;
}

function _scoreHit(hit, wantTicker, wantExchange) {
  let score = 0;
  if (wantTicker && hit.ticker && hit.ticker.toUpperCase() === wantTicker.toUpperCase()) score += 100;
  if (wantExchange) {
    const labels = EXCHANGE_LABEL[wantExchange] || [wantExchange];
    if (labels.some(l => hit.exchange.includes(l))) score += 50;
  }
  return score;
}

/**
 * Find the best MarketScreener slug for a company.
 * @param {object} opts
 * @param {string} opts.query - free-text search (company name preferred)
 * @param {string} [opts.ticker] - expected ticker for disambiguation
 * @param {string} [opts.exchange] - our exchange code (TSX, TSXV, CSE, ASX)
 * @returns {Promise<{slug: string, name: string, ticker: string, exchange: string} | null>}
 */
async function searchSlug({ query, ticker, exchange }) {
  if (!query) return null;
  const url = `${BASE}/search/?q=${encodeURIComponent(query)}`;
  const html = await getHtml(url);
  const hits = _parseSearchResults(html);
  if (hits.length === 0) return null;
  // Score and pick the best match
  const ranked = hits
    .map(h => ({ ...h, _score: _scoreHit(h, ticker, exchange) }))
    .sort((a, b) => b._score - a._score);
  // If nothing scored at all (no ticker/exchange given), just return the first result
  return ranked[0];
}

// ---------------------------------------------------------------------------
// 2) Company profile (description, website, headquarters)
// ---------------------------------------------------------------------------

function _findCardByTitle($, regex) {
  let match = null;
  $('.card').each((_, card) => {
    if (match) return;
    const title = $(card).find('.card-title, .card-header h3, .card-header h4').first().text().trim();
    if (regex.test(title)) match = $(card);
  });
  return match;
}

async function fetchProfile(slug) {
  const html = await getHtml(`${BASE}/quote/stock/${slug}/company/`);
  const $ = cheerio.load(html);

  // Description — from the "Business description: <Company>" card.
  let description = null;
  const descCard = _findCardByTitle($, /Business description/i);
  if (descCard) {
    const $content = descCard.find('.card-content').first();
    // Strip the embedded logo so we get the plain paragraph text
    $content.find('.company-logo, script').remove();
    description = $content.text().trim().replace(/\s+/g, ' ');
    if (description.length < 40) description = null;
  }
  if (!description) {
    description = $('meta[name="description"]').attr('content') || null;
  }

  // Website + Headquarters — from the "Company details: <Company>" card.
  let website = null;
  let headquarters = null;
  const detailsCard = _findCardByTitle($, /Company details/i);
  if (detailsCard) {
    const $content = detailsCard.find('.card-content').first();
    // Website: first external http link inside the details card.
    const $link = $content.find('a[href^="http"]').first();
    if ($link.length) {
      const href = $link.attr('href') || '';
      if (!/marketscreener|zonebourse/i.test(href)) website = href;
    }
    // Headquarters: address paragraphs (skip the first <p> which is the company name,
    // and skip the literal "+" line and the website line).
    const lines = [];
    $content.find('p').each((_, p) => {
      const t = $(p).text().trim().replace(/\s+/g, ' ');
      if (!t || t === '+' || /^https?:\/\//i.test(t)) return;
      lines.push(t);
    });
    // Drop the first line (company name) if it duplicates the title.
    if (lines.length > 1) lines.shift();
    if (lines.length) headquarters = lines.join(', ').slice(0, 200);
  }

  return { description, website, headquarters };
}

// ---------------------------------------------------------------------------
// 3) Managers + Directors
// ---------------------------------------------------------------------------

// Role-code mapping from the MarketScreener badge text.
const ROLE_CODES = new Set(['CEO', 'CHM', 'PSD', 'DIR', 'CFO', 'COO', 'CTO', 'IND', 'SEC']);
// Board-director titles only — must NOT include "Director of <X>" (those are operational manager roles).
const DIRECTOR_TITLE = /(?:Board Member|^Chair(?:man|woman|person)\b|^(?:Independent|Non[- ]Executive|Lead)?\s*Director\s*(?:\/|$))/i;

function _parsePeopleTable(html) {
  const $ = cheerio.load(html);
  const people = [];
  // The insiders/managers section uses tables. Each row has:
  //   <span class="badge">CEO</span>  <td aria-label="Title">...</td>  <td aria-label="Age">...</td>  <td aria-label="Since">...</td>
  // and a name link like /insider/JOE-SMITH-12345/.
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const nameLink = $tr.find('a[href^="/insider/"]').first();
    const titleCell = $tr.find('td[aria-label="Title"]').first();
    if (!nameLink.length || !titleCell.length) return;
    const name = nameLink.text().trim().replace(/\s+/g, ' ');
    if (!name) return;
    const badgeText = $tr.find('.badge').first().text().trim().toUpperCase();
    const role_code = ROLE_CODES.has(badgeText) ? badgeText : null;
    const title = titleCell.text().trim().replace(/\s+/g, ' ');
    const ageStr = $tr.find('td[aria-label="Age"]').first().text().trim();
    const sinceStr = $tr.find('td[aria-label="Since"]').first().text().trim();
    const age = /^\d+$/.test(ageStr) ? parseInt(ageStr, 10) : null;
    const sinceMatch = sinceStr.match(/(\d{4})/);
    const since_year = sinceMatch ? parseInt(sinceMatch[1], 10) : null;
    const kind = role_code === 'CHM' || role_code === 'DIR' || role_code === 'IND' || DIRECTOR_TITLE.test(title)
      ? 'director'
      : 'manager';
    people.push({ name, role_code, title, age, since_year, kind });
  });
  return people;
}

async function fetchPeople(slug) {
  // The managers page lists both managers and directors in two sections.
  const html = await getHtml(`${BASE}/quote/stock/${slug}/managers/`);
  return _parsePeopleTable(html);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function scrapeCompany({ query, ticker, exchange, slug }) {
  // Find slug if not provided
  let chosen = null;
  if (!slug) {
    chosen = await searchSlug({ query, ticker, exchange });
    if (!chosen) return { slug: null, profile: null, people: [], note: 'no search match' };
    slug = chosen.slug;
  }
  const [profile, people] = await Promise.all([
    fetchProfile(slug),
    fetchPeople(slug),
  ]);
  return { slug, match: chosen, profile, people };
}

module.exports = {
  scrapeCompany,
  searchSlug,
  fetchProfile,
  fetchPeople,
  _parseSearchResults,
  _parsePeopleTable,
};
