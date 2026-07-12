/**
 * Extract a company's Management + Board of Directors from its OWN website.
 *
 * Pipeline (per company):
 *   1. Fetch the homepage (HTTP + cheerio; headless-browser fallback for JS sites).
 *   2. Pick the most likely "team / management / board" page(s) from the nav.
 *   3. Reduce those pages to text and ask the LLM to extract structured people.
 *
 * Reuses: chatWithSystem (AI + global pause), the analyzer's strict-JSON pattern,
 * withProxyFallback (proxy-tiered browser), and stripHonorific.
 */
const cheerio = require('cheerio');
const { chatWithSystem } = require('../ai/client');
const { stripHonorific } = require('./people-name');
const { SYSTEM_PROMPT, buildUserPrompt } = require('./people-prompt');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HTTP_TIMEOUT_MS = 15000;
const BROWSER_TIMEOUT_MS = 25000;
const MIN_PAGE_TEXT = 180;      // below this, a fetched page is "too thin"
const MIN_TOTAL_TEXT = 150;     // below this combined, don't bother the LLM
const MAX_EXTRA_PAGES = 2;      // team/board pages fetched beyond the homepage

const PEOPLE_APPLY_MIN_CONFIDENCE = Number(process.env.PEOPLE_APPLY_MIN_CONFIDENCE || 0.7);

const BROWSER_FALLBACK = process.env.PEOPLE_BROWSER_FALLBACK !== 'false';

// Common leadership URL paths to try when the homepage nav yields nothing useful.
const FALLBACK_PATHS = [
  '/management', '/leadership', '/our-team', '/team', '/about/management',
  '/board-of-directors', '/board', '/corporate/directors', '/about-us',
  '/about', '/company/leadership', '/investors/corporate-governance',
];

const PEOPLE_KEYWORDS = [
  { re: /board[-\s]?of[-\s]?directors|our[-\s]?board|\bdirectors\b/i, w: 5 },
  { re: /management[-\s]?team|our[-\s]?team|leadership|executives?|\bmanagement\b/i, w: 5 },
  { re: /corporate[-\s]?governance|governance/i, w: 3 },
  { re: /about[-\s]?us|\babout\b|\bcompany\b|\bteam\b|\bpeople\b|who[-\s]?we[-\s]?are/i, w: 2 },
];

function isPublicHttpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // Block obvious private / loopback / link-local IP literals.
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return false;
  return true;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!/html/i.test(ct)) throw new Error(`non-html content-type: ${ct}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlBrowser(url) {
  // Lazy require so playwright is only loaded when the browser path is used.
  const { withProxyFallback } = require('../scraper/utils/proxy-fallback');
  return withProxyFallback(async (browser) => {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      await page.waitForTimeout(1200);
      return await page.content();
    } finally {
      await ctx.close();
    }
  });
}

/** Fetch a page's HTML: HTTP first, then a headless browser if HTTP is thin/blocked. */
async function fetchPageHtml(url) {
  try {
    const html = await fetchHtml(url);
    if (htmlToText(html).length >= MIN_PAGE_TEXT) return html;
  } catch { /* fall through to browser */ }
  if (!BROWSER_FALLBACK) return null;
  try {
    return await fetchHtmlBrowser(url);
  } catch {
    return null;
  }
}

function htmlToText(html) {
  try {
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, template, iframe').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  try {
    const $ = cheerio.load(html);
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      const text = $(a).text().replace(/\s+/g, ' ').trim();
      let abs;
      try { abs = new URL(href, baseUrl).toString(); } catch { return; }
      abs = abs.split('#')[0];
      if (seen.has(abs)) return;
      try {
        if (new URL(abs).host !== new URL(baseUrl).host) return; // same host only
      } catch { return; }
      seen.add(abs);
      out.push({ url: abs, text });
    });
  } catch { /* ignore */ }
  return out;
}

function scoreLink(link) {
  const s = `${link.url} ${link.text}`;
  let score = 0;
  for (const k of PEOPLE_KEYWORDS) if (k.re.test(s)) score += k.w;
  return score;
}

/** Rank same-host links by likelihood of being a leadership page. */
function pickCandidatePages(links, homeUrl, limit = MAX_EXTRA_PAGES) {
  const scored = links
    .map((l) => ({ ...l, score: scoreLink(l) }))
    .filter((l) => l.score > 0 && l.url !== homeUrl)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const seenPath = new Set();
  for (const l of scored) {
    let path;
    try { path = new URL(l.url).pathname.toLowerCase(); } catch { continue; }
    if (seenPath.has(path)) continue;
    seenPath.add(path);
    picked.push(l.url);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * Ask the LLM to choose the leadership page(s) from the site's nav links.
 * Used only as a fallback when the keyword heuristic finds nothing, so most
 * companies never incur this extra call.
 */
async function aiPickPeoplePages(company, links, homeUrl) {
  if (!links.length) return [];
  const list = links
    .slice(0, 50)
    .map((l, i) => `${i + 1}. ${l.text || '(no text)'} -> ${l.url}`)
    .join('\n');
  const system = `You are given the navigation links from a mining company's website. Return the 1-2 links most likely to lead to the company's MANAGEMENT / LEADERSHIP and BOARD OF DIRECTORS listings. Respond with ONLY JSON: {"pages": ["url", ...]} using URLs copied exactly from the list. If none look like a leadership/team/about page, return {"pages": []}.`;
  const user = `Company: ${company.name}\nLinks:\n${list}`;
  try {
    const { content } = await chatWithSystem({
      feature: 'people_page_pick',
      system,
      user,
      timeoutMs: 30000,
    });
    const parsed = parseJson(content);
    const urls = Array.isArray(parsed.pages) ? parsed.pages : [];
    return urls
      .filter((u) => {
        try { return new URL(u).host === new URL(homeUrl).host; } catch { return false; }
      })
      .slice(0, MAX_EXTRA_PAGES);
  } catch {
    return [];
  }
}

function normalizePeople(people) {
  if (!Array.isArray(people)) return [];
  const out = [];
  const seen = new Set();
  for (const p of people) {
    const name = stripHonorific(String(p?.name || '').trim());
    if (!name) continue;
    const kind = p?.kind === 'director' ? 'director' : 'manager';
    const key = `${name.toLowerCase()}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      title: p?.title ? String(p.title).trim().slice(0, 200) : null,
      kind,
      role_code: p?.role_code ? String(p.role_code).trim().toUpperCase().slice(0, 12) : null,
    });
  }
  return out;
}

