const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const db         = require('../db');
const { state, addLog } = require('./state');
const { load: loadConfig } = require('./config');
const { upsertInsiderData } = require('../db/insiders');
const { DOWNLOADS_DIR } = require('../lib/scraper/paths');
const { findCompanyForFiling } = require('../lib/companies/match');
const {
  resolveFilingStatus,
  analyzedFlagForAnalysis,
  aiOutputParams,
  AI_OUTPUT_SQL,
} = require('../lib/scraper/analyzer/persist');
const { isExtractionFailed } = require('../lib/scraper/analyzer/constants');
const {
  isStorageEnabled,
  persistFilingPdf,
  localPathToObjectKey,
} = require('../lib/infra/object-storage');
const { applyScraperEnv, restoreScraperEnv, relayWiringEnabled } = require('../lib/scraper/env');
const { runSedarDownload } = require('../lib/scraper/runners/sedar');
const { runAsxDownload } = require('../lib/scraper/runners/asx');
const { runAnalyzeOne } = require('../lib/scraper/runners/analyze-one');

// company = { name, ticker, exchange }
async function spawnWorker(company, workerId, cfg) {
  const isASX = company.exchange === 'ASX';
  const arg = isASX ? (company.ticker || company.name) : company.name;
  const tag = `[W${workerId}|${arg.substring(0, 22)}]`;
  const relaySlot = isASX
    ? ((workerId - 1) % 5) + 1
    : ((workerId - 1) % 3) + 1;

  if (relayWiringEnabled()) {
    addLog('out', `${tag} → Relay ${isASX ? 'DC' : 'RES'}-${relaySlot}`);
  }

  const saved = applyScraperEnv({ relay: relayWiringEnabled() });
  try {
    if (isASX) {
      await runAsxDownload(arg, {
        noAnalyze: true,
        daysBack: cfg.daysBack,
        relaySlot,
        taskSlug: 'pipeline_asx_batch',
      });
    } else {
      await runSedarDownload(arg, {
        noAnalyze: true,
        relaySlot,
        taskSlug: 'pipeline_sedar_batch',
      });
    }
    state.progress.done++;
    addLog('out', `${tag} ✓ download done`);
    return 0;
  } catch (err) {
    state.progress.errors++;
    addLog('err', `${tag} ✗ ${err.message}`);
    return 1;
  } finally {
    restoreScraperEnv(saved);
  }
}

