const express = require('express');
const { chatWithSystem } = require('../../lib/ai/client');
const {
  listOllamaProviders,
  getOllamaProviderById,
  createOllamaProvider,
  updateOllamaProvider,
  formatProviderRow,
  listRecentUsageEvents,
  invalidateOllamaCache,
  getActiveOllamaProvider,
  envFallbackProvider,
} = require('../../lib/ai/ollama-store');
const { retentionDays } = require('../../lib/usage-log-retention');

const router = express.Router();

function validateBody(body, { isCreate = false } = {}) {
  const data = {};

  if (body.name !== undefined || isCreate) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required' };
    data.name = name;
  }

  if (body.host !== undefined || isCreate) {
    const host = String(body.host || '').trim();
    if (!host) return { error: 'Host is required' };
    data.host = host;
  }

  if (body.defaultModel !== undefined || isCreate) {
    const default_model = String(body.defaultModel || body.default_model || '').trim();
    if (!default_model) return { error: 'Default model is required' };
    data.default_model = default_model;
  }

  if (body.apiKey !== undefined || body.api_key !== undefined) {
    data.api_key = String(body.apiKey ?? body.api_key ?? '');
  }
  if (body.enabled !== undefined) {
    data.enabled = !!body.enabled;
  }

  return { data };
}

// GET /api/admin/ai
router.get('/', async (_req, res) => {
  try {
    const rows = await listOllamaProviders();
    const active = await getActiveOllamaProvider();
    const envFallback = envFallbackProvider();
    res.json({
      active: active ? formatProviderRow(active) : null,
      envFallback: envFallback && !rows.length ? formatProviderRow(envFallback) : null,
      items: rows.map((r) => formatProviderRow(r)),
    });
  } catch (err) {
    console.error('List AI providers failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load AI config' });
  }
});

// GET /api/admin/ai/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await getOllamaProviderById(id);
    if (!row) return res.status(404).json({ error: 'Provider not found' });
    const events = await listRecentUsageEvents(id, 50);
    res.json({
      provider: formatProviderRow(row),
      retentionDays: retentionDays(),
      recentUsage: events.map((e) => ({
        id: e.id,
        feature: e.feature,
        model: e.model,
        startedAt: e.started_at,
        endedAt: e.ended_at,
        durationMs: e.duration_ms,
        status: e.status,
        promptTokens: e.prompt_tokens,
        completionTokens: e.completion_tokens,
        totalTokens: e.total_tokens,
        errorMessage: e.error_message,
      })),
    });
  } catch (err) {
    console.error('Get AI provider failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load provider' });
  }
});

// POST /api/admin/ai
router.post('/', express.json(), async (req, res) => {
  const v = validateBody(req.body || {}, { isCreate: true });
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const existing = await listOllamaProviders();
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ollama provider already exists — edit the existing row' });
    }
    const row = await createOllamaProvider({
      name: v.data.name,
      host: v.data.host,
      api_key: v.data.api_key,
      default_model: v.data.default_model,
      enabled: v.data.enabled !== false,
    });
    invalidateOllamaCache();
    res.status(201).json({ provider: formatProviderRow(row) });
  } catch (err) {
    console.error('Create AI provider failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to create provider' });
  }
});

// PATCH /api/admin/ai/:id
router.patch('/:id', express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const v = validateBody(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const existing = await getOllamaProviderById(id);
    if (!existing) return res.status(404).json({ error: 'Provider not found' });

    const row = await updateOllamaProvider(id, v.data);
    invalidateOllamaCache();
    res.json({ provider: formatProviderRow(row) });
  } catch (err) {
    console.error('Update AI provider failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to update provider' });
  }
});

// POST /api/admin/ai/:id/test
router.post('/:id/test', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await getOllamaProviderById(id);
    if (!row) return res.status(404).json({ error: 'Provider not found' });

    invalidateOllamaCache();
    const result = await chatWithSystem({
      feature: 'admin_test',
      system: 'Reply with exactly: OK',
      user: 'Say OK',
    });

    res.json({
      provider: formatProviderRow(row),
      test: {
        ok: true,
        model: result.model,
        content: result.content,
        durationMs: result.durationMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      },
    });
  } catch (err) {
    console.error('Test AI provider failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Test failed' });
  }
});

module.exports = router;
