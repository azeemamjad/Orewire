const db = require('../../db');
const {
  TABLE_RELEASES,
  TABLE_MARKET,
  sourceForTable,
} = require('./db');
const { chatWithSystem } = require('../ai/client');

const RSS_FEEDS = [
  { name: 'Newsfile Mining', url: 'https://feeds.newsfilecorp.com/industry/mining-metals', source: 'TMX Newsfile' },
  { name: 'Newsfile Energy Metals', url: 'https://feeds.newsfilecorp.com/industry/energy-metals', source: 'TMX Newsfile' },
  { name: 'GlobeNewsWire Mining', url: 'https://www.globenewswire.com/RssFeed/industry/1775-General+Mining/feedTitle/GlobeNewsWire+-+Industry+Tag+-+General+Mining', source: 'GlobeNewsWire' },
];

// Google News (and some other feeds) ship the <description> as HTML with the
// angle brackets entity-escaped, e.g. "&lt;a href=...&gt;Title&lt;/a&gt;&amp;nbsp;...".
// We must DECODE the entities first, otherwise the tag-stripping regex (which
// looks for literal <...>) sees only "&lt;"/"&gt;" and leaves the raw anchor —
// link and all — in place. Decode -> strip tags -> collapse whitespace.
function cleanRssText(raw) {
  if (!raw) return '';
  const decoded = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRssItems(xml, defaultSource) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim() || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim() || '';
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]?.trim() || defaultSource || '';
    const description = cleanRssText((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]);

    if (title && link) {
      items.push({ title, link, pubDate, source: source || defaultSource, description: description.slice(0, 500) });
    }
  }
  return items;
}

async function fetchRssFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT  10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`RSS ${res.status} for ${url}`);
  return res.text();
}

let companyLookup = { byTicker: new Map(), byName: [] };
let lookupLoadedAt = 0;
const LOOKUP_TTL = 10 * 60 * 1000;

async function loadCompanyLookup() {
  if (Date.now() - lookupLoadedAt < LOOKUP_TTL) return;
  const result = await db.query(`SELECT id, name, ticker, exchange FROM companies WHERE ticker IS NOT NULL`);
  const byTicker = new Map();
  const byName = [];

  for (const row of result.rows) {
    if (row.ticker) {
      byTicker.set(row.ticker.toUpperCase(), row);
      const variants = [
        `${row.ticker}.V`, `${row.ticker}.TO`, `${row.ticker}.CN`,
        `${row.ticker}:TSXV`, `${row.ticker}:TSX`, `${row.ticker}:CSE`, `${row.ticker}:ASX`,
      ];
      for (const v of variants) byTicker.set(v.toUpperCase(), row);
    }
    if (row.name) {
      byName.push({
        id: row.id,
        name: row.name,
        nameLower: row.name.toLowerCase(),
        ticker: row.ticker,
        exchange: row.exchange,
      });
    }
  }

  companyLookup = { byTicker, byName };
  lookupLoadedAt = Date.now();
}

function matchCompany(title, description) {
  const text = `${title} ${description || ''}`.toUpperCase();

  for (const [ticker, company] of companyLookup.byTicker) {
    if (ticker.length < 2) continue;
    const regex = new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (regex.test(text)) {
      return {
        id: company.id,
        name: company.name,
        ticker: company.ticker,
        exchange: company.exchange,
      };
    }
  }

  const lowerText = `${title} ${description || ''}`.toLowerCase();
  for (const entry of companyLookup.byName) {
    if (entry.nameLower.length < 5) continue;
    if (lowerText.includes(entry.nameLower)) {
      return { id: entry.id, name: entry.name, ticker: entry.ticker, exchange: entry.exchange };
    }
  }

  return null;
}

async function callOllama(prompt) {
  const NEWS_SYSTEM =
    'You are a mining investment news analyst for a platform tracking junior mining stocks on TSX-V, CSE, and ASX. Given news headlines and descriptions, produce a JSON array. Each item: "title" (clean headline — remove source suffix), "summary" (1-2 sentence summary for mining investors), "commodity" (Gold, Silver, Copper, Lithium, Uranium, Nickel, Zinc, or null), "sentiment" ("bullish", "bearish", or "neutral"). Return ONLY a valid JSON array.';
  const { content } = await chatWithSystem({
    feature: 'news_enrichment',
    system: NEWS_SYSTEM,
    user: prompt,
  });
  return content;
}

function parseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

async function enrichNewsRows(rows, table = TABLE_RELEASES) {
  if (!rows.length) return 0;

  const prompt = rows
    .map((r, i) => `${i + 1}. "${r.title}" — ${r.description || 'No description'}`)
    .join('\n');

  const aiRaw = await callOllama(prompt);
  const aiItems = parseJson(aiRaw);
  let enriched = 0;
  const source = sourceForTable(table);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ai = aiItems[i] || {};
    try {
      await db.query(
        `UPDATE ${table} SET summary = $1, commodity = $2, sentiment = $3, ai_processed = TRUE WHERE id = $4`,
        [ai.summary || null, ai.commodity || null, ai.sentiment || 'neutral', row.id]
      );
      try {
        const { queueWatchlistNewsEmail } = require('../watchlist/news-alerts');
        queueWatchlistNewsEmail(row.id, source);
      } catch {
        /* non-fatal */
      }
      enriched++;
    } catch (err) {
      console.error(`[News] Failed to save enrichment for id=${row.id}:`, err?.message || err);
    }
  }
  return enriched;
}

async function enrichNewsByIds(ids, table = TABLE_RELEASES) {
  if (!ids?.length) return 0;
  const result = await db.query(
    `SELECT id, title, description FROM ${table} WHERE id = ANY($1::int[]) AND ai_processed = FALSE`,
    [ids]
  );
  if (result.rows.length === 0) return 0;
  return enrichNewsRows(result.rows, table);
}

async function enrichUnprocessedNews(limit = 25, table = TABLE_RELEASES) {
  const unprocessed = await db.query(
    `SELECT id, title, description FROM ${table} WHERE ai_processed = FALSE ORDER BY pub_date DESC LIMIT $1`,
    [limit]
  );
  if (unprocessed.rows.length === 0) return 0;
  return enrichNewsRows(unprocessed.rows, table);
}

/** Process all pending AI enrichment in batches (non-blocking callers should fire-and-forget). */
async function drainUnprocessedNews(batchSize = 25) {
  let total = 0;
  for (const table of [TABLE_RELEASES, TABLE_MARKET]) {
    for (;;) {
      const n = await enrichUnprocessedNews(batchSize, table);
      total += n;
      if (n < batchSize) break;
    }
  }
  return total;
}

function companyCategoryKey(name) {
  return `company:${String(name || '').trim()}`;
}

/**
 * Fetch Google News RSS for one company. Returns count of newly inserted rows.
 * Category and lookup use company name (not ticker).
 */
