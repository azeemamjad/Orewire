const express = require('express');
const router = express.Router();
const {
  listSymbols,
  createSymbol,
  updateSymbol,
  deleteSymbol,
  parseTvSymbol,
} = require('../../lib/market/instrument-symbols-store');
const { isTvSymbolHealthy, clearCompanySymbolFlag } = require('../../lib/market/symbol-health');

const VALID_TYPES = new Set(['company', 'commodity', 'currency', 'index']);

// GET /api/admin/instrument-symbols/market-keys/list
router.get('/market-keys/list', async (_req, res) => {
  try {
    const { COMMODITY_SYMBOLS, CURRENCY_SYMBOLS, INDEX_SYMBOLS } = require('../../lib/market/payloads');
    res.json({
      commodities: COMMODITY_SYMBOLS.map((c) => ({ key: c.key, label: c.label })),
      currencies: CURRENCY_SYMBOLS.map((c) => ({ key: c.key, label: c.label })),
      indexes: INDEX_SYMBOLS.map((c) => ({ key: c.key, label: c.label })),
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// GET /api/admin/instrument-symbols?entity_type=company&entity_id=1
router.get('/', async (req, res) => {
  try {
    const entityType = String(req.query.entity_type || '').toLowerCase();
    if (!VALID_TYPES.has(entityType)) {
      return res.status(400).json({ error: 'entity_type required (company|commodity|currency|index)' });
    }
    const entityId = req.query.entity_id ? parseInt(req.query.entity_id, 10) : null;
    const entityKey = req.query.entity_key || null;
    if (entityType === 'company' && !entityId) {
      return res.status(400).json({ error: 'entity_id required for company' });
    }
    if (entityType !== 'company' && !entityKey) {
      return res.status(400).json({ error: 'entity_key required' });
    }
    const items = await listSymbols(entityType, { entityId, entityKey });
    res.json({ items });
  } catch (err) {
    console.error('Instrument symbols list failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// POST /api/admin/instrument-symbols
router.post('/', express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const entityType = String(body.entity_type || '').toLowerCase();
    if (!VALID_TYPES.has(entityType)) {
      return res.status(400).json({ error: 'Invalid entity_type' });
    }
    let { exchange, ticker, tv_symbol, label, is_default, sort_order } = body;
    if (!ticker && tv_symbol) {
      const parsed = parseTvSymbol(tv_symbol);
      ticker = parsed.ticker;
      exchange = exchange || parsed.exchange;
    }
    if (!tv_symbol && exchange && ticker) {
      tv_symbol = `${exchange}:${ticker}`;
    }
    if (!ticker || !tv_symbol) {
      return res.status(400).json({ error: 'ticker and tv_symbol required' });
    }

    const row = await createSymbol({
      entity_type: entityType,
      entity_id: body.entity_id || null,
      entity_key: body.entity_key || null,
      exchange,
      ticker,
      tv_symbol,
      label,
      is_default: !!is_default,
      sort_order: sort_order ?? 0,
    });

    if (entityType === 'company' && body.entity_id && is_default) {
      const healthy = await isTvSymbolHealthy(tv_symbol);
      if (healthy) await clearCompanySymbolFlag(body.entity_id);
    }

    res.status(201).json(row);
  } catch (err) {
    console.error('Instrument symbol create failed:', err?.message || err);
    res.status(503).json({ error: err.message || 'Database unavailable' });
  }
});

// PATCH /api/admin/instrument-symbols/:id
router.patch('/:id', express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const patch = { ...req.body };
    if (patch.tv_symbol && !patch.ticker) {
      const parsed = parseTvSymbol(patch.tv_symbol);
      patch.ticker = parsed.ticker;
      patch.exchange = patch.exchange || parsed.exchange;
    }
    const row = await updateSymbol(id, patch);
    if (!row) return res.status(404).json({ error: 'Not found' });

    if (row.entity_type === 'company' && row.entity_id && row.is_default) {
      const healthy = await isTvSymbolHealthy(row.tv_symbol);
      if (healthy) await clearCompanySymbolFlag(row.entity_id);
    }

    res.json(row);
  } catch (err) {
    console.error('Instrument symbol update failed:', err?.message || err);
    res.status(503).json({ error: err.message || 'Database unavailable' });
  }
});

// DELETE /api/admin/instrument-symbols/:id
router.delete('/:id', async (req, res) => {
  try {
    const row = await deleteSymbol(parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, deleted: row });
  } catch (err) {
    console.error('Instrument symbol delete failed:', err?.message || err);
    res.status(503).json({ error: err.message || 'Database unavailable' });
  }
});

module.exports = router;
