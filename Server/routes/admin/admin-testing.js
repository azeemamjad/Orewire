const crypto = require('crypto');
const express = require('express');

const { getActiveProvider } = require('../../lib/ai/ollama-store');
const {
  DEFAULT_SAMPLE_SIZE,
  getDefaultPrompt,
  getActivePrompt,
  isPromptCustom,
  saveTestingPrompt,
  pickUntestedFilings,
  getFilingById,
  testedStats,
  recordTestRun,
  getBatchRuns,
  analyzeFilingForTest,
  buildBatchZip,
} = require('../../lib/testing/filing-testing');

const router = express.Router();

// Curated DeepSeek model options; the active provider's configured model is
// always offered first so the picker matches what production uses.
const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'];

async function buildModelOptions() {
  let activeModel = null;
  let providerType = 'deepseek';
  try {
    const provider = await getActiveProvider();
    if (provider) {
      activeModel = provider.default_model || null;
      providerType = provider.provider || providerType;
    }
  } catch { /* fall back to defaults */ }

  const models = [];
  if (activeModel) models.push(activeModel);
  for (const m of DEEPSEEK_MODELS) {
    if (!models.includes(m)) models.push(m);
  }
  return { models, activeModel: activeModel || models[0] || 'deepseek-chat', providerType };
}

// GET /api/admin/testing/filings/stats
router.get('/filings/stats', async (_req, res) => {
  try {
    res.json(await testedStats());
  } catch (err) {
    console.error('Testing stats failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load testing stats' });
  }
});

// GET /api/admin/testing/filings/prompt — the saved (or default) analysis prompt
router.get('/filings/prompt', async (_req, res) => {
  try {
    res.json({
      prompt: await getActivePrompt(),
      defaultPrompt: getDefaultPrompt(),
      isCustom: await isPromptCustom(),
    });
  } catch (err) {
    console.error('Testing get prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load prompt' });
  }
});

// PUT /api/admin/testing/filings/prompt — save/update the analysis prompt
router.put('/filings/prompt', express.json({ limit: '512kb' }), async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) is required' });
  if (!prompt.trim()) return res.status(400).json({ error: 'Prompt cannot be empty' });
  try {
    await saveTestingPrompt(prompt);
    res.json({ ok: true, isCustom: true });
  } catch (err) {
    console.error('Testing save prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to save prompt' });
  }
});

// POST /api/admin/testing/filings/select — pick N random untested filings + open a batch
router.post('/filings/select', express.json(), async (req, res) => {
  try {
    const count = parseInt(req.body?.count, 10) || DEFAULT_SAMPLE_SIZE;
    const filings = await pickUntestedFilings(count);
    const stats = await testedStats();
    const { models, activeModel, providerType } = await buildModelOptions();
    res.json({
      batchId: crypto.randomUUID(),
      requested: count,
      filings,
      stats,
      prompt: await getActivePrompt(),
      defaultPrompt: getDefaultPrompt(),
      isCustom: await isPromptCustom(),
      models,
      activeModel,
      providerType,
    });
  } catch (err) {
    console.error('Testing select failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to select filings' });
  }
});

// POST /api/admin/testing/filings/analyze-one — analyze a single filing and record it
router.post('/filings/analyze-one', express.json({ limit: '1mb' }), async (req, res) => {
  const filingId = parseInt(req.body?.filingId, 10);
  if (!Number.isFinite(filingId)) return res.status(400).json({ error: 'Invalid filingId' });

  const { batchId, prompt, model } = req.body || {};

  try {
    const filing = await getFilingById(filingId);
    if (!filing) return res.status(404).json({ error: 'Filing not found' });

    const result = await analyzeFilingForTest({ filing, prompt, model });

    await recordTestRun(filingId, {
      batchId,
      companyName: filing.company_name,
      exchange: filing.exchange,
      filingType: filing.filing_type,
      model: result.model || model,
      verdict: result.verdict,
      ok: result.ok,
      durationMs: result.durationMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      analysis: result.ok ? result.analysis : null,
      rawResponse: result.raw || null,
      errorMessage: result.ok ? null : result.error,
    });

    res.json({
      filingId,
      company_name: filing.company_name,
      exchange: filing.exchange,
      filing_type: filing.filing_type,
      ticker: filing.ticker,
      ...result,
    });
  } catch (err) {
    console.error('Testing analyze-one failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Analysis failed' });
  }
});

// GET /api/admin/testing/filings/download?batch=<id> — zip of every result in a batch
router.get('/filings/download', async (req, res) => {
  const batchId = String(req.query.batch || '').trim();
  if (!batchId) return res.status(400).json({ error: 'Missing batch id' });

  try {
    const rows = await getBatchRuns(batchId);
    if (!rows.length) return res.status(404).json({ error: 'No results found for this batch' });

    const zip = await buildBatchZip(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="filing-test-${stamp}.zip"`);
    res.setHeader('Content-Length', zip.length);
    res.send(zip);
  } catch (err) {
    console.error('Testing download failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to build download' });
  }
});

// Placeholder sub-tabs — under development.
router.get('/news-releases/status', (_req, res) => res.json({ status: 'under_development' }));
router.get('/snapshots/status', (_req, res) => res.json({ status: 'under_development' }));

module.exports = router;