function parseJson(raw) {
  const cleaned = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Extract people for one company from its website.
 * @returns {Promise<{ ok, people, confidence, sourceUrl, reason? }>}
 */
async function extractPeopleForCompany(company) {
  const website = company.website && String(company.website).trim();
  if (!website || !isPublicHttpUrl(website)) {
    return { ok: false, reason: 'no_valid_website', people: [], confidence: 0 };
  }

  // 1) Homepage
  let homeHtml;
  try {
    homeHtml = await fetchPageHtml(website);
  } catch {
    homeHtml = null;
  }
  if (!homeHtml) return { ok: false, reason: 'fetch_failed', people: [], confidence: 0 };

  // 2) Candidate leadership pages: keyword heuristic → AI page-pick → common paths
  const links = extractLinks(homeHtml, website);
  let candidates = pickCandidatePages(links, website);
  if (candidates.length === 0) {
    candidates = await aiPickPeoplePages(company, links, website);
  }
  if (candidates.length === 0) {
    const origin = (() => { try { return new URL(website).origin; } catch { return null; } })();
    if (origin) candidates = FALLBACK_PATHS.slice(0, 3).map((p) => origin + p);
  }

  // 3) Fetch candidate pages + include homepage text
  const pages = [{ url: website, text: htmlToText(homeHtml) }];
  for (const url of candidates) {
    try {
      const html = await fetchPageHtml(url);
      if (!html) continue;
      const text = htmlToText(html);
      if (text.length >= MIN_PAGE_TEXT) pages.push({ url, text });
    } catch { /* skip this candidate */ }
  }

  const totalLen = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalLen < MIN_TOTAL_TEXT) {
    return { ok: false, reason: 'no_content', people: [], confidence: 0 };
  }

  // 4) LLM extraction
  let content;
  try {
    ({ content } = await chatWithSystem({
      feature: 'people_extract',
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(company, pages),
      timeoutMs: 90000,
    }));
  } catch (err) {
    return { ok: false, reason: `ai_error: ${err.message}`, people: [], confidence: 0 };
  }

  let parsed;
  try {
    parsed = parseJson(content);
  } catch {
    return { ok: false, reason: 'invalid_json', people: [], confidence: 0 };
  }

  const people = normalizePeople(parsed.people);
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const sourceUrl = pages.length > 1 ? pages[1].url : website;

  return {
    ok: true,
    people,
    confidence,
    foundTeamPage: !!parsed.found_team_page,
    sourceUrl,
  };
}

module.exports = {
  PEOPLE_APPLY_MIN_CONFIDENCE,
  extractPeopleForCompany,
  // exported for tests
  isPublicHttpUrl,
  htmlToText,
  extractLinks,
  scoreLink,
  pickCandidatePages,
  aiPickPeoplePages,
  normalizePeople,
  parseJson,
};
