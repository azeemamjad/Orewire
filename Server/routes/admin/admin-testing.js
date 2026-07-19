const crypto = require('crypto');
const express = require('express');

const { getActiveProvider } = require('../../lib/ai/ollama-store');
const { CANONICAL_TYPES } = require('../../lib/scraper/analyzer/classify');
const {
  getTypePrompt,
  isCustom,
  saveTypePrompt,
  defaultPromptForType,
  getDraftPrompt,
  saveDraftPrompt,
  clearDraftPrompt,
  listCustomizedTypes,
} = require('../../lib/scraper/analyzer/prompt-store');
const {
  DEFAULT_SAMPLE_SIZE,
  pickUntestedFilings,
  untestedCountsByType,
  resetTestRuns,
  costSummary,
  getFilingById,
  testedStats,
  recordTestRun,
  getBatchRuns,
  analyzeFilingForTest,
  buildBatchZip,
} = require('../../lib/testing/filing-testing');
const {
  startBackfill,
  stopBackfill,
  getStatus: getBackfillStatus,
} = require('../../lib/testing/filing-type-backfill');
const news = require('../../lib/testing/news-testing');
const snap = require('../../lib/testing/snapshot-testing');

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

// Resolve the prompt state for a filing type: the built-in default, the LIVE
// production override (if saved), and any testing-only draft. `prompt`/`source`
// describe what the editor should show (draft first, then production, then
// default) so a draft-in-progress is never lost on reload.
async function buildPromptPayload(filingType) {
  const [productionPrompt, draftPrompt, isProductionCustom] = await Promise.all([
    getTypePrompt(filingType),
    getDraftPrompt(filingType),
    isCustom(filingType),
  ]);
  const defaultPrompt = defaultPromptForType(filingType);
  const source = draftPrompt ? 'draft' : (productionPrompt ? 'production' : 'default');
  return {
    type: filingType,
    defaultPrompt,
    productionPrompt: productionPrompt || null,
    draftPrompt: draftPrompt || null,
    isProductionCustom,
    hasDraft: !!draftPrompt,
    prompt: draftPrompt || productionPrompt || defaultPrompt,
    source,
    isCustom: isProductionCustom,
  };
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

// GET /api/admin/testing/filings/models — model options (so the dropdown can
// populate independently of selecting filings).
router.get('/filings/models', async (_req, res) => {
  try {
    res.json(await buildModelOptions());
  } catch (err) {
    console.error('Testing models failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

// GET /api/admin/testing/filings/types — canonical types, which are customized,
// and how many untested filings remain per type (+ overall total).
router.get('/filings/types', async (_req, res) => {
  try {
    const [customized, counts] = await Promise.all([
      listCustomizedTypes(),
      untestedCountsByType(),
    ]);
    res.json({
      types: CANONICAL_TYPES,
      customized,
      counts: counts.byType,
      untestedTotal: counts.total,
    });
  } catch (err) {
    console.error('Testing types failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load types' });
  }
});

// POST /api/admin/testing/filings/reset — clear tested history so filings can be
// tested again. Optional { filingType } scopes the reset to a single type.
router.post('/filings/reset', express.json(), async (req, res) => {
  try {
    const filingType = req.body?.filingType ? String(req.body.filingType) : null;
    const removed = await resetTestRuns(filingType);
    const stats = await testedStats();
    res.json({ ok: true, filingType, removed, stats });
  } catch (err) {
    console.error('Testing reset failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to reset tested filings' });
  }
});

// Filing-type backfill: classify untyped filings so per-type counts/selection work.
// GET status (poll), POST start, POST stop.
router.get('/filings/backfill-type/status', (_req, res) => {
  res.json(getBackfillStatus());
});

router.post('/filings/backfill-type/start', express.json(), (req, res) => {
  const useAi = req.body?.useAi === true;
  const result = startBackfill({ useAi });
  res.json(result);
});

router.post('/filings/backfill-type/stop', (_req, res) => {
  res.json(stopBackfill());
});

// GET /api/admin/testing/filings/prompt?type=<type> — default, production, and
// draft prompt state for a type
router.get('/filings/prompt', async (req, res) => {
  const type = req.query.type ? String(req.query.type) : null;
  try {
    res.json(await buildPromptPayload(type));
  } catch (err) {
    console.error('Testing get prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load prompt' });
  }
});

// PUT /api/admin/testing/filings/prompt — save a per-type prompt (type optional = default).
// target: 'draft' (default, testing only) or 'production' (LIVE — used by real
// filing analysis). Promoting to production clears the draft copy.
router.put('/filings/prompt', express.json({ limit: '512kb' }), async (req, res) => {
  const prompt = req.body?.prompt;
  const type = req.body?.type ? String(req.body.type) : null;
  const target = req.body?.target === 'production' ? 'production' : 'draft';
  if (typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) is required' });
  if (!prompt.trim()) return res.status(400).json({ error: 'Prompt cannot be empty' });
  try {
    if (target === 'production') {
      await saveTypePrompt(type, prompt);
      await clearDraftPrompt(type);
    } else {
      await saveDraftPrompt(type, prompt);
    }
    res.json({ ok: true, target, ...(await buildPromptPayload(type)) });
  } catch (err) {
    console.error('Testing save prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to save prompt' });
  }
});

// GET /api/admin/testing/cost-summary — AI token/cache accounting per feature
router.get('/cost-summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 3;
    res.json({ days, features: await costSummary({ days }) });
  } catch (err) {
    console.error('Testing cost summary failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load cost summary' });
  }
});

