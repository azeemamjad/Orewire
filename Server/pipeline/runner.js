const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const db         = require('../db');
const { CANADA_COMPANIES_QUERY, ASX_COMPANIES_QUERY } = require('./regions');
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
const { refreshProxyCache, getPrimaryProxyWorkersForTier } = require('../relay/proxy-store');

/**
 * Relay worker slots actually available in a tier right now. Hard-coding this
 * dispatched to RES-2 / RES-3 long after those proxies were removed, so every
 * surplus worker sat in the acquire queue and timed out.
 */
async function relaySlotCount(tier) {
  try {
    // Primaries only: a fallback-only proxy is standby capacity, not a slot to
    // schedule against, or the pipeline would dispatch paid traffic by default.
    await refreshProxyCache();
    return getPrimaryProxyWorkersForTier(tier).length;
  } catch (err) {
    addLog('warn', `[Pipeline] Could not read ${tier} relay pool: ${err.message}`);
    return 0;
  }
}

/**
 * Errors that mean "the network path is broken", not "this company failed".
 *
 * A dead proxy answers every CONNECT identically, so without this distinction a
 * single bad proxy marches through the whole queue marking every company as an
 * error — one run produced 1559 identical ERR_TUNNEL_CONNECTION_FAILEDs at
 * roughly one company per second before anyone could stop it.
 *
 * Deliberately narrow: generic "timeout" is NOT included, because a slow page or
 * a missing selector times out too and that is a per-company problem.
 */
const { isTransportError } = require('../relay/net-errors');

/**
 * Failures worth trying again after a wait: the network path, and the site
 * throttling or walling us (403 with a Transaction ID, a perfdrive redirect, a
 * captcha). These are about *when* we asked, not *what* we asked for.
 */
const RETRYABLE_ERROR_RE = new RegExp([
  '403', 'forbidden', 'transaction id',
  'bot wall', 'captcha', 'perfdrive', 'shieldsquare', 'incapsula',
  'access denied', 'too many requests', '429',
  'timeout', 'timed out',
  // The known profile re-render race — transient, and worth another go.
  'never applied the profile filter',
  'did not finish applying the profile',
].join('|'), 'i');

/**
 * Permanent for this company — retrying burns the wait for nothing. A company
 * with no SEDAR+ profile will still have none in five minutes, and the
 * mismatch guards exist precisely to refuse rather than retry.
 */
// Matched BEFORE the retryable patterns, so keep it narrow and specific.
// "refusing to run an unfiltered search" deliberately does NOT appear here: it
// is the tail of the re-render race message above, which is transient. Only the
// genuinely permanent cases belong here — above all "no profile matches", which
// is the normal answer for a company that simply is not on SEDAR+, and which
// would otherwise burn the full retry budget for every one of them.
const PERMANENT_ERROR_RE = new RegExp([
  'no sedar\\+? profile matches',
  'refusing to download another issuer',
  'but we asked for',                      // applied profile "A" but we asked for "B"
].join('|'), 'i');

function isRetryableError(err) {
  const msg = err?.message || String(err || '');
  if (PERMANENT_ERROR_RE.test(msg)) return false;
  return isTransportError(err) || RETRYABLE_ERROR_RE.test(msg);
}

// Per-company retry policy. Defaults: 3 attempts, 5 minutes apart.
const COMPANY_ATTEMPTS = Math.max(1, parseInt(process.env.PIPELINE_COMPANY_ATTEMPTS || '3', 10));
const RETRY_DELAY_MS = Math.max(0, parseInt(process.env.PIPELINE_RETRY_DELAY_MS || '300000', 10));

/** Sleep that still notices a stop request instead of blocking it for minutes. */
async function interruptibleSleep(ms, shouldStop) {
  const step = 1000;
  for (let waited = 0; waited < ms; waited += step) {
    if (shouldStop()) return false;
    await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
  }
  return true;
}

// How many back-to-back transport failures before we stop the run. Any success
// resets the counter, so a single flaky request never trips it.
// Each counted failure is already COMPANY_ATTEMPTS tries spread over the retry
// delay, so this is deliberately small: three companies that exhaust every
// attempt at the transport layer means the proxy is down, not unlucky.
const TRANSPORT_FAILURE_LIMIT = Math.max(
  1,
  parseInt(process.env.PIPELINE_TRANSPORT_FAILURE_LIMIT || '3', 10),
);

/**
 * Hand out at most `limit` concurrent permits. A SEDAR+ download holds its
 * relay worker for the whole scrape, so without this the extra download workers
 * queue on a busy worker and die with "No available 'res' relay worker".
 */
function createSemaphore(limit) {
  let active = 0;
  const waiters = [];
  const release = () => {
    const next = waiters.shift();
    // Hand the permit straight to the next waiter — never dip below the limit.
    if (next) next();
    else active -= 1;
  };
  return async () => {
    if (active >= limit) {
      await new Promise((resolve) => waiters.push(resolve));
      return release;
    }
    active += 1;
    return release;
  };
}