async function runDownloadQueue(companies, cfg) {
  const queue = [...companies];
  let workerIdx = 0;

  async function drain(id) {
    while (queue.length > 0) {
      if (state.stopRequested) {
        addLog('warn', `[Pipeline] Worker ${id} stopping (stop requested)`);
        return;
      }
      const company = queue.shift();
      if (!company) break;
      await spawnWorker(company, id, cfg);
      // After each download completes, queue its PDFs for analysis
      if (cfg.analyze) {
        queueAnalysesForCompany(company);
        drainAnalysisQueue(cfg);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(cfg.concurrency, companies.length); i++) {
    workers.push(drain(++workerIdx));
  }
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Analysis queue — find new PDFs and queue them for AI processing
// ---------------------------------------------------------------------------

const analysisQueue = [];   // { pdfPath, companyDir, company, ticker, exchange }
let activeAnalysis = 0;

function queueAnalysesForCompany(company) {
  const isASX = company.exchange === 'ASX';
  const dirName = isASX ? (company.ticker || company.name) : company.name.replace(/[^\w\s-]/g, '_').trim();
  const companyDir = path.join(DOWNLOADS_DIR, dirName);

  if (!fs.existsSync(companyDir)) return;
  if (!fs.statSync(companyDir).isDirectory()) return;

  const files = fs.readdirSync(companyDir);
  const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

  for (const pdf of pdfs) {
    const analysisFile = pdf.replace(/\.pdf$/i, '_analysis.json');
    if (files.includes(analysisFile)) continue; // already analyzed

    const pdfPath = path.join(companyDir, pdf);
    analysisQueue.push({
      pdfPath,
      companyDir,
      company: company.name,
      ticker: company.ticker || dirName,
      exchange: company.exchange,
    });
  }

  if (pdfs.length > 0) {
    state.analysisProgress.total = analysisQueue.length;
    addLog('out', `[Pipeline] Queued PDFs for ${dirName} (queue: ${analysisQueue.length})`);
  }
}

function drainAnalysisQueue(cfg) {
  const maxWorkers = cfg.analysisConcurrency || 2;

  while (analysisQueue.length > 0 && activeAnalysis < maxWorkers) {
    if (state.stopRequested) return;

    const item = analysisQueue.shift();
    activeAnalysis++;
    state.analysisProgress.total = analysisQueue.length + activeAnalysis + state.analysisProgress.done;

    spawnAnalysisWorker(item, cfg);
  }
}

async function spawnAnalysisWorker(item, cfg) {
  const { pdfPath, companyDir, company, ticker, exchange } = item;
  const meta = { company_name: company, ticker, exchange };
  const tag = `[AI|${path.basename(pdfPath).substring(0, 30)}]`;

  addLog('out', `${tag} Starting analysis…`);

  const saved = applyScraperEnv({ relay: false });
  try {
    const result = await runAnalyzeOne(pdfPath, meta);
    addLog('out', `${tag} ✓ verdict: ${result.verdict}`);
    try {
      await saveOneFiling(pdfPath, companyDir, company, ticker, exchange);
      addLog('out', `${tag} ✓ saved to DB`);
    } catch (dbErr) {
      addLog('err', `${tag} DB save failed: ${dbErr.message}`);
    }
    state.analysisProgress.done++;
  } catch (err) {
    addLog('err', `${tag} ✗ ${err.message}`);
    state.analysisProgress.errors++;
  } finally {
    restoreScraperEnv(saved);
    activeAnalysis--;
    drainAnalysisQueue(cfg);
  }
}

// ---------------------------------------------------------------------------
// Save a single filing + AI output to DB immediately
// ---------------------------------------------------------------------------

function inferCommodity(summary, tickerSummary) {
  const text = `${summary || ''} ${tickerSummary || ''}`.toLowerCase();
  if (/\b(gold|au\b|g\/t|oz.*gold)\b/i.test(text)) return 'Gold';
  if (/\b(silver|ag\b)\b/i.test(text)) return 'Silver';
  if (/\b(copper|cu\b|cu.*eq|copper equivalent)\b/i.test(text)) return 'Copper';
  if (/\b(lithium|li\b|spodumene|lithium.*carbonate)\b/i.test(text)) return 'Lithium';
  if (/\b(uranium|u3o8|u₃o₈)\b/i.test(text)) return 'Uranium';
  if (/\b(nickel|ni\b)\b/i.test(text)) return 'Nickel';
  return null;
}

async function saveOneFiling(pdfPath, companyDir, companyName, ticker, exchange) {
  const analysisPath = pdfPath.replace(/\.pdf$/i, '_analysis.json');
  if (!fs.existsSync(analysisPath)) return;

  const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
  const pdfName = path.basename(pdfPath);
  const commodity = inferCommodity(analysis.summary, analysis.ticker_summary);

  let storedPdfPath = pdfPath;
  if (isStorageEnabled() && fs.existsSync(pdfPath)) {
    const objectKey = localPathToObjectKey(pdfPath, DOWNLOADS_DIR);
    storedPdfPath = await persistFilingPdf(pdfPath, objectKey);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const companyRow = await findCompanyForFiling(client, {
      ticker,
      exchange,
      companyName,
    });
    const displayName = companyRow?.name || companyName;
    const status = resolveFilingStatus(analysis, displayName);
    const analyzed = analyzedFlagForAnalysis(analysis);

    const insFilin = `
      INSERT INTO filings
        (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (pdf_path) DO NOTHING
      RETURNING id
    `;

    const fiResult = await client.query(insFilin, [
      companyRow?.id ?? null,
      displayName,
      pdfName,
      storedPdfPath,
      commodity,
      companyRow?.exchange || exchange,
      analyzed,
      status,
    ]);

    const fid = fiResult.rows[0]?.id;
    if (!fid) {
      // Already exists (conflict) — update AI output instead
      const existing = await client.query(
        'SELECT id FROM filings WHERE pdf_path = $1 OR pdf_path = $2',
        [pdfPath, storedPdfPath],
      );
      if (existing.rows[0]) {
        const existingFid = existing.rows[0].id;
        const ext = analysis.data_extracted || {};
        await client.query(
          `UPDATE filings SET analyzed = $2, status = $3 WHERE id = $1`,
          [existingFid, analyzed, status],
        );
        await client.query(AI_OUTPUT_SQL, aiOutputParams(existingFid, analysis));
        if (!isExtractionFailed(analysis)) {
          await upsertInsiderData(client, companyRow?.id, existingFid, ext);
        }
      }
    } else {
      const ext = analysis.data_extracted || {};
      await client.query(AI_OUTPUT_SQL, aiOutputParams(fid, analysis));
      if (!isExtractionFailed(analysis)) {
        await upsertInsiderData(client, companyRow?.id, fid, ext);
      }
    }

    await client.query('COMMIT');

    if (companyRow?.id) {
      try {
        const { scheduleSnapshotRegeneration } = require('../lib/company-snapshot');
        scheduleSnapshotRegeneration(companyRow.id, 'new-filing-analysis');
      } catch {
        /* optional */
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Post-run sync: import any analysis JSONs that fell through the cracks
// ---------------------------------------------------------------------------

async function syncAnalyses() {
  if (!fs.existsSync(DOWNLOADS_DIR)) return { imported: 0, skipped: 0, errors: 0 };

  const client = await db.connect();
  const stats = { imported: 0, skipped: 0, errors: 0 };

  try {
    await client.query('BEGIN');

    const insFilin = `
      INSERT INTO filings
        (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (pdf_path) DO NOTHING
      RETURNING id
    `;

    const dirs = fs.readdirSync(DOWNLOADS_DIR)
      .filter(f => fs.statSync(path.join(DOWNLOADS_DIR, f)).isDirectory());

    for (const dir of dirs) {
      const dp    = path.join(DOWNLOADS_DIR, dir);
      const jsons = fs.readdirSync(dp).filter(f => f.endsWith('_analysis.json'));
      for (const jf of jsons) {
        const pdfName = jf.replace(/_analysis\.json$/, '.pdf');
        const pdfPath = path.join(dp, pdfName);
        try {
          let storedPdfPath = pdfPath;
          if (isStorageEnabled() && fs.existsSync(pdfPath)) {
            const objectKey = localPathToObjectKey(pdfPath, DOWNLOADS_DIR);
            storedPdfPath = await persistFilingPdf(pdfPath, objectKey);
          }

          const existing = await client.query(
            'SELECT id FROM filings WHERE pdf_path = $1 OR pdf_path = $2',
            [pdfPath, storedPdfPath],
          );
          if (existing.rows.length > 0) { stats.skipped++; continue; }

          const analysis = JSON.parse(fs.readFileSync(path.join(dp, jf), 'utf8'));
          const companyRow = await findCompanyForFiling(client, {
            ticker: dir,
            companyName: dir.replace(/_/g, ' '),
          });
          const companyName = companyRow?.name || dir.replace(/_/g, ' ');
          const commodity = inferCommodity(analysis.summary, analysis.ticker_summary);
          const status = resolveFilingStatus(analysis, companyName);
          const analyzed = analyzedFlagForAnalysis(analysis);

          const fiResult = await client.query(insFilin, [
            companyRow?.id ?? null,
            companyName,
            pdfName,
            storedPdfPath,
            commodity,
            companyRow?.exchange || null,
            analyzed,
            status,
          ]);
          const fid = fiResult.rows[0]?.id;
          if (!fid) { stats.skipped++; continue; }

          const ext = analysis.data_extracted || {};
          await client.query(AI_OUTPUT_SQL, aiOutputParams(fid, analysis));
          if (!isExtractionFailed(analysis)) {
            await upsertInsiderData(client, companyRow?.id, fid, ext);
          }
          stats.imported++;
        } catch (err) {
          stats.errors++;
          addLog('err', `[Sync] ${jf}: ${err.message}`);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    addLog('err', `[Sync] Fatal: ${err.message}`);
  } finally {
    client.release();
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Seed step: POST to our own seeder endpoints
// ---------------------------------------------------------------------------

function httpPost(path) {
  return new Promise((resolve) => {
    const port = process.env.PORT || 3000;
    const body = '{}';
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve({ raw: buf.substring(0, 200) }); }
      });
    });
    req.on('error', err => resolve({ error: err.message }));
    req.write(body);
    req.end();
  });
}

async function seedCompanies(includeAsx = false) {
  const seeders = [['TSX/TSXV', '/api/seeder/tsx'], ['CSE', '/api/seeder/cse']];
  if (includeAsx) seeders.push(['ASX', '/api/seeder/asx']);

  for (const [label, endpoint] of seeders) {
    addLog('out', `[Pipeline] Seeding ${label}…`);
    const result = await httpPost(endpoint);
    if (result.error) {
      addLog('err', `[Pipeline] ${label} seeder error: ${result.error}`);
    } else {
      addLog('out', `[Pipeline] ${label}: inserted=${result.inserted ?? '?'}, skipped=${result.skipped ?? '?'}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Wait for all in-flight analysis workers to finish
// ---------------------------------------------------------------------------

function waitForAnalysis() {
  return new Promise((resolve) => {
    const check = () => {
      if (analysisQueue.length === 0 && activeAnalysis === 0) return resolve();
      setTimeout(check, 500);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function runPipeline() {
  if (state.status === 'running') {
    addLog('warn', '[Pipeline] Already running — ignoring start request');
    return;
  }

  const cfg = loadConfig();
  state.status        = 'running';
  state.activePipeline = 'main';
  state.startedAt     = new Date().toISOString();
  state.stoppedAt     = null;
  state.stopRequested = false;
  state.progress      = { total: 0, done: 0, errors: 0 };
  state.analysisProgress = { total: 0, done: 0, errors: 0 };

  addLog('out', `[Pipeline] ── Run started at ${state.startedAt} ──`);
  addLog('out', `[Pipeline] concurrency=${cfg.concurrency}  analysisConcurrency=${cfg.analysisConcurrency || 2}  daysBack=${cfg.daysBack}  analyze=${cfg.analyze}`);

  try {
    // ── Phase 1: Seed ────────────────────────────────────────────────────────
    if (cfg.seedOnStart) {
      state.currentPhase = 'seeding';
      addLog('out', '[Pipeline] Phase 1/3: seeding company lists…');
      await seedCompanies(cfg.asxSeedOnStart);
      addLog('out', '[Pipeline] Seeding complete.');
    }

    if (state.stopRequested) {
      addLog('warn', '[Pipeline] Stopped after seeding phase.');
      return;
    }

    // ── Phase 2: Scrape + Analyze (streaming) ────────────────────────────────
    state.currentPhase = 'scraping';
    const allCompaniesResult = await db.query('SELECT name, ticker, exchange FROM companies ORDER BY name');
    const allCompanies = allCompaniesResult.rows;

    if (allCompanies.length > 0 && !state.stopRequested) {
      addLog('out', `[Pipeline] Phase 2: scraping ${allCompanies.length} companies (${cfg.concurrency} download workers, ${cfg.analysisConcurrency || 2} AI workers)…`);
      state.progress.total += allCompanies.length;
      await runDownloadQueue(allCompanies, cfg);
    }

    if (state.stopRequested) {
      addLog('warn', '[Pipeline] Stopped during scraping phase.');
    } else {
      addLog('out', `[Pipeline] Downloads complete. Done: ${state.progress.done}, Errors: ${state.progress.errors}`);
    }

    // Wait for any remaining analysis workers to finish
    if (cfg.analyze && (analysisQueue.length > 0 || activeAnalysis > 0)) {
      state.currentPhase = 'analyzing';
      addLog('out', `[Pipeline] Waiting for ${analysisQueue.length + activeAnalysis} remaining analysis job(s)…`);
      await waitForAnalysis();
      addLog('out', `[Pipeline] Analysis complete. Done: ${state.analysisProgress.done}, Errors: ${state.analysisProgress.errors}`);
    }

    // ── Phase 3: Final sync (catch any stragglers) ────────────────────────────
    if (!state.stopRequested && cfg.analyze) {
      state.currentPhase = 'syncing';
      addLog('out', '[Pipeline] Phase 3/3: syncing remaining analyses to DB…');
      const s = await syncAnalyses();
      addLog('out', `[Pipeline] Sync complete: ${s.imported} imported, ${s.skipped} skipped, ${s.errors} errors`);
    }

    const elapsed = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
    addLog('out', `[Pipeline] ── Finished in ${elapsed} min. Downloads: ${state.progress.done}/${state.progress.total}, AI: ${state.analysisProgress.done}/${state.analysisProgress.total}, Errors: ${state.progress.errors + state.analysisProgress.errors} ──`);

  } catch (err) {
    addLog('err', `[Pipeline] Fatal: ${err.message}`);
  } finally {
    state.status       = 'idle';
    state.activePipeline = null;
    state.currentPhase = null;
    state.stoppedAt    = new Date().toISOString();
  }
}

// ---------------------------------------------------------------------------
// ASX-only pipeline
// ---------------------------------------------------------------------------

function asxRunConfig(cfg) {
  return {
    concurrency: cfg.asxConcurrency != null ? cfg.asxConcurrency : cfg.concurrency,
    analysisConcurrency: cfg.asxAnalysisConcurrency != null ? cfg.asxAnalysisConcurrency : cfg.analysisConcurrency,
    daysBack: cfg.asxDaysBack != null ? cfg.asxDaysBack : cfg.daysBack,
    analyze: cfg.asxAnalyze !== undefined ? cfg.asxAnalyze : cfg.analyze,
    seedOnStart: cfg.asxSeedOnStart !== undefined ? cfg.asxSeedOnStart : true,
  };
}

async function runAsxPipeline() {
  if (state.status === 'running') {
    addLog('warn', '[ASX Pipeline] Already running — ignoring start request');
    return;
  }

  const baseCfg = loadConfig();
  const cfg = { ...baseCfg, ...asxRunConfig(baseCfg) };
  state.status        = 'running';
  state.activePipeline = 'asx';
  state.startedAt     = new Date().toISOString();
  state.stoppedAt     = null;
  state.stopRequested = false;
  state.progress      = { total: 0, done: 0, errors: 0 };
  state.analysisProgress = { total: 0, done: 0, errors: 0 };

  addLog('out', `[ASX Pipeline] ── Run started at ${state.startedAt} ──`);
  addLog('out', `[ASX Pipeline] concurrency=${cfg.concurrency}  analysisConcurrency=${cfg.analysisConcurrency || 2}  daysBack=${cfg.daysBack}  analyze=${cfg.analyze}`);

  try {
    // ── Phase 1: Seed ASX ────────────────────────────────────────────────────
    state.currentPhase = 'seeding';
    addLog('out', '[ASX Pipeline] Phase 1/3: seeding ASX company list…');
    const asxResult = await httpPost('/api/seeder/asx');
    if (asxResult.error) {
      addLog('err', `[ASX Pipeline] ASX seeder error: ${asxResult.error}`);
    } else {
      addLog('out', `[ASX Pipeline] ASX: inserted=${asxResult.inserted ?? '?'}, skipped=${asxResult.skipped ?? '?'}`);
    }

    if (state.stopRequested) {
      addLog('warn', '[ASX Pipeline] Stopped after seeding phase.');
      return;
    }

    // ── Phase 2: Scrape ASX only ─────────────────────────────────────────────
    state.currentPhase = 'scraping';
    const asxCompaniesResult = await db.query("SELECT name, ticker, exchange FROM companies WHERE exchange = 'ASX' ORDER BY name");
    const asxCompanies = asxCompaniesResult.rows;

    if (asxCompanies.length > 0 && !state.stopRequested) {
      addLog('out', `[ASX Pipeline] Phase 2: scraping ${asxCompanies.length} ASX companies (${cfg.concurrency} download workers, ${cfg.analysisConcurrency || 2} AI workers)…`);
      state.progress.total += asxCompanies.length;
      await runDownloadQueue(asxCompanies, cfg);
    }

    if (state.stopRequested) {
      addLog('warn', '[ASX Pipeline] Stopped during scraping phase.');
    } else {
      addLog('out', `[ASX Pipeline] Downloads complete. Done: ${state.progress.done}, Errors: ${state.progress.errors}`);
    }

    // Wait for any remaining analysis workers
    if (cfg.analyze && (analysisQueue.length > 0 || activeAnalysis > 0)) {
      state.currentPhase = 'analyzing';
      addLog('out', `[ASX Pipeline] Waiting for ${analysisQueue.length + activeAnalysis} remaining analysis job(s)…`);
      await waitForAnalysis();
      addLog('out', `[ASX Pipeline] Analysis complete. Done: ${state.analysisProgress.done}, Errors: ${state.analysisProgress.errors}`);
    }

    // ── Phase 3: Final sync ────────────────────────────────────────────────────
    if (!state.stopRequested && cfg.analyze) {
      state.currentPhase = 'syncing';
      addLog('out', '[ASX Pipeline] Phase 3/3: syncing remaining analyses to DB…');
      const s = await syncAnalyses();
      addLog('out', `[ASX Pipeline] Sync complete: ${s.imported} imported, ${s.skipped} skipped, ${s.errors} errors`);
    }

    const elapsed = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
    addLog('out', `[ASX Pipeline] ── Finished in ${elapsed} min. Downloads: ${state.progress.done}/${state.progress.total}, AI: ${state.analysisProgress.done}/${state.analysisProgress.total}, Errors: ${state.progress.errors + state.analysisProgress.errors} ──`);

  } catch (err) {
    addLog('err', `[ASX Pipeline] Fatal: ${err.message}`);
  } finally {
    state.status       = 'idle';
    state.activePipeline = null;
    state.currentPhase = null;
    state.stoppedAt    = new Date().toISOString();
  }
}

module.exports = { runPipeline, runAsxPipeline };