#!/usr/bin/env node
/**
 * Backfill filings.filing_type for the existing corpus so the per-type filters
 * and Testing-tab counts/selection work. Safe to run on production and to leave
 * running unattended.
 *
 * Only processes filings that still have NO type (filing_type IS NULL), so it is
 * RESUMABLE: if it stops or you Ctrl-C it, just run it again and it continues
 * where it left off. It only ever writes the filing_type column (non-destructive).
 *
 * Usage:
 *   node scripts/backfill-filing-types.js                 # heuristic-only (free, fast)
 *   node scripts/backfill-filing-types.js --ai            # + cheap AI fallback for low-confidence (costs tokens)
 *   node scripts/backfill-filing-types.js --limit 1000    # stop after N filings (sampling)
 *   node scripts/backfill-filing-types.js --delay 200     # ms pause between filings (throttle S3/AI)
 *
 * Run and leave (logs to a file, survives terminal close):
 *   nohup node scripts/backfill-filing-types.js > backfill-filing-types.log 2>&1 &
 *   tail -f backfill-filing-types.log
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
  useAi: flag('ai'),
  limit: arg('limit') ? Math.max(1, parseInt(arg('limit'), 10) || 0) : null,
  delayMs: Number(arg('delay', flag('ai') ? '300' : '0')) || 0,
};

let stopping = false;
process.on('SIGINT', () => {
  console.error('\n[backfill] Stop requested — finishing current filing, then exiting cleanly…');
  stopping = true;
});

async function downloadToTemp(filing) {
  const pdfPath = filing.pdf_path;
  if (!isRemoteStoragePath(pdfPath)) {
    if (pdfPath && fs.existsSync(pdfPath)) return { localPath: pdfPath, cleanup: false };
    return null;
  }
  if (!isStorageEnabled()) return null;
  const key = parseStoragePath(pdfPath);
  if (!key) return null;
  const tmp = path.join(os.tmpdir(), `orewire_backfill_${filing.id}_${Date.now()}.pdf`);
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

async function classifyOne(filing) {
  let local = null;
  try {
    local = await downloadToTemp(filing);
    if (!local) return { filing_type: null, source: 'no_pdf' };
    let text = '';
    try {
      const buf = fs.readFileSync(local.localPath);
      const data = await pdfParse(buf, { max: 2 });
      text = data.text || '';
    } catch {
      text = '';
    }
    if (text.trim().length < 40) return { filing_type: null, source: 'no_text' };

    const meta = { pdf_filename: filing.pdf_filename, company_name: filing.company_name, exchange: filing.exchange };
    if (OPTS.useAi) return await classifyFilingType({ text, meta });
    const h = classifyHeuristic({ filename: filing.pdf_filename, text });
    return { filing_type: h.type, source: 'heuristic' };
  } finally {
    if (local?.cleanup && local.localPath && fs.existsSync(local.localPath)) {
      try { fs.unlinkSync(local.localPath); } catch { /* ignore */ }
    }
  }
}

async function main() {
  const started = Date.now();
  const total = (await db.query(
    `SELECT COUNT(*)::int AS n FROM filings WHERE pdf_path IS NOT NULL AND filing_type IS NULL`,
  )).rows[0].n;
  console.log(`[backfill] ${total} untyped filings to process (mode: ${OPTS.useAi ? 'heuristic+ai' : 'heuristic-only'}).`);
  if (!total) { await db.end(); return; }

  let processed = 0;
  let typed = 0;
  let skipped = 0;
  let errors = 0;
  const BATCH = 200;
  // Cursor for rows we couldn't type (skipped/errored) so re-queries skip past them.
  let lastUntypedId = 0;

  for (;;) {
    if (stopping) break;
    if (OPTS.limit && processed >= OPTS.limit) break;

    // Always re-query from the top: rows we type drop out of the NULL set, and
    // rows we can't type (no pdf/text) stay — so advance past them by id.
    const { rows } = await db.query(
      `SELECT id, company_name, exchange, pdf_filename, pdf_path
         FROM filings
        WHERE pdf_path IS NOT NULL AND filing_type IS NULL AND id > $1
        ORDER BY id ASC
        LIMIT $2`,
      [lastUntypedId, BATCH],
    );
    if (rows.length === 0) break;

    for (const filing of rows) {
      if (stopping || (OPTS.limit && processed >= OPTS.limit)) break;
      try {
        const res = await classifyOne(filing);
        processed += 1;
        if (res.filing_type && CANONICAL_SET.has(res.filing_type)) {
          await db.query(`UPDATE filings SET filing_type = $2 WHERE id = $1`, [filing.id, res.filing_type]);
          typed += 1;
        } else {
          // Couldn't confidently type it — advance the cursor so we don't re-fetch it.
          skipped += 1;
          lastUntypedId = filing.id;
        }
      } catch (err) {
        errors += 1;
        lastUntypedId = filing.id;
        if (errors <= 10) console.error(`  ! filing ${filing.id}: ${err.message}`);
      }
      if ((processed % 50) === 0) {
        const rate = processed / ((Date.now() - started) / 1000);
        console.log(`[backfill] processed ${processed}/${total} · typed ${typed} · skipped ${skipped} · errors ${errors} · ${rate.toFixed(1)}/s`);
      }
      if (OPTS.delayMs) await new Promise((r) => setTimeout(r, OPTS.delayMs));
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`[backfill] DONE — processed ${processed}, typed ${typed}, skipped ${skipped}, errors ${errors} in ${secs}s${stopping ? ' (stopped early — re-run to continue)' : ''}.`);
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
