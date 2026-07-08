const express = require('express');
const { chatWithSystem } = require('../../lib/ai/client');
const {
  ALLOWED_PROVIDERS,
  listProviders,
  getProviderById,
  createProvider,
  updateProvider,
  setDefaultProvider,
  formatProviderRow,
  listRecentUsageEvents,
  invalidateProviderCache,
  getActiveProvider,
  envFallbackProvider,
} = require('../../lib/ai/ollama-store');
const { retentionDays } = require('../../lib/usage-log-retention');
const { getAiPaused, setAiPaused } = require('../../lib/ai/ai-settings');

const router = express.Router();

function validateBody(body, { isCreate = false } = {}) {
  const data = {};

  if (body.name !== undefined || isCreate) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Name is required' };
    data.name = name;
  }

  if (body.provider !== undefined || isCreate) {
    const provider = String(body.provider || 'ollama').toLowerCase().trim();
    if (!ALLOWED_PROVIDERS.has(provider)) {
      return { error: `provider must be one of: ${[...ALLOWED_PROVIDERS].join(', ')}` };
    }
    data.provider = provider;
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
  if (body.isDefault !== undefined || body.is_default !== undefined) {
    data.is_default = !!(body.isDefault ?? body.is_default);
  }

  return { data };
}

// GET /api/admin/ai
router.get('/', async (_req, res) => {
  try {
    const rows = await listProviders();
    const active = await getActiveProvider();
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

// GET /api/admin/ai/pause-state — global AI pause switch (before /:id routes)
router.get('/pause-state', async (_req, res) => {
  try {
    res.json({ paused: await getAiPaused() });
  } catch (err) {
    console.error('Get AI pause state failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to read pause state' });
  }
});

// POST /api/admin/ai/pause  and  /api/admin/ai/resume
router.post('/pause', async (_req, res) => {
  try {
    await setAiPaused(true);
    res.json({ paused: true });
  } catch (err) {
    console.error('Pause AI failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to pause AI' });
  }
});

router.post('/resume', async (_req, res) => {
  try {
    await setAiPaused(false);
    res.json({ paused: false });
  } catch (err) {
    console.error('Resume AI failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to resume AI' });
  }
});

// POST /api/admin/ai/:id/set-default — before /:id routes that might conflict
router.post('/:id/set-default', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await setDefaultProvider(id);
    if (!row) return res.status(404).json({ error: 'Provider not found' });
    invalidateProviderCache();
    res.json({ provider: formatProviderRow(row) });
  } catch (err) {
    console.error('Set default AI provider failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Failed to set default' });
  }
});

// GET /api/admin/ai/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await getProviderById(id);
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
    const providerType = v.data.provider || 'ollama';
    const existing = await listProviders();
    if (existing.some((r) => r.provider === providerType)) {
      return res.status(409).json({
        error: `${providerType} provider already exists — edit the existing row`,
      });
    }
    const row = await createProvider({
      name: v.data.name,
      provider: providerType,
      host: v.data.host,
      api_key: v.data.api_key,
      default_model: v.data.default_model,
      enabled: v.data.enabled !== false,
      is_default: v.data.is_default === true || existing.length === 0,
    });
    invalidateProviderCache();
    res.status(201).json({ provider: formatProviderRow(row) });
  } catch (err) {
    console.error('Create AI provider failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Failed to create provider' });
  }
});

// PATCH /api/admin/ai/:id
router.patch('/:id', express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const v = validateBody(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const existing = await getProviderById(id);
    if (!existing) return res.status(404).json({ error: 'Provider not found' });

    const row = await updateProvider(id, v.data);
    invalidateProviderCache();
    res.json({ provider: formatProviderRow(row) });
  } catch (err) {
    console.error('Update AI provider failed:', err?.message || err);
    res.status(500).json({ error: err.message || 'Failed to update provider' });
  }
});

// POST /api/admin/ai/:id/test
router.post('/:id/test', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const row = await getProviderById(id);
    if (!row) return res.status(404).json({ error: 'Provider not found' });

    invalidateProviderCache();
    const result = await chatWithSystem({
      feature: 'admin_test',
      system: 'Reply with exactly: OK',
      user: 'Say OK',
      provider: row,
      bypassPause: true,
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
