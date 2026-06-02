const { spawn }  = require('child_process');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const db         = require('../db');
const { state, addLog } = require('./state');
const { load: loadConfig } = require('./config');
const { upsertInsiderData } = require('../db/insiders');

const SCRAPER_DIR = path.resolve(
  process.env.SCRAPER_PATH || path.join(__dirname, '../../Scraper')
);
const ANALYZE_SCRIPT = path.join(SCRAPER_DIR, 'analyze-one.js');
const DOWNLOADS_DIR  = path.resolve(
  process.env.DOWNLOADS_DIR || path.join(__dirname, '../../Scraper/downloads')
);

// ---------------------------------------------------------------------------
// Proxy — pass all proxy env vars to workers; scrapers handle fallback internally
// ---------------------------------------------------------------------------

const PROXY_PORTS = [8001, 8002, 8003, 8004, 8005];

function workerEnv(workerId) {
  const env = { ...process.env, HEADLESS: 'true' };
  // Set datacenter proxy with port rotation as PROXY_SERVER
  if (env.USE_PROXY === 'true' && env.PROXY_SERVER) {
    const server = env.PROXY_SERVER || 'dc.oxylabs.io';
    const host = server.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const port = PROXY_PORTS[(workerId - 1) % PROXY_PORTS.length];
    env.PROXY_SERVER = `http://${host}:${port}`;
    addLog('out', `[Pipeline] Worker ${workerId} → datacenter proxy ${env.PROXY_SERVER}`);
  }
  // Residential proxy vars (PROXY_SERVER_2 etc.) are inherited from process.env
  // — scrapers use them as fallback via proxy-fallback.js
  return env;
}

// ---------------------------------------------------------------------------
// Spawn one company scrape job (download only — no in-process analysis)
// ---------------------------------------------------------------------------

// company = { name, ticker, exchange }
function spawnWorker(company, workerId, cfg) {
  return new Promise((resolve) => {
    const isASX = company.exchange === 'ASX';
    const script = isASX ? 'asx-filings.js' : 'index.js';
    const arg    = isASX ? (company.ticker || company.name) : company.name;
    // Always scrape-only; analysis runs separately in the pipeline
    const args   = [arg, '--no-analyze'];
    if (isASX && cfg.daysBack) args.push('--days', String(cfg.daysBack));

    const env = workerEnv(workerId);

    const proc = spawn('node', [script, ...args], {
      cwd: SCRAPER_DIR,
      env,
      shell: false,
    });

    const tag = `[W${workerId}|${arg.substring(0, 22)}]`;
    proc.stdout.on('data', d => {
      for (const l of d.toString().split('\n')) if (l.trim()) addLog('out', `${tag} ${l}`);
    });
    proc.stderr.on('data', d => {
      for (const l of d.toString().split('\n')) if (l.trim()) addLog('log', `${tag} ${l}`);
    });
    proc.on('close', code => {
      if (code === 0) {
        state.progress.done++;
        addLog('out', `${tag} ✓ download done`);
      } else {
        state.progress.errors++;
        addLog('err', `${tag} ✗ exit ${code}`);
      }
      resolve(code);
    });
    proc.on('error', err => {
      state.progress.errors++;
      addLog('err', `${tag} ✗ spawn error: ${err.message}`);
      resolve(1);
    });
  });
}

// ---------------------------------------------------------------------------
// Concurrent download queue — N workers pulling from a shared array
// ---------------------------------------------------------------------------

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

