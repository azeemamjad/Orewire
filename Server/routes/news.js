const express = require('express');
const router  = express.Router();
const db      = require('../db');

let tablesReady = ensureTables().catch(err => {
  console.error('Failed to create news tables:', err?.message || err);
});

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS news (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      link        TEXT UNIQUE NOT NULL,
      source      TEXT,
      pub_date    TIMESTAMPTZ,
      description TEXT,
      summary     TEXT,
      commodity   TEXT,
      sentiment   TEXT DEFAULT 'neutral',
      relevant    BOOLEAN DEFAULT TRUE,
      ai_processed BOOLEAN DEFAULT FALSE,
      category    TEXT DEFAULT 'general',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_news_pub_date ON news(pub_date DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_news_category ON news(category)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_news_link ON news(link)`);
  await db.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS relevant BOOLEAN DEFAULT TRUE`);
}

// ---------------------------------------------------------------------------
// RSS parser
// ---------------------------------------------------------------------------

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')?.trim() || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim() || '';
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]?.trim() || '';
    const description = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')
      ?.replace(/<[^>]+>/g, '')
      ?.trim() || '';

    if (title && link) {
      items.push({ title, link, pubDate, source, description: description.slice(0, 500) });
    }
  }
  return items;
}

async function fetchGoogleNews(query, limit = 10) {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml).slice(0, limit);
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
          content: 'You are a mining investment news analyst for a platform that tracks junior mining stocks on TSX-V, CSE, and ASX exchanges. Given raw news headlines and descriptions, produce a JSON array of enriched news items. Each item must have: "title" (clean headline — remove source suffix like "- Reuters"), "summary" (1-2 sentence plain-English summary of what happened and why it matters for mining investors), "commodity" (primary commodity: Gold, Silver, Copper, Lithium, Uranium, Nickel, Zinc, or null), "sentiment" (one of: "bullish", "bearish", "neutral"), "relevant" (boolean — TRUE if the article is about mining companies, mineral exploration, drill results, mining stocks, commodity prices, mining financing, or mining market analysis. FALSE if it is about mining accidents, illegal mining, environmental disasters, politics, general world news, or is unrelated to the mining investment industry). Return ONLY valid JSON array, no markdown fences, no extra text.'
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

// ---------------------------------------------------------------------------
// Background fetcher — runs every 5 minutes
// ---------------------------------------------------------------------------

const FEED_QUERIES = [
  'gold mining company drill results',
  'TSX-V mining stock news',
  'ASX junior mining explorer',
  'lithium mining company financing',
  'copper mining drill results feasibility',
  'uranium mining stock market',
  'silver mining company quarterly',
  'mining IPO TSX venture exchange',
  'mineral exploration company update',
];

let fetchRunning = false;

async function fetchAndStoreNews() {
  if (fetchRunning) return;
  fetchRunning = true;

  try {
    await tablesReady;

    let allItems = [];
    for (const q of FEED_QUERIES) {
      try {
        const items = await fetchGoogleNews(q, 8);
        allItems.push(...items);
      } catch { /* skip */ }
    }

    const seen = new Set();
    allItems = allItems.filter(item => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    });

    let inserted = 0;
    for (const item of allItems) {
      try {
        const result = await db.query(
          `INSERT INTO news (title, link, source, pub_date, description, category)
           VALUES ($1, $2, $3, $4, $5, 'general')
           ON CONFLICT (link) DO NOTHING
           RETURNING id`,
          [item.title, item.link, item.source || 'News', item.pubDate ? new Date(item.pubDate) : new Date(), item.description]
        );
        if (result.rows.length > 0) inserted++;
      } catch { /* skip duplicate or error */ }
    }

    if (inserted > 0) {
      console.log(`[News] Fetched ${allItems.length} items, inserted ${inserted} new, running AI enrichment`);
      await enrichUnprocessedNews();
    }
  } catch (err) {
    console.error('[News] Fetch cycle failed:', err?.message || err);
  } finally {
    fetchRunning = false;
  }
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
      const isRelevant = ai.relevant !== false;
      try {
        await db.query(
          `UPDATE news SET summary = $1, commodity = $2, sentiment = $3, relevant = $4, ai_processed = TRUE WHERE id = $5`,
          [ai.summary || null, ai.commodity || null, ai.sentiment || 'neutral', isRelevant, row.id]
        );
      } catch { /* skip */ }
    }

    const irrelevantIds = unprocessed.rows
      .map((row, i) => (aiItems[i]?.relevant === false ? row.id : null))
      .filter(Boolean);

    if (irrelevantIds.length > 0) {
      await db.query(`DELETE FROM news WHERE id = ANY($1)`, [irrelevantIds]);
      console.log(`[News] AI enriched ${unprocessed.rows.length} items, deleted ${irrelevantIds.length} irrelevant`);
    } else {
      console.log(`[News] AI enriched ${unprocessed.rows.length} items, all relevant`);
    }
  } catch (err) {
    console.error('[News] AI enrichment failed:', err?.message || err);
  }
}

