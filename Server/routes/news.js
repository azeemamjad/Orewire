const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Tables created by db/migrate.js

// ---------------------------------------------------------------------------
// RSS sources
// ---------------------------------------------------------------------------

const RSS_FEEDS = [
  { name: 'Newsfile Mining', url: 'https://feeds.newsfilecorp.com/industry/mining-metals', source: 'TMX Newsfile' },
  { name: 'Newsfile Energy Metals', url: 'https://feeds.newsfilecorp.com/industry/energy-metals', source: 'TMX Newsfile' },
  { name: 'GlobeNewsWire Mining', url: 'https://www.globenewswire.com/RssFeed/industry/1775-General+Mining/feedTitle/GlobeNewsWire+-+Industry+Tag+-+General+Mining', source: 'GlobeNewsWire' },
];

// ---------------------------------------------------------------------------
// RSS parser
// ---------------------------------------------------------------------------

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
    const description = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')
      ?.replace(/<[^>]+>/g, '')
      ?.trim() || '';

    if (title && link) {
      items.push({ title, link, pubDate, source: source || defaultSource, description: description.slice(0, 500) });
    }
  }
  return items;
}

async function fetchRssFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`RSS ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Company matching — only keep news about companies we cover
// ---------------------------------------------------------------------------

let companyLookup = { byTicker: new Map(), byName: [] };
let lookupLoadedAt = 0;
const LOOKUP_TTL = 10 * 60 * 1000;

async function loadCompanyLookup() {
  if (Date.now() - lookupLoadedAt < LOOKUP_TTL) return;
  try {
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
        byName.push({ id: row.id, name: row.name.toLowerCase(), ticker: row.ticker, exchange: row.exchange });
      }
    }

    companyLookup = { byTicker, byName };
    lookupLoadedAt = Date.now();
  } catch (err) {
    console.error('[News] Failed to load company lookup:', err?.message || err);
  }
}

function matchCompany(title, description) {
  const text = `${title} ${description || ''}`.toUpperCase();

  for (const [ticker, company] of companyLookup.byTicker) {
    if (ticker.length < 2) continue;
    const regex = new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (regex.test(text)) return company;
  }

  const lowerText = `${title} ${description || ''}`.toLowerCase();
  for (const entry of companyLookup.byName) {
    if (entry.name.length < 5) continue;
    if (lowerText.includes(entry.name)) return { id: entry.id, ticker: entry.ticker, exchange: entry.exchange };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Ollama AI enrichment
// ---------------------------------------------------------------------------

async function callOllama(prompt) {
  const base   = process.env.OLLAMA_HOST  || 'https://ollama.com';
  const model  = process.env.OLLAMA_MODEL || 'kimi';
  const apiKey = process.env.OLLAMA_API_KEY;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'system',
          content: 'You are a mining investment news analyst for a platform tracking junior mining stocks on TSX-V, CSE, and ASX. Given news headlines and descriptions, produce a JSON array. Each item: "title" (clean headline — remove source suffix), "summary" (1-2 sentence summary for mining investors), "commodity" (Gold, Silver, Copper, Lithium, Uranium, Nickel, Zinc, or null), "sentiment" ("bullish", "bearish", or "neutral"). Return ONLY a valid JSON array.'
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content || '[]';
}

function parseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

async function enrichUnprocessedNews() {
  try {
    const unprocessed = await db.query(
      `SELECT id, title, description FROM news WHERE ai_processed = FALSE ORDER BY pub_date DESC LIMIT 10`
    );
    if (unprocessed.rows.length === 0) return;

    const prompt = unprocessed.rows.map((r, i) =>
      `${i + 1}. "${r.title}" — ${r.description || 'No description'}`
    ).join('\n');

    const aiRaw = await callOllama(prompt);
    const aiItems = parseJson(aiRaw);

    for (let i = 0; i < unprocessed.rows.length; i++) {
      const row = unprocessed.rows[i];
      const ai = aiItems[i] || {};
      try {
        await db.query(
          `UPDATE news SET summary = $1, commodity = $2, sentiment = $3, ai_processed = TRUE WHERE id = $4`,
          [ai.summary || null, ai.commodity || null, ai.sentiment || 'neutral', row.id]
        );
      } catch { /* skip */ }
    }

    console.log(`[News] AI enriched ${unprocessed.rows.length} items`);
  } catch (err) {
    console.error('[News] AI enrichment failed:', err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// Background fetcher
// ---------------------------------------------------------------------------

let fetchRunning = false;

async function fetchAndStoreNews() {
  if (fetchRunning) return;
  fetchRunning = true;

  try {
    await loadCompanyLookup();

    let allItems = [];
    for (const feed of RSS_FEEDS) {
      try {
        const xml = await fetchRssFeed(feed.url);
        const items = parseRssItems(xml, feed.source);
        allItems.push(...items);
      } catch (err) {
        console.error(`[News] Failed to fetch ${feed.name}:`, err?.message || err);
      }
    }

    const seen = new Set();
    allItems = allItems.filter(item => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    let inserted = 0;
    let matched = 0;

    for (const item of allItems) {
      const company = matchCompany(item.title, item.description);

      try {
        const result = await db.query(
          `INSERT INTO news (title, link, source, pub_date, description, category, company_id, ticker)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (link) DO NOTHING
           RETURNING id`,
          [
            item.title,
            item.link,
            item.source || 'News',
            item.pubDate ? new Date(item.pubDate) : new Date(),
            item.description,
            company ? `company:${company.ticker || company.id}` : 'general',
            company?.id || null,
            company?.ticker || null,
          ]
        );
        if (result.rows.length > 0) {
          inserted++;
          if (company) matched++;
        }
      } catch { /* skip */ }
    }

    if (inserted > 0) {
      console.log(`[News] Fetched ${allItems.length} items, inserted ${inserted} new (${matched} matched to companies), running AI enrichment`);
      await enrichUnprocessedNews();
    }
  } catch (err) {
    console.error('[News] Fetch cycle failed:', err?.message || err);
  } finally {
    fetchRunning = false;
  }
}

// Start background fetching — every 5 minutes
const FETCH_INTERVAL = 5 * 60 * 1000;
setTimeout(() => fetchAndStoreNews(), 5000);
setInterval(() => fetchAndStoreNews(), FETCH_INTERVAL);

// ---------------------------------------------------------------------------
// Company-specific news — on-demand fetch with 1-hour cooldown
// ---------------------------------------------------------------------------

const companyFetchTimestamps = new Map();
const COMPANY_FETCH_COOLDOWN = 60 * 60 * 1000;

async function fetchCompanyNewsOnDemand(companyName, ticker) {
  const key = `company:${ticker || companyName}`;
  const lastFetch = companyFetchTimestamps.get(key) || 0;
  if (Date.now() - lastFetch < COMPANY_FETCH_COOLDOWN) return;
  companyFetchTimestamps.set(key, Date.now());

  const queries = [];
  if (ticker) queries.push(`"${ticker}" mining stock`);
  queries.push(`"${companyName}" mining`);

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
    } catch { /* skip */ }
    if (allItems.length >= 6) break;
  }

  const seen = new Set();
  allItems = allItems.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  }).slice(0, 10);

  const category = `company:${ticker || companyName}`;

  let newCount = 0;
  for (const item of allItems) {
    try {
      const result = await db.query(
        `INSERT INTO news (title, link, source, pub_date, description, category, ticker)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (link) DO NOTHING
         RETURNING id`,
        [item.title, item.link, item.source || 'News', item.pubDate ? new Date(item.pubDate) : new Date(), item.description, category, ticker]
      );
      if (result.rows.length > 0) newCount++;
    } catch { /* skip */ }
  }

  if (newCount > 0) {
    console.log(`[News] Company ${key}: ${newCount} new articles, running AI enrichment`);
    await enrichUnprocessedNews();
  }
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatRow(row) {
  return {
    id: row.id,
    title: row.title,
    // Short AI line (used in collapsed card).
    summary: row.summary || row.description || '',
    // Full content (used in expanded card). Null when we only have a short summary.
    description: (row.description && row.description !== row.summary) ? row.description : null,
    source: row.source || 'News',
    link: row.link,
    pubDate: row.pub_date,
    timeAgo: timeAgo(row.pub_date),
    commodity: row.commodity || null,
    sentiment: row.sentiment || 'neutral',
    ticker: row.ticker || null,
  };
}

// GET /api/news/feed — homepage: latest news from all sources
router.get('/feed', async (req, res) => {
  try {
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 12;
    const offset = (page - 1) * limit;

    const [itemsResult, countResult] = await Promise.all([
      db.query(
        `SELECT * FROM news WHERE relevant = TRUE ORDER BY pub_date DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM news WHERE relevant = TRUE`),
    ]);

    const total = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      items: itemsResult.rows.map(formatRow),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    console.error('News feed query failed:', err?.message || err);
    res.status(503).json({
      items: [],
      pagination: { page: 1, limit: 12, total: 0, totalPages: 1, hasNext: false, hasPrev: false },
    });
  }
});

// GET /api/news/company/:name?ticker=SCZ&exchange=TSXV&limit=4&offset=0
router.get('/company/:name', async (req, res) => {
  try {
    const companyName = decodeURIComponent(req.params.name);
    const ticker = req.query.ticker || '';
    const category = `company:${ticker || companyName}`;
    const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit,  10) || 10));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // Fetch limit + 1 so we can flag hasMore cheaply without a separate COUNT.
    const fetchLimit = limit + 1;
    const sql = `SELECT * FROM news WHERE (category = $1 OR ticker = $2) AND relevant = TRUE ORDER BY pub_date DESC LIMIT $3 OFFSET $4`;

    let result = await db.query(sql, [category, ticker, fetchLimit, offset]);

    // Only trigger the on-demand fetcher on the very first page when nothing exists yet.
    if (result.rows.length === 0 && offset === 0) {
      await fetchCompanyNewsOnDemand(companyName, ticker);
      result = await db.query(sql, [category, ticker, fetchLimit, offset]);
    }

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(formatRow);
    res.json({ items, hasMore, nextOffset: hasMore ? offset + limit : null });
  } catch (err) {
    console.error('Company news query failed:', err?.message || err);
    res.status(503).json({ items: [], hasMore: false, nextOffset: null });
  }
});

// GET /api/news/item?link=...  OR  /api/news/item?id=123  — fetch a single news item
router.get('/item', async (req, res) => {
  try {
    const link = (req.query.link || '').toString().trim();
    const id   = parseInt(req.query.id, 10);
    let result;
    if (Number.isFinite(id) && id > 0) {
      result = await db.query(`SELECT * FROM news WHERE id = $1 LIMIT 1`, [id]);
    } else if (link) {
      result = await db.query(`SELECT * FROM news WHERE link = $1 LIMIT 1`, [link]);
    } else {
      return res.status(400).json({ error: 'link or id required' });
    }
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ item: formatRow(result.rows[0]) });
  } catch (err) {
    console.error('News item query failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// POST /api/news/refresh — manually trigger a fetch cycle
router.post('/refresh', async (req, res) => {
  fetchAndStoreNews();
  res.json({ ok: true, message: 'News fetch triggered' });
});

module.exports = router;