function spawnAnalysisWorker(item, cfg) {
  const { pdfPath, companyDir, company, ticker, exchange } = item;
  const meta = JSON.stringify({ company_name: company, ticker, exchange });
  const tag = `[AI|${path.basename(pdfPath).substring(0, 30)}]`;

  addLog('out', `${tag} Starting analysis…`);

  const proc = spawn('node', [ANALYZE_SCRIPT, pdfPath, meta], {
    cwd: SCRAPER_DIR,
    env: { ...process.env },
    shell: false,
  });

  let stdout = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => {
    for (const l of d.toString().split('\n')) if (l.trim()) addLog('log', `${tag} ${l}`);
  });

  proc.on('close', async (code) => {
    activeAnalysis--;

    if (code === 0 && stdout.trim()) {
      try {
        // Filter out dotenvx injection messages and other non-JSON lines
        const jsonLine = stdout.trim().split('\n').find(line => {
          const trimmed = line.trim();
          return trimmed.startsWith('{') && trimmed.endsWith('}');
        });
        if (!jsonLine) {
          throw new Error('No JSON found in output');
        }
        const result = JSON.parse(jsonLine);
        if (result.ok) {
          addLog('out', `${tag} ✓ verdict: ${result.verdict}`);
          // Save to DB immediately
          try {
            await saveOneFiling(pdfPath, companyDir, company, ticker, exchange);
            addLog('out', `${tag} ✓ saved to DB`);
          } catch (dbErr) {
            addLog('err', `${tag} DB save failed: ${dbErr.message}`);
          }
          state.analysisProgress.done++;
        } else {
          addLog('err', `${tag} ✗ analysis error: ${result.error}`);
          state.analysisProgress.errors++;
        }
      } catch (parseErr) {
        addLog('err', `${tag} ✗ parse error: ${parseErr.message}`);
        state.analysisProgress.errors++;
      }
    } else {
      addLog('err', `${tag} ✗ exit ${code}`);
      state.analysisProgress.errors++;
    }

    // Continue draining the queue
    drainAnalysisQueue(cfg);
  });

  proc.on('error', err => {
    activeAnalysis--;
    addLog('err', `${tag} ✗ spawn error: ${err.message}`);
    state.analysisProgress.errors++;
    drainAnalysisQueue(cfg);
  });
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

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Look up company
    let companyResult = await client.query('SELECT id, name, exchange FROM companies WHERE ticker = $1', [ticker]);
    let companyRow = companyResult.rows[0];
    if (!companyRow) {
      companyResult = await client.query('SELECT id, name, exchange FROM companies WHERE name ILIKE $1', [`%${companyName.replace(/_/g, ' ')}%`]);
      companyRow = companyResult.rows[0];
    }

    const insFilin = `
      INSERT INTO filings
        (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status)
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'analyzed')
      ON CONFLICT (pdf_path) DO NOTHING
      RETURNING id
    `;

    const fiResult = await client.query(insFilin, [
      companyRow?.id ?? null,
      companyRow?.name || companyName,
      pdfName,
      pdfPath,
      commodity,
      companyRow?.exchange || exchange,
    ]);

    const fid = fiResult.rows[0]?.id;
    if (!fid) {
      // Already exists (conflict) — update AI output instead
      const existing = await client.query('SELECT id FROM filings WHERE pdf_path = $1', [pdfPath]);
      if (existing.rows[0]) {
        const existingFid = existing.rows[0].id;
        const ext = analysis.data_extracted || {};
        const insAI = `
          INSERT INTO ai_output
            (filing_id, display_type, ticker_summary, summary, verdict, verdict_reason,
             key_facts, context, grade_commentary, what_to_watch,
             cash_position, burn_rate_quarterly, resource_estimate,
             pp_amount, pp_price, insider_holdings, raw_response)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (filing_id) DO UPDATE SET
            display_type = EXCLUDED.display_type,
            ticker_summary = EXCLUDED.ticker_summary,
            summary = EXCLUDED.summary,
            verdict = EXCLUDED.verdict,
            verdict_reason = EXCLUDED.verdict_reason,
            key_facts = EXCLUDED.key_facts,
            context = EXCLUDED.context,
            grade_commentary = EXCLUDED.grade_commentary,
            what_to_watch = EXCLUDED.what_to_watch,
            cash_position = EXCLUDED.cash_position,
            burn_rate_quarterly = EXCLUDED.burn_rate_quarterly,
            resource_estimate = EXCLUDED.resource_estimate,
            pp_amount = EXCLUDED.pp_amount,
            pp_price = EXCLUDED.pp_price,
            insider_holdings = EXCLUDED.insider_holdings,
            raw_response = EXCLUDED.raw_response
        `;
        await client.query(insAI, [
          existingFid,
          analysis.display_type ?? null,
          analysis.ticker_summary ?? null,
          analysis.summary ?? null,
          analysis.verdict ?? null,
          analysis.verdict_reason ?? null,
          JSON.stringify(analysis.key_facts ?? []),
          analysis.context ?? null,
          analysis.grade_commentary ?? null,
          analysis.what_to_watch ?? null,
          ext.cash_position ?? null,
          ext.burn_rate_quarterly ?? null,
          JSON.stringify(ext.resource_estimates ?? null),
          ext.pp_amount ?? null,
          ext.pp_price ?? null,
          JSON.stringify(ext.insider_holdings ?? null),
          JSON.stringify(analysis),
        ]);
        await upsertInsiderData(client, companyRow?.id, existingFid, ext);
      }
    } else {
      // New filing — insert AI output
      const ext = analysis.data_extracted || {};
      const insAI = `
        INSERT INTO ai_output
          (filing_id, display_type, ticker_summary, summary, verdict, verdict_reason,
           key_facts, context, grade_commentary, what_to_watch,
           cash_position, burn_rate_quarterly, resource_estimate,
           pp_amount, pp_price, insider_holdings, raw_response)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (filing_id) DO UPDATE SET
          display_type = EXCLUDED.display_type,
          ticker_summary = EXCLUDED.ticker_summary,
          summary = EXCLUDED.summary,
          verdict = EXCLUDED.verdict,
          verdict_reason = EXCLUDED.verdict_reason,
          key_facts = EXCLUDED.key_facts,
          context = EXCLUDED.context,
          grade_commentary = EXCLUDED.grade_commentary,
          what_to_watch = EXCLUDED.what_to_watch,
          cash_position = EXCLUDED.cash_position,
          burn_rate_quarterly = EXCLUDED.burn_rate_quarterly,
          resource_estimate = EXCLUDED.resource_estimate,
          pp_amount = EXCLUDED.pp_amount,
          pp_price = EXCLUDED.pp_price,
          insider_holdings = EXCLUDED.insider_holdings,
          raw_response = EXCLUDED.raw_response
      `;
      await client.query(insAI, [
        fid,
        analysis.display_type ?? null,
        analysis.ticker_summary ?? null,
        analysis.summary ?? null,
        analysis.verdict ?? null,
        analysis.verdict_reason ?? null,
        JSON.stringify(analysis.key_facts ?? []),
        analysis.context ?? null,
        analysis.grade_commentary ?? null,
        analysis.what_to_watch ?? null,
        ext.cash_position ?? null,
        ext.burn_rate_quarterly ?? null,
        JSON.stringify(ext.resource_estimates ?? null),
        ext.pp_amount ?? null,
        ext.pp_price ?? null,
        JSON.stringify(ext.insider_holdings ?? null),
        JSON.stringify(analysis),
      ]);
      await upsertInsiderData(client, companyRow?.id, fid, ext);
    }

    await client.query('COMMIT');
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
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'analyzed')
      ON CONFLICT (pdf_path) DO NOTHING
      RETURNING id
    `;
    const insAI = `
      INSERT INTO ai_output
        (filing_id, display_type, ticker_summary, summary, verdict, verdict_reason,
         key_facts, context, grade_commentary, what_to_watch,
         cash_position, burn_rate_quarterly, resource_estimate,
         pp_amount, pp_price, insider_holdings, raw_response)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (filing_id) DO UPDATE SET
        display_type = EXCLUDED.display_type,
        ticker_summary = EXCLUDED.ticker_summary,
        summary = EXCLUDED.summary,
        verdict = EXCLUDED.verdict,
        verdict_reason = EXCLUDED.verdict_reason,
        key_facts = EXCLUDED.key_facts,
        context = EXCLUDED.context,
        grade_commentary = EXCLUDED.grade_commentary,
        what_to_watch = EXCLUDED.what_to_watch,
        cash_position = EXCLUDED.cash_position,
        burn_rate_quarterly = EXCLUDED.burn_rate_quarterly,
        resource_estimate = EXCLUDED.resource_estimate,
        pp_amount = EXCLUDED.pp_amount,
        pp_price = EXCLUDED.pp_price,
        insider_holdings = EXCLUDED.insider_holdings,
        raw_response = EXCLUDED.raw_response
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
          const existing = await client.query('SELECT id FROM filings WHERE pdf_path = $1', [pdfPath]);
          if (existing.rows.length > 0) { stats.skipped++; continue; }

          const analysis = JSON.parse(fs.readFileSync(path.join(dp, jf), 'utf8'));
          let company = await client.query('SELECT id, name, exchange FROM companies WHERE ticker = $1', [dir]);
          let companyRow = company.rows[0];
          if (!companyRow) {
            company = await client.query('SELECT id, name, exchange FROM companies WHERE name ILIKE $1', [`%${dir.replace(/_/g, ' ')}%`]);
            companyRow = company.rows[0];
          }
          const companyName = companyRow?.name || dir.replace(/_/g, ' ');
          const commodity = inferCommodity(analysis.summary, analysis.ticker_summary);

          const fiResult = await client.query(insFilin, [
            companyRow?.id ?? null,
            companyName,
            pdfName,
            pdfPath,
            commodity,
            companyRow?.exchange || null,
          ]);
          const fid = fiResult.rows[0]?.id;
          if (!fid) { stats.skipped++; continue; }

          const ext = analysis.data_extracted || {};
          await client.query(insAI, [
            fid,
            analysis.display_type ?? null,
            analysis.ticker_summary ?? null,
            analysis.summary ?? null,
            analysis.verdict ?? null,
            analysis.verdict_reason ?? null,
            JSON.stringify(analysis.key_facts ?? []),
            analysis.context ?? null,
            analysis.grade_commentary ?? null,
            analysis.what_to_watch ?? null,
            ext.cash_position ?? null,
            ext.burn_rate_quarterly ?? null,
            JSON.stringify(ext.resource_estimates ?? null),
            ext.pp_amount ?? null,
            ext.pp_price ?? null,
            JSON.stringify(ext.insider_holdings ?? null),
            JSON.stringify(analysis),
          ]);
          await upsertInsiderData(client, companyRow?.id, fid, ext);
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
    state.currentPhase = null;
    state.stoppedAt    = new Date().toISOString();
  }
}

// ---------------------------------------------------------------------------
// ASX-only pipeline
// ---------------------------------------------------------------------------

async function runAsxPipeline() {
  if (state.status === 'running') {
    addLog('warn', '[ASX Pipeline] Already running — ignoring start request');
    return;
  }

  const cfg = loadConfig();
  state.status        = 'running';
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
    state.currentPhase = null;
    state.stoppedAt    = new Date().toISOString();
  }
}

module.exports = { runPipeline, runAsxPipeline };