async function fetchCompanyNews(companyName, ticker, companyId = null, { skipCooldown = false } = {}) {
  const name = String(companyName || '').trim();
  if (!name) return { inserted: 0, newIds: [] };

  const key = companyCategoryKey(name);
  if (!skipCooldown) {
    const companyFetchTimestamps = fetchCompanyNews._timestamps || (fetchCompanyNews._timestamps = new Map());
    const COMPANY_FETCH_COOLDOWN = 60 * 60 * 1000;
    const lastFetch = companyFetchTimestamps.get(key) || 0;
    if (Date.now() - lastFetch < COMPANY_FETCH_COOLDOWN) {
      return { inserted: 0, newIds: [], skippedCooldown: true };
    }
    companyFetchTimestamps.set(key, Date.now());
  }

  const queries = [`"${name}" mining`];
  if (ticker && ticker.toUpperCase() !== name.toUpperCase()) {
    queries.push(`"${name}" "${ticker}" mining`);
  }

  let allItems = [];
  for (const q of queries) {
    try {
      const encoded = encodeURIComponent(q);
      const url = `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (res.ok) {
        const xml = await res.text();
        allItems.push(...parseRssItems(xml, 'Google News'));
      }
    } catch {
      /* skip */
    }
    if (allItems.length >= 6) break;
  }

  const seen = new Set();
  allItems = allItems
    .filter((item) => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    })
    .slice(0, 10);

  const category = companyCategoryKey(name);
  const newIds = [];
  let inserted = 0;

  for (const item of allItems) {
    try {
      const result = await db.query(
        `INSERT INTO ${TABLE_MARKET} (title, link, source, pub_date, description, category, company_id, ticker)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (link) DO NOTHING
         RETURNING id`,
        [
          item.title,
          item.link,
          item.source || 'News',
          item.pubDate ? new Date(item.pubDate) : new Date(),
          item.description,
          category,
          companyId,
          ticker,
        ]
      );
      if (result.rows.length > 0) {
        inserted++;
        newIds.push(result.rows[0].id);
      }
    } catch (err) {
      console.error('[News] Insert failed:', err?.message || err);
    }
  }

  let enriched = 0;
  if (newIds.length > 0) {
    try {
      enriched = await enrichNewsByIds(newIds, TABLE_MARKET);
      if (enriched > 0) {
        console.log(
          `[News] Company ${category}: ${inserted} new articles, AI enriched ${enriched} (saved to DB)`
        );
      }
    } catch (err) {
      console.error('[News] AI enrichment failed:', err?.message || err);
    }
    if (companyId && (inserted > 0 || enriched > 0)) {
      try {
        const { scheduleSnapshotRegeneration } = require('../companies/snapshot');
        scheduleSnapshotRegeneration(companyId, 'new-company-news');
      } catch {
        /* optional */
      }
    }
  }

  return { inserted, newIds, enriched };
}

async function fetchAndStoreRssFeeds() {
  await loadCompanyLookup();

  let allItems = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchRssFeed(feed.url);
      allItems.push(...parseRssItems(xml, feed.source));
    } catch (err) {
      console.error(`[News] Failed to fetch ${feed.name}:`, err?.message || err);
    }
  }

  const seen = new Set();
  allItems = allItems.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  let inserted = 0;
  let matched = 0;
  const insertedIds = [];

  for (const item of allItems) {
    const company = matchCompany(item.title, item.description);
    try {
      const result = await db.query(
        `INSERT INTO ${TABLE_RELEASES} (title, link, source, pub_date, description, category, company_id, ticker)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (link) DO NOTHING
         RETURNING id`,
        [
          item.title,
          item.link,
          item.source || 'News',
          item.pubDate ? new Date(item.pubDate) : new Date(),
          item.description,
          company ? companyCategoryKey(company.name) : 'general',
          company?.id || null,
          company?.ticker || null,
        ]
      );
      if (result.rows.length > 0) {
        inserted++;
        insertedIds.push(result.rows[0].id);
        if (company) matched++;
      }
    } catch (err) {
      console.error('[News] RSS insert failed:', err?.message || err);
    }
  }

  let enriched = 0;
  const regenCompanyIds = new Set();
  if (insertedIds.length > 0) {
    try {
      enriched = await enrichNewsByIds(insertedIds, TABLE_RELEASES);
      if (enriched > 0) {
        console.log(`[News] AI enriched ${enriched} items (saved to DB)`);
      }
    } catch (err) {
      console.error('[News] AI enrichment failed:', err?.message || err);
    }
    // Re-query company_ids for inserted rows to refresh snapshots after enrichment
    try {
      const idRes = await db.query(
        `SELECT DISTINCT company_id FROM ${TABLE_RELEASES} WHERE id = ANY($1::int[]) AND company_id IS NOT NULL`,
        [insertedIds],
      );
      for (const row of idRes.rows) {
        if (row.company_id) regenCompanyIds.add(row.company_id);
      }
    } catch {
      /* optional */
    }
    for (const cid of regenCompanyIds) {
      try {
        const { scheduleSnapshotRegeneration } = require('../companies/snapshot');
        scheduleSnapshotRegeneration(cid, 'new-rss-news');
      } catch {
        /* optional */
      }
    }
  }

  return { inserted, matched, total: allItems.length, enriched, insertedIds };
}

module.exports = {
  RSS_FEEDS,
  cleanRssText,
  parseRssItems,
  fetchRssFeed,
  loadCompanyLookup,
  matchCompany,
  companyCategoryKey,
  enrichNewsByIds,
  enrichUnprocessedNews,
  drainUnprocessedNews,
  enrichNewsRows,
  fetchCompanyNews,
  fetchAndStoreRssFeeds,
};