// Start background fetching
const FETCH_INTERVAL = 5 * 60 * 1000;
setTimeout(() => fetchAndStoreNews(), 5000);
setInterval(() => fetchAndStoreNews(), FETCH_INTERVAL);

// ---------------------------------------------------------------------------
// Company-specific news fetcher — 1 hour cooldown, AI only if new articles
// ---------------------------------------------------------------------------

const companyFetchTimestamps = new Map();
const COMPANY_FETCH_COOLDOWN = 60 * 60 * 1000;

async function fetchAndStoreCompanyNews(companyName, ticker) {
  const category = `company:${ticker || companyName}`;

  const lastFetch = companyFetchTimestamps.get(category) || 0;
  if (Date.now() - lastFetch < COMPANY_FETCH_COOLDOWN) return;
  companyFetchTimestamps.set(category, Date.now());

  const queries = [];
  if (ticker) queries.push(`"${ticker}" mining stock`);
  queries.push(`"${companyName}" mining`);

  let allItems = [];
  for (const q of queries) {
    try {
      const items = await fetchGoogleNews(q, 8);
      allItems.push(...items);
    } catch { /* skip */ }
    if (allItems.length >= 6) break;
  }

  const seen = new Set();
  allItems = allItems.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  }).slice(0, 10);

  let newCount = 0;
  for (const item of allItems) {
    try {
      const result = await db.query(
        `INSERT INTO news (title, link, source, pub_date, description, category)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (link) DO NOTHING
         RETURNING id`,
        [item.title, item.link, item.source || 'News', item.pubDate ? new Date(item.pubDate) : new Date(), item.description, category]
      );
      if (result.rows.length > 0) newCount++;
    } catch { /* skip */ }
  }

  if (newCount > 0) {
    console.log(`[News] Company ${category}: ${newCount} new articles, running AI enrichment`);
    await enrichUnprocessedNews();
  }
}

// ---------------------------------------------------------------------------
// API routes — read from DB
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
    summary: row.summary || row.description || '',
    source: row.source || 'News',
    link: row.link,
    pubDate: row.pub_date,
    timeAgo: timeAgo(row.pub_date),
    commodity: row.commodity || null,
    sentiment: row.sentiment || 'neutral',
  };
}

// GET /api/news/feed — homepage news from DB
router.get('/feed', async (req, res) => {
  try {
    await tablesReady;
    const result = await db.query(
      `SELECT * FROM news WHERE category = 'general' AND relevant = TRUE ORDER BY pub_date DESC LIMIT 12`
    );
    res.json({ items: result.rows.map(formatRow) });
  } catch (err) {
    console.error('News feed query failed:', err?.message || err);
    res.status(503).json({ items: [] });
  }
});

// GET /api/news/company/:name?ticker=SCZ&exchange=TSXV
router.get('/company/:name', async (req, res) => {
  try {
    await tablesReady;
    const companyName = decodeURIComponent(req.params.name);
    const ticker = req.query.ticker || '';
    const category = `company:${ticker || companyName}`;

    let result = await db.query(
      `SELECT * FROM news WHERE category = $1 AND relevant = TRUE ORDER BY pub_date DESC LIMIT 10`,
      [category]
    );

    if (result.rows.length === 0) {
      await fetchAndStoreCompanyNews(companyName, ticker);
      result = await db.query(
        `SELECT * FROM news WHERE category = $1 ORDER BY pub_date DESC LIMIT 10`,
        [category]
      );
    }

    res.json({ items: result.rows.map(formatRow) });
  } catch (err) {
    console.error('Company news query failed:', err?.message || err);
    res.status(503).json({ items: [] });
  }
});

// POST /api/news/refresh — manually trigger a fetch cycle
router.post('/refresh', async (req, res) => {
  fetchAndStoreNews();
  res.json({ ok: true, message: 'News fetch triggered' });
});

module.exports = router;
