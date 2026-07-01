const express = require('express');
const router  = express.Router();
const { spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');
const db      = require('../../db');
const { upsertInsiderData } = require('../../db/insiders');

const scraperPath   = path.resolve(process.env.SCRAPER_PATH  || path.join(__dirname, '../../Scraper'));
const downloadsDir  = path.resolve(process.env.DOWNLOADS_DIR || path.join(__dirname, '../../Scraper/downloads'));
const activeScrapes = new Map();

// Proxy rotation for ad-hoc scraper runs — sets datacenter PROXY_SERVER with port rotation
// Residential proxy vars are inherited from process.env; scrapers handle fallback internally
const PROXY_PORTS = [8001, 8002, 8003, 8004, 8005];
let proxyRotor = 0;

function rotateProxyEnv() {
  const env = { ...process.env };
  if (env.USE_PROXY === 'true' && env.PROXY_SERVER) {
    const server = env.PROXY_SERVER || 'dc.oxylabs.io';
    const host = server.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const port = PROXY_PORTS[proxyRotor % PROXY_PORTS.length];
    env.PROXY_SERVER = `http://${host}:${port}`;
    proxyRotor++;
  }
  return env;
}

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

async function syncAnalyses() {
  if (!fs.existsSync(downloadsDir)) return { imported: 0, skipped: 0, errors: [] };

  const client = await db.connect();
  const stats = { imported: 0, skipped: 0, errors: [] };

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

    const dirs = fs.readdirSync(downloadsDir)
      .filter(f => fs.statSync(path.join(downloadsDir, f)).isDirectory());

    for (const dir of dirs) {
      const dp    = path.join(downloadsDir, dir);
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
        } catch (err) { stats.errors.push({ file: jf, error: err.message }); }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return stats;
}

function useRelayScrapers() {
  return process.env.RELAY_ENABLED === 'true' && process.env.RELAY_WIRE_SCRAPERS !== 'false';
}

async function finishScrapeEntry(entry, code, mode) {
  entry.status = code === 0 ? 'done' : 'error';
  entry.exitCode = code;
  if (code === 0 && mode !== 'scrape-only') {
    try {
      const result = await syncAnalyses();
      entry.logs.push({
        t: 'out',
        msg: `[server] Auto-synced: ${result.imported} new filing(s), ${result.skipped} skipped\n`,
      });
    } catch (err) {
      entry.logs.push({ t: 'err', msg: `[server] Auto-sync failed: ${err.message}\n` });
    }
  }
}

// POST /api/scraper/run
router.post('/run', express.json(), (req, res) => {
  const { company, mode = 'both', exchange, daysBack } = req.body;
  const isASX = exchange === 'ASX';

  if (!company) return res.status(400).json({ error: 'Company name / ticker is required' });

  const id = Date.now().toString();
  const label = company;
  const entry = {
    company: label,
    exchange: exchange || 'SEDAR',
    mode,
    logs: [],
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  activeScrapes.set(id, entry);

  if (mode !== 'analyze-only' && useRelayScrapers()) {
    const slot = isASX ? (proxyRotor++ % 5) + 1 : (proxyRotor++ % 3) + 1;
    const { runSedarManual, runAsxManual } = require('../../relay/scrape');
    entry.logs.push({ t: 'out', msg: `[Relay] ${isASX ? 'DC' : 'RES'}-${slot} → ${label}\n` });

    (async () => {
      try {
        if (isASX) {
          await runAsxManual(company, {
            daysBack: daysBack || 30,
            relaySlot: slot,
            downloadDir: downloadsDir,
          });
        } else {
          await runSedarManual(company, slot);
        }
        if (mode !== 'scrape-only') {
          const { analyzeDirectory } = require(path.join(scraperPath, 'src/modules/analyzer'));
          const dirName = isASX
            ? company.toUpperCase()
            : company.replace(/[^\w\s-]/g, '_').trim();
          const companyDir = path.join(downloadsDir, dirName);
          const meta = isASX
            ? { exchange: 'ASX', ticker: company.toUpperCase(), company_name: company }
            : { company_name: company, exchange: 'SEDAR+ (Canada)' };
          await analyzeDirectory(companyDir, meta);
        }
        await finishScrapeEntry(entry, 0, mode);
      } catch (err) {
        entry.logs.push({ t: 'err', msg: `${err.message}\n` });
        await finishScrapeEntry(entry, 1, mode);
      }
    })();

    return res.json({ id, message: `Relay scraper started for "${label}"` });
  }

  let script, args;
  if (isASX) {
    script = 'asx-filings.js';
    args = [company];
    if (daysBack) args.push('--days', String(daysBack));
    if (mode === 'scrape-only') args.push('--no-analyze');
    if (mode === 'analyze-only') args.push('--analyze-only');
  } else {
    script = 'index.js';
    args = [company];
    if (mode === 'scrape-only') args.push('--no-analyze');
    if (mode === 'analyze-only') args.push('--analyze-only');
  }

  const proc = spawn('node', [script, ...args], {
    cwd: scraperPath,
    env: rotateProxyEnv(),
    shell: false,
  });

  proc.stdout.on('data', (d) => entry.logs.push({ t: 'out', msg: d.toString() }));
  proc.stderr.on('data', (d) => entry.logs.push({ t: 'err', msg: d.toString() }));
  proc.on('close', async (code) => finishScrapeEntry(entry, code, mode));

  res.json({ id, message: `Scraper started for "${label}"` });
});

// GET /api/scraper/status/:id
router.get('/status/:id', (req, res) => {
  const entry = activeScrapes.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Run not found' });
  res.json(entry);
});

// GET /api/scraper/runs
router.get('/runs', (req, res) => {
  const runs = Array.from(activeScrapes.entries())
    .map(([id, e]) => ({ id, company: e.company, mode: e.mode, status: e.status, startedAt: e.startedAt }))
    .reverse();
  res.json(runs);
});

module.exports = router;