// company = { name, ticker, exchange }
async function spawnWorker(company, workerId, cfg, relay = {}) {
  const isASX = company.exchange === 'ASX';
  const arg = isASX ? (company.ticker || company.name) : company.name;
  const tag = `[W${workerId}|${arg.substring(0, 22)}]`;
  const slots = Math.max(1, relay.slots || 1);
  const relaySlot = ((workerId - 1) % slots) + 1;

  // ASX filings use Markit HTTP by default (Relay DC cannot reach asx.com.au).
  // SEDAR+ still goes through residential Relay workers.
  const useRelay = !isASX && relayWiringEnabled();
  if (isASX) {
    addLog('out', `${tag} → Markit HTTP`);
  } else if (useRelay) {
    addLog('out', `${tag} → Relay res slot ${relaySlot}/${slots}`);
  }

  const releaseRelay = useRelay && relay.acquire ? await relay.acquire() : null;
  const saved = applyScraperEnv({ relay: useRelay });
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
        daysBack: cfg.daysBack,
        relaySlot,
        taskSlug: 'pipeline_sedar_batch',
      });
    }
    addLog('out', `${tag} ✓ download done`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      transport: isTransportError(err),
      retryable: isRetryableError(err),
      message: err.message,
    };
  } finally {
    restoreScraperEnv(saved);
    if (releaseRelay) releaseRelay();
  }
}