// POST /api/admin/testing/filings/select — pick N random untested filings + open a batch
router.post('/filings/select', express.json(), async (req, res) => {
  try {
    const count = parseInt(req.body?.count, 10) || DEFAULT_SAMPLE_SIZE;
    const filingType = req.body?.filingType ? String(req.body.filingType) : null;
    const filings = await pickUntestedFilings(count, filingType);
    const stats = await testedStats();
    const { models, activeModel, providerType } = await buildModelOptions();
    const promptPayload = await buildPromptPayload(filingType);
    res.json({
      batchId: crypto.randomUUID(),
      requested: count,
      filingType,
      filings,
      stats,
      ...promptPayload,
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
// ── News Releases testing (select N random companies, enrich their news) ─────

// GET /api/admin/testing/news/stats
router.get('/news/stats', async (_req, res) => {
  try {
    res.json(await news.newsTestedStats());
  } catch (err) {
    console.error('News stats failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load news stats' });
  }
});

// POST /api/admin/testing/news/reset — clear tested history so companies with
// news releases can be tested again from the start.
router.post('/news/reset', express.json(), async (_req, res) => {
  try {
    const removed = await news.resetNewsTestRuns();
    const stats = await news.newsTestedStats();
    res.json({ ok: true, removed, stats });
  } catch (err) {
    console.error('News reset failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to reset tested companies' });
  }
});

// GET /api/admin/testing/news/prompt
router.get('/news/prompt', async (_req, res) => {
  try {
    res.json({
      prompt: await news.getActivePrompt(),
      defaultPrompt: news.getDefaultPrompt(),
      isCustom: await news.isPromptCustom(),
    });
  } catch (err) {
    console.error('News get prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load prompt' });
  }
});

// PUT /api/admin/testing/news/prompt
router.put('/news/prompt', express.json({ limit: '256kb' }), async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) is required' });
  if (!prompt.trim()) return res.status(400).json({ error: 'Prompt cannot be empty' });
  try {
    await news.saveTestingPrompt(prompt);
    res.json({ ok: true, isCustom: true });
  } catch (err) {
    console.error('News save prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to save prompt' });
  }
});

// POST /api/admin/testing/news/select — pick N random untested companies + open a batch
router.post('/news/select', express.json(), async (req, res) => {
  try {
    const count = parseInt(req.body?.count, 10) || news.DEFAULT_COMPANY_SAMPLE;
    const companies = await news.pickUntestedCompanies(count);
    const stats = await news.newsTestedStats();
    const { models, activeModel, providerType } = await buildModelOptions();
    res.json({
      batchId: crypto.randomUUID(),
      requested: count,
      companies,
      stats,
      prompt: await news.getActivePrompt(),
      defaultPrompt: news.getDefaultPrompt(),
      isCustom: await news.isPromptCustom(),
      models,
      activeModel,
      providerType,
    });
  } catch (err) {
    console.error('News select failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to select companies' });
  }
});

// POST /api/admin/testing/news/analyze-one — enrich one company's news + record it
router.post('/news/analyze-one', express.json({ limit: '256kb' }), async (req, res) => {
  const companyId = parseInt(req.body?.companyId, 10);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'Invalid companyId' });

  const { batchId, prompt, model } = req.body || {};
  try {
    const company = await news.getCompanyById(companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Extra step: if we have no stored releases for this company, pull them from
    // Newsfile/ASX in real-time, then read again.
    let items = await news.getCompanyNewsItems(companyId);
    let fetched = null;
    if (!items.length) {
      fetched = await news.fetchCompanyReleasesRealtime(company);
      items = await news.getCompanyNewsItems(companyId);
    }
    const result = await news.analyzeCompanyNews({ company, items, prompt, model });

    await news.recordNewsTestRun(companyId, {
      batchId,
      companyName: company.name,
      ticker: company.ticker,
      model: result.model || model,
      ok: result.ok,
      itemCount: result.itemCount ?? items.length,
      durationMs: result.durationMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      results: result.ok ? result.items : null,
      errorMessage: result.ok ? null : result.error,
    });

    res.json({
      companyId,
      company_name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      newsCount: items.length,
      fetched,
      ...result,
    });
  } catch (err) {
    console.error('News analyze-one failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Analysis failed' });
  }
});

// GET /api/admin/testing/news/download?batch=<id>
router.get('/news/download', async (req, res) => {
  const batchId = String(req.query.batch || '').trim();
  if (!batchId) return res.status(400).json({ error: 'Missing batch id' });
  try {
    const rows = await news.getNewsBatchRuns(batchId);
    if (!rows.length) return res.status(404).json({ error: 'No results found for this batch' });
    const zip = news.buildNewsBatchZip(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="news-test-${stamp}.zip"`);
    res.setHeader('Content-Length', zip.length);
    res.send(zip);
  } catch (err) {
    console.error('News download failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to build download' });
  }
});

// ── Snapshots testing (select N random companies, regenerate their snapshot) ──

router.get('/snapshots/stats', async (_req, res) => {
  try {
    res.json(await snap.snapshotTestedStats());
  } catch (err) {
    console.error('Snapshot stats failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load snapshot stats' });
  }
});

router.get('/snapshots/prompt', async (_req, res) => {
  try {
    res.json({
      prompt: await snap.getActivePrompt(),
      defaultPrompt: snap.getDefaultPrompt(),
      isCustom: await snap.isPromptCustom(),
    });
  } catch (err) {
    console.error('Snapshot get prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to load prompt' });
  }
});

router.put('/snapshots/prompt', express.json({ limit: '256kb' }), async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== 'string') return res.status(400).json({ error: 'prompt (string) is required' });
  if (!prompt.trim()) return res.status(400).json({ error: 'Prompt cannot be empty' });
  try {
    await snap.saveTestingPrompt(prompt);
    res.json({ ok: true, isCustom: true });
  } catch (err) {
    console.error('Snapshot save prompt failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to save prompt' });
  }
});

router.post('/snapshots/select', express.json(), async (req, res) => {
  try {
    const count = parseInt(req.body?.count, 10) || snap.DEFAULT_COMPANY_SAMPLE;
    const companies = await snap.pickUntestedCompanies(count);
    const stats = await snap.snapshotTestedStats();
    const { models, activeModel, providerType } = await buildModelOptions();
    res.json({
      batchId: crypto.randomUUID(),
      requested: count,
      companies,
      stats,
      prompt: await snap.getActivePrompt(),
      defaultPrompt: snap.getDefaultPrompt(),
      isCustom: await snap.isPromptCustom(),
      models,
      activeModel,
      providerType,
    });
  } catch (err) {
    console.error('Snapshot select failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to select companies' });
  }
});

router.post('/snapshots/analyze-one', express.json({ limit: '256kb' }), async (req, res) => {
  const companyId = parseInt(req.body?.companyId, 10);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'Invalid companyId' });

  const { batchId, prompt, model } = req.body || {};
  try {
    const company = await snap.getCompanyById(companyId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    // Extra step: if we have no stored releases for this company, pull them from
    // Newsfile/ASX in real-time so the snapshot has fresh material to work from.
    const existing = await news.getCompanyNewsItems(companyId, 1);
    let fetched = null;
    if (!existing.length) {
      fetched = await news.fetchCompanyReleasesRealtime(company);
    }

    const result = await snap.analyzeCompanySnapshot({ company, prompt, model });

    await snap.recordSnapshotTestRun(companyId, {
      batchId,
      companyName: company.name,
      ticker: company.ticker,
      model: result.model || model,
      ok: result.ok,
      durationMs: result.durationMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      result: result.ok ? { body: result.body, paragraphs: result.paragraphs, keyPoints: result.keyPoints } : null,
      errorMessage: result.ok ? null : result.error,
    });

    res.json({
      companyId,
      company_name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      fetched,
      ...result,
    });
  } catch (err) {
    console.error('Snapshot analyze-one failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Analysis failed' });
  }
});

router.get('/snapshots/download', async (req, res) => {
  const batchId = String(req.query.batch || '').trim();
  if (!batchId) return res.status(400).json({ error: 'Missing batch id' });
  try {
    const rows = await snap.getSnapshotBatchRuns(batchId);
    if (!rows.length) return res.status(404).json({ error: 'No results found for this batch' });
    const zip = snap.buildSnapshotBatchZip(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="snapshot-test-${stamp}.zip"`);
    res.setHeader('Content-Length', zip.length);
    res.send(zip);
  } catch (err) {
    console.error('Snapshot download failed:', err?.message || err);
    res.status(500).json({ error: 'Failed to build download' });
  }
});

module.exports = router;
