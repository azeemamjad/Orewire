#!/usr/bin/env node
/**
 * Corpus classifier — label the filing corpus by type to decide which types are
 * high-volume (so we build dedicated per-type prompt modules for them).
 *
 *   node scripts/classify-corpus.js --limit 200        # sample, heuristic-only (free)
 *   node scripts/classify-corpus.js --ai --limit 200   # use the cheap AI fallback for low-confidence
 *   node scripts/classify-corpus.js --backfill          # write filing_type back to the DB
 *   node scripts/classify-corpus.js --out /tmp/hist.json
 *
 * Heuristic-only is free and fast — good enough to pick the major types. `--ai`
 * improves the long-tail labelling at a small cost. `--backfill` persists the
 * classified type into filings.filing_type (lights up the filings-list filter).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const pdfParse = require('pdf-parse');
const db = require('../db');
const { classifyHeuristic, classifyFilingType, CANONICAL_SET } = require('../lib/scraper/analyzer/classify');
const {
  isRemoteStoragePath,
  parseStoragePath,
  getObjectStream,
  isStorageEnabled,
} = require('../lib/infra/object-storage');

function flag(name) { return process.argv.includes(`--${name}`); }
function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const OPTS = {
  limit: arg('limit') ? Math.max(1, parseInt(arg('limit'), 10) || 0) : null,
  useAi: flag('ai'),
  backfill: flag('backfill'),
  outFile: arg('out'),
  delayMs: Number(arg('delay', flag('ai') ? '400' : '0')),
};

async function downloadToTemp(filing) {
  const pdfPath = filing.pdf_path;
  if (!isRemoteStoragePath(pdfPath)) {
    if (fs.existsSync(pdfPath)) return { localPath: pdfPath, cleanup: false };
    return null;
  }
  if (!isStorageEnabled()) return null;
  const key = parseStoragePath(pdfPath);
  if (!key) return null;
  const tmp = path.join(os.tmpdir(), `orewire_classify_${filing.id}_${Date.now()}.pdf`);
  // getObjectStream has no retry — retry once on transient failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const stream = await getObjectStream(key);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        stream.pipe(out);
        stream.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
      });
      return { localPath: tmp, cleanup: true };
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

async function extractFirstPages(pdfPath, maxPages = 2) {
  const buf = fs.readFileSync(pdfPath);
  const data = await pdfParse(buf, { max: maxPages });
  return data.text || '';
}

async function classifyOne(filing) {
  let local = null;
  try {
    local = await downloadToTemp(filing);
    if (!local) return { filing_type: null, confidence: 0, source: 'no_pdf' };
    let text = '';
    try {
      text = await extractFirstPages(local.localPath, 2);
    } catch {
      text = '';
    }
    if (text.trim().length < 40) return { filing_type: null, confidence: 0, source: 'no_text' };

    const meta = { pdf_filename: filing.pdf_filename, company_name: filing.company_name, exchange: filing.exchange };
    if (OPTS.useAi) {
      return await classifyFilingType({ text, meta });
    }
    const h = classifyHeuristic({ filename: filing.pdf_filename, text });
    return { filing_type: h.type, confidence: h.confidence, source: 'heuristic' };
  } finally {
    if (local?.cleanup && local.localPath && fs.existsSync(local.localPath)) {
      try { fs.unlinkSync(local.localPath); } catch { /* ignore */ }
    }
  }
}

async function main() {
  const hist = new Map();
  const sourceCounts = new Map();
  let processed = 0;
  let backfilled = 0;
  let noText = 0;
  let errors = 0;

  let lastId = 0;
  const BATCH = 500;
  for (;;) {
    const remaining = OPTS.limit ? OPTS.limit - processed : BATCH;
    if (OPTS.limit && remaining <= 0) break;
    const batchSize = Math.min(BATCH, remaining || BATCH);

    const { rows } = await db.query(
      `SELECT id, company_name, exchange, pdf_filename, pdf_path
         FROM filings
        WHERE pdf_path IS NOT NULL AND id > $1
        ORDER BY id ASC
        LIMIT $2`,
      [lastId, batchSize],
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const filing of rows) {
      try {
        const res = await classifyOne(filing);
        processed += 1;
        const label = res.filing_type || `(${res.source})`;
        hist.set(label, (hist.get(label) || 0) + 1);
        sourceCounts.set(res.source, (sourceCounts.get(res.source) || 0) + 1);
        if (res.source === 'no_text' || res.source === 'no_pdf') noText += 1;

        if (OPTS.backfill && res.filing_type && CANONICAL_SET.has(res.filing_type)) {
          await db.query(`UPDATE filings SET filing_type = $2 WHERE id = $1`, [filing.id, res.filing_type]);
          backfilled += 1;
        }
      } catch (err) {
        errors += 1;
        if (errors <= 5) console.error(`  ! filing ${filing.id}: ${err.message}`);
      }
      if (OPTS.delayMs) await new Promise((r) => setTimeout(r, OPTS.delayMs));
    }
    console.error(`… processed ${processed} (last id ${lastId})`);
    if (OPTS.limit && processed >= OPTS.limit) break;
  }

  const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count, pct: +(100 * count / processed).toFixed(1) }));

  const report = {
    processed,
    backfilled,
    noText,
    errors,
    mode: OPTS.useAi ? 'heuristic+ai' : 'heuristic-only',
    bySource: Object.fromEntries(sourceCounts),
    distribution: ranked,
  };

  console.log(JSON.stringify(report, null, 2));
  if (OPTS.outFile) {
    fs.writeFileSync(OPTS.outFile, JSON.stringify(report, null, 2));
    console.error(`\nWrote ${OPTS.outFile}`);
  }
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