async function runDownloadQueue(companies, cfg) {
  const queue = [...companies];
  let workerIdx = 0;

  // Relay-backed (SEDAR+) work is limited by the residential pool, not by the
  // configured download-worker count. ASX runs over plain HTTP and is unaffected.
  const needsRelay = relayWiringEnabled() && companies.some((c) => c.exchange !== 'ASX');
  const slots = needsRelay ? await relaySlotCount('res') : 0;
  if (needsRelay) {
    if (slots === 0) {
      addLog('warn', '[Pipeline] No enabled residential proxies — SEDAR+ workers will fall back to direct');
    } else if (slots < cfg.concurrency) {
      addLog('out', `[Pipeline] Residential relay workers: ${slots} — SEDAR+ downloads capped at ${slots} concurrent (ASX unaffected)`);
    }
  }
  const relay = {
    slots,
    acquire: slots > 0 ? createSemaphore(slots) : null,
  };

  // Circuit breaker: consecutive transport failures mean the proxy/network is
  // down, and every remaining company will fail the same way. Stop instead of
  // converting a proxy outage into thousands of "errored" companies that then
  // have to be found and re-queued by hand.
  let consecutiveTransportFailures = 0;
  let abortReason = null;

  async function drain(id) {
    while (queue.length > 0) {
      if (abortReason) return;
      if (state.stopRequested) {
        addLog('warn', `[Pipeline] Worker ${id} stopping (stop requested)`);
        return;
      }
      const company = queue.shift();
      if (!company) break;

      const labelArg = company.exchange === 'ASX' ? (company.ticker || company.name) : company.name;
      const label = `[W${id}|${labelArg.substring(0, 22)}]`;
      let result;
      for (let attempt = 1; attempt <= COMPANY_ATTEMPTS; attempt++) {
        // Each attempt acquires and releases the relay permit inside
        // spawnWorker, so the wait below never holds a scarce residential slot
        // hostage — with `res slot 1/1` that would stall every other worker.
        result = await spawnWorker(company, id, cfg, relay);
        if (result.ok) break;

        const last = attempt >= COMPANY_ATTEMPTS;
        if (!result.retryable) {
          addLog('err', `${label} ✗ ${result.message}`);
          break;
        }
        if (last) {
          addLog('err', `${label} ✗ ${result.message} (gave up after ${attempt} attempts)`);
          break;
        }
        addLog('warn',
          `${label} attempt ${attempt}/${COMPANY_ATTEMPTS} failed (${result.message}) — `
          + `retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s`);
        const slept = await interruptibleSleep(RETRY_DELAY_MS, () => state.stopRequested || !!abortReason);
        if (!slept) return;
      }

      if (result.ok) {
        state.progress.done++;
        consecutiveTransportFailures = 0;
      } else if (result.transport) {
        state.progress.errors++;
        consecutiveTransportFailures += 1;
        if (consecutiveTransportFailures >= TRANSPORT_FAILURE_LIMIT) {
          abortReason = result.message;
          addLog('err',
            `[Pipeline] ABORTING — ${consecutiveTransportFailures} consecutive companies failed `
            + `every one of their ${COMPANY_ATTEMPTS} attempts with network/proxy errors `
            + `("${result.message}"). ${queue.length} companies left unattempted `
            + '(they were NOT marked as errors).');
          addLog('err',
            '[Pipeline] The proxy is refusing connections. Run `npm run relay:diagnose-proxies` '
            + 'on this host — it prints the reason Chrome hides behind ERR_TUNNEL_CONNECTION_FAILED '
            + '(auth rejected / quota exhausted / unreachable).');
          return;
        }
      } else {
        // A per-company failure (bad name, no results, parse error) says nothing
        // about the network, so it must not count toward the breaker.
        state.progress.errors++;
        consecutiveTransportFailures = 0;
      }

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
        (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status, filing_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      analysis.filing_type || null,
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
        (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status, filing_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
            analysis.filing_type || null,
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

async function seedCanadianCompanies() {
  const seeders = [['TSX/TSXV', '/api/seeder/tsx'], ['CSE', '/api/seeder/cse']];

  for (const [label, endpoint] of seeders) {
    addLog('out', `[Canada Pipeline] Seeding ${label}…`);
    const result = await httpPost(endpoint);
    if (result.error) {
      addLog('err', `[Canada Pipeline] ${label} seeder error: ${result.error}`);
    } else {
      addLog('out', `[Canada Pipeline] ${label}: inserted=${result.inserted ?? '?'}, skipped=${result.skipped ?? '?'}`);
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
// Canada (SEDAR) entry point — TSX / TSXV / CSE only; ASX has its own pipeline
// ---------------------------------------------------------------------------

async function runPipeline() {
  if (state.status === 'running') {
    addLog('warn', '[Canada Pipeline] Already running — ignoring start request');
    return;
  }

  const cfg = loadConfig();
  state.status        = 'running';
  state.activePipeline = 'canada';
  state.startedAt     = new Date().toISOString();
  state.stoppedAt     = null;
  state.stopRequested = false;
  state.progress      = { total: 0, done: 0, errors: 0 };
  state.analysisProgress = { total: 0, done: 0, errors: 0 };

  addLog('out', `[Canada Pipeline] ── Run started at ${state.startedAt} ──`);
  addLog('out', `[Canada Pipeline] concurrency=${cfg.concurrency}  analysisConcurrency=${cfg.analysisConcurrency || 2}  daysBack=${cfg.daysBack}  analyze=${cfg.analyze}`);

  try {
    // ── Phase 1: Seed Canada ─────────────────────────────────────────────────
    if (cfg.seedOnStart) {
      state.currentPhase = 'seeding';
      addLog('out', '[Canada Pipeline] Phase 1/3: seeding TSX/TSXV & CSE company lists…');
      await seedCanadianCompanies();
      addLog('out', '[Canada Pipeline] Seeding complete.');
    }

    if (state.stopRequested) {
      addLog('warn', '[Canada Pipeline] Stopped after seeding phase.');
      return;
    }

    // ── Phase 2: Scrape + Analyze (streaming) ────────────────────────────────
    state.currentPhase = 'scraping';
    const allCompaniesResult = await db.query(CANADA_COMPANIES_QUERY);
    const allCompanies = allCompaniesResult.rows;

    if (allCompanies.length > 0 && !state.stopRequested) {
      addLog('out', `[Canada Pipeline] Phase 2: scraping ${allCompanies.length} Canadian companies (${cfg.concurrency} download workers, ${cfg.analysisConcurrency || 2} AI workers)…`);
      state.progress.total += allCompanies.length;
      await runDownloadQueue(allCompanies, cfg);
    } else if (allCompanies.length === 0) {
      addLog('warn', '[Canada Pipeline] No Canadian companies in database — run seeders first.');
    }

    if (state.stopRequested) {
      addLog('warn', '[Canada Pipeline] Stopped during scraping phase.');
    } else {
      addLog('out', `[Canada Pipeline] Downloads complete. Done: ${state.progress.done}, Errors: ${state.progress.errors}`);
    }

    // Wait for any remaining analysis workers to finish
    if (cfg.analyze && (analysisQueue.length > 0 || activeAnalysis > 0)) {
      state.currentPhase = 'analyzing';
      addLog('out', `[Canada Pipeline] Waiting for ${analysisQueue.length + activeAnalysis} remaining analysis job(s)…`);
      await waitForAnalysis();
      addLog('out', `[Canada Pipeline] Analysis complete. Done: ${state.analysisProgress.done}, Errors: ${state.analysisProgress.errors}`);
    }

    // ── Phase 3: Final sync (catch any stragglers) ────────────────────────────
    if (!state.stopRequested && cfg.analyze) {
      state.currentPhase = 'syncing';
      addLog('out', '[Canada Pipeline] Phase 3/3: syncing remaining analyses to DB…');
      const s = await syncAnalyses();
      addLog('out', `[Canada Pipeline] Sync complete: ${s.imported} imported, ${s.skipped} skipped, ${s.errors} errors`);
    }

    const elapsed = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
    addLog('out', `[Canada Pipeline] ── Finished in ${elapsed} min. Downloads: ${state.progress.done}/${state.progress.total}, AI: ${state.analysisProgress.done}/${state.analysisProgress.total}, Errors: ${state.progress.errors + state.analysisProgress.errors} ──`);

  } catch (err) {
    addLog('err', `[Canada Pipeline] Fatal: ${err.message}`);
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
    const asxCompaniesResult = await db.query(ASX_COMPANIES_QUERY);
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

// isTransportError is exported for tests — misclassifying here either lets a
// proxy outage burn the queue, or aborts a run over one slow page.
module.exports = { runPipeline, runAsxPipeline, isTransportError, isRetryableError };