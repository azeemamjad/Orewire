/**
 * Admin: market news publishers — list, block/unblock, browse headlines.
 */
const express = require('express');
const router = express.Router();
const {
  listMarketSources,
  listMarketNewsForSource,
  blockMarketSource,
  unblockMarketSource,
} = require('../../lib/news/blocked-sources');

function parseSource(req) {
  const fromBody = req.body?.source;
  const fromQuery = req.query?.source;
  const fromParam = req.params?.source;
  const raw = fromBody != null ? fromBody : (fromQuery != null ? fromQuery : fromParam);
  if (raw == null) return '';
  try {
    return decodeURIComponent(String(raw)).trim();
  } catch {
    return String(raw).trim();
  }
}

// GET /api/admin/market-news-sources?search=&filter=all|blocked|active&page=&limit=
router.get('/', async (req, res) => {
  try {
    const result = await listMarketSources({
      search: req.query.search,
      filter: req.query.filter,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (err) {
    console.error('Market news sources list failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to list sources' });
  }
});

// GET /api/admin/market-news-sources/news?source=&page=&limit=&search=
router.get('/news', async (req, res) => {
  const source = parseSource(req);
  if (!source) return res.status(400).json({ error: 'source is required' });
  try {
    const result = await listMarketNewsForSource(source, {
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    });
    res.json(result);
  } catch (err) {
    console.error('Market news for source failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to load news' });
  }
});

// POST /api/admin/market-news-sources/block  { source, note? }
router.post('/block', express.json({ limit: '32kb' }), async (req, res) => {
  const source = parseSource(req);
  if (!source) return res.status(400).json({ error: 'source is required' });
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : null;
    const blockedBy = null;
    const result = await blockMarketSource(source, { blockedBy, note });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Block market news source failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to block source' });
  }
});

// POST /api/admin/market-news-sources/unblock  { source }
router.post('/unblock', express.json({ limit: '32kb' }), async (req, res) => {
  const source = parseSource(req);
  if (!source) return res.status(400).json({ error: 'source is required' });
  try {
    const result = await unblockMarketSource(source);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Unblock market news source failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to unblock source' });
  }
});

module.exports = router;
