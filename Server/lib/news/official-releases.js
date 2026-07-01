/**
 * Official company news releases — Newsfile (Canada) and ASX MAP (Australia).
 * Distinct from market_news (Google News headlines).
 */
const db = require('../../db');
const { TABLE_RELEASES } = require('./db');
const { companyCategoryKey } = require('./fetch');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const NEWSFILE_BASE = 'https://www.newsfilecorp.com';
const ASX_API = 'https://asx.api.markitdigital.com/asx-research/1.0/companies';

/** Sources shown on News Releases pages and company pages. */
const OFFICIAL_RELEASE_SOURCES = ['TMX Newsfile', 'ASX'];

function isCanadianExchange(exchange) {
  const ex = String(exchange || '').toUpperCase().replace('-', '');
  return ex === 'TSX' || ex === 'TSXV' || ex === 'CSE';
}

function isAsxExchange(exchange) {
  return String(exchange || '').toUpperCase() === 'ASX';
}

function parseNewsfileDate(text) {
  const m = text.match(/\((?:Newsfile Corp\.\s*-\s*)?([A-Za-z]+ \d{1,2}, \d{4})\)/i);
  if (!m) return new Date();
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function fetchNewsfileCompanyReleases(companyName, limit = 15) {
  const q = encodeURIComponent(String(companyName || '').trim());
  if (!q) return [];

  const url = `${NEWSFILE_BASE}/search?k=${q}&l=en`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Newsfile ${res.status}`);

  const html = await res.text();
  const items = [];
  const articleRegex = /<h3>\s*<a href="(\/release\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null && items.length < limit) {
    const path = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    const blurb = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || !path) continue;
    items.push({
      title,
      link: `${NEWSFILE_BASE}${path.split('?')[0]}`,
      source: 'TMX Newsfile',
      pubDate: parseNewsfileDate(blurb),
      description: blurb.slice(0, 500),
    });
  }
  return items;
}

function asxAnnouncementUrl(documentKey) {
  const parts = String(documentKey || '').split('-');
  const idsId = parts[1] || documentKey;
  return `https://www.asx.com.au/asx/v2/statistics/displayAnnouncement.do?display=pdf&idsId=${encodeURIComponent(idsId)}`;
}

async function fetchAsxCompanyReleases(ticker, limit = 15) {
  const sym = String(ticker || '').toUpperCase().trim();
  if (!sym) return [];

  const url = `${ASX_API}/${encodeURIComponent(sym)}/announcements?count=${Math.min(limit, 20)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ASX ${res.status}`);

  const json = await res.json();
  const rows = json?.data?.items || [];
  return rows.slice(0, limit).map((row) => ({
    title: row.headline || 'ASX announcement',
    link: row.url || asxAnnouncementUrl(row.documentKey),
    source: 'ASX',
    pubDate: row.date ? new Date(row.date) : new Date(),
    description: [row.announcementType, row.fileSize].filter(Boolean).join(' · ').slice(0, 500),
  }));
}

async function storeOfficialReleases(items, { companyId, ticker, companyName }) {
  const category = companyCategoryKey(companyName);
  const newIds = [];
  let inserted = 0;

  for (const item of items) {
    try {
      const result = await db.query(
        `INSERT INTO ${TABLE_RELEASES} (title, link, source, pub_date, description, category, company_id, ticker)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (link) DO UPDATE SET
           company_id = COALESCE(EXCLUDED.company_id, ${TABLE_RELEASES}.company_id),
           ticker = COALESCE(EXCLUDED.ticker, ${TABLE_RELEASES}.ticker),
           pub_date = EXCLUDED.pub_date,
           description = COALESCE(EXCLUDED.description, ${TABLE_RELEASES}.description)
         RETURNING id`,
        [
          item.title,
          item.link,
          item.source,
          item.pubDate,
          item.description || null,
          category,
          companyId,
          ticker || null,
        ],
      );
      if (result.rows.length) {
        inserted++;
        newIds.push(result.rows[0].id);
      }
    } catch (err) {
      console.error('[OfficialNews] Insert failed:', err?.message || err);
    }
  }

  return { inserted, newIds };
}

/**
 * Pull official releases for one company from Newsfile or ASX and store in news_releases.
 */
async function syncOfficialCompanyReleases({ name, ticker, exchange, companyId }) {
  let items = [];
  try {
    if (isAsxExchange(exchange)) {
      items = await fetchAsxCompanyReleases(ticker);
    } else if (isCanadianExchange(exchange)) {
      items = await fetchNewsfileCompanyReleases(name);
    } else {
      return { inserted: 0, source: null };
    }
  } catch (err) {
    console.error(`[OfficialNews] Fetch failed ${exchange}:${ticker}:`, err?.message || err);
    return { inserted: 0, source: null, error: err.message };
  }

  const { inserted, newIds } = await storeOfficialReleases(items, {
    companyId,
    ticker,
    companyName: name,
  });

  if (newIds.length) {
    try {
      const { enrichNewsByIds } = require('./fetch');
      await enrichNewsByIds(newIds, TABLE_RELEASES);
    } catch {
      /* optional */
    }
  }

  return { inserted, source: isAsxExchange(exchange) ? 'ASX' : 'TMX Newsfile' };
}

module.exports = {
  OFFICIAL_RELEASE_SOURCES,
  isCanadianExchange,
  isAsxExchange,
  fetchNewsfileCompanyReleases,
  fetchAsxCompanyReleases,
  syncOfficialCompanyReleases,
};
