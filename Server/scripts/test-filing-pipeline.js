#!/usr/bin/env node
/**
 * End-to-end smoke test of the filing pipeline against a real filing PDF.
 *
 * Runs: fetch PDF (S3 or local) -> extract text -> classify type -> LLM analyze
 *       -> validate -> build persistence params.
 *
 * The persistence step is BUILT but NOT COMMITTED unless --write is passed, so
 * the default run touches no production rows.
 *
 * Usage:
 *   node scripts/test-filing-pipeline.js                 # newest analyzed filing
 *   node scripts/test-filing-pipeline.js --id 22859      # a specific filing
 *   node scripts/test-filing-pipeline.js --pdf a.pdf     # a local PDF
 *   node scripts/test-filing-pipeline.js --id 123 --write  # also persist
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const { analyzePdf } = require('../lib/scraper/analyzer');
const { extractTextWithFallback } = require('../lib/scraper/analyzer/extract');
const { classifyFilingType } = require('../lib/scraper/analyzer/classify');
const {
  resolveFilingStatus,
  analyzedFlagForAnalysis,
  aiOutputParams,
  AI_OUTPUT_SQL,
} = require('../lib/scraper/analyzer/persist');
const { isExtractionFailed } = require('../lib/scraper/analyzer/constants');
const storage = require('../lib/infra/object-storage');

const DASH_RE = /[—–―‒]/;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}
const has = (name) => process.argv.includes(name);

function step(n, label) {
  console.log(`\n[${n}] ${label}`);
}

async function fetchPdf(filing) {
  const p = filing.pdf_path;
  if (p && !storage.isRemoteStoragePath(p) && fs.existsSync(p)) {
    console.log('    local file:', p);
    return { file: path.resolve(p), cleanup: false };
  }
  const key = storage.parseStoragePath(p);
  if (!key) throw new Error(`cannot resolve pdf_path: ${p}`);
  const objectKey = typeof key === 'string' ? key : key.objectKey || key.key;
  console.log('    s3 key:', objectKey);
  const stream = await storage.getObjectStream(objectKey);
  const dest = path.join(os.tmpdir(), `pipeline-test-${filing.id}.pdf`);
  await new Promise((res, rej) => {
    const w = fs.createWriteStream(dest);
    stream.pipe(w);
    w.on('finish', res);
    w.on('error', rej);
    stream.on('error', rej);
  });
  console.log('    downloaded:', dest, `(${fs.statSync(dest).size} bytes)`);
  return { file: dest, cleanup: true };
}

async function pickFiling() {
  const id = arg('--id');
  const sql = id
    ? `SELECT id, company_id, company_name, exchange, filing_type, pdf_path, pdf_filename
         FROM filings WHERE id = $1`
    : `SELECT id, company_id, company_name, exchange, filing_type, pdf_path, pdf_filename
         FROM filings WHERE pdf_path IS NOT NULL AND analyzed = 1
        ORDER BY created_at DESC LIMIT 1`;
  const r = await db.query(sql, id ? [Number(id)] : []);
  if (!r.rows.length) throw new Error('no filing found');
  return r.rows[0];
}

function scanDashes(analysis) {
  const hits = [];
  const walk = (v, p) => {
    if (typeof v === 'string') { if (DASH_RE.test(v)) hits.push(p); return; }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, p ? `${p}.${k}` : k));
  };
  walk(analysis, '');
  return hits;
}

(async () => {
  const t0 = Date.now();
  let filing;
  let pdf;

  const localPdf = arg('--pdf');
  if (localPdf) {
    filing = { id: 0, company_name: arg('--company') || 'Test Co', exchange: 'TSXV', pdf_filename: path.basename(localPdf) };
    pdf = { file: path.resolve(localPdf), cleanup: false };
    step(1, 'Using local PDF');
    console.log('    ', pdf.file);
  } else {
    step(1, 'Select filing from DB');
    filing = await pickFiling();
    console.log(`     #${filing.id}  ${filing.company_name}  [${filing.exchange}]  type=${filing.filing_type || 'null'}`);
    pdf = await fetchPdf(filing);
  }

  step(2, 'Extract text (pdf layer, OCR fallback)');
  const tExtract = Date.now();
  const { text, usedOcr } = await extractTextWithFallback(pdf.file);
  console.log(`     chars=${text.trim().length}  usedOcr=${!!usedOcr}  ${Date.now() - tExtract}ms`);
  if (text.trim().length < 200) console.log('     WARNING: very little text extracted');

  step(3, 'Classify filing type');
  const tCls = Date.now();
  let classified = null;
  try {
    const cls = await classifyFilingType({
      text,
      meta: {
        pdf_filename: filing.pdf_filename,
        company_name: filing.company_name,
        exchange: filing.exchange,
      },
    });
    classified = cls.filing_type;
    console.log(`     type=${classified}  via=${cls.source || 'n/a'}  ${Date.now() - tCls}ms`);
  } catch (err) {
    console.log('     classify failed (pipeline falls back to full prompt):', err.message);
  }

  step(4, 'Analyze (LLM)');
  const tAI = Date.now();
  const analysis = await analyzePdf(pdf.file, {
    company_name: filing.company_name,
    exchange: filing.exchange,
    filing_type: filing.filing_type || classified,
    pdf_filename: filing.pdf_filename,
  });
  console.log(`     ${Date.now() - tAI}ms`);
  console.log('     verdict      :', analysis.verdict);
  console.log('     display_type :', analysis.display_type);
  console.log('     extraction   :', isExtractionFailed(analysis) ? 'FAILED' : 'ok');
  console.log('     summary      :', String(analysis.summary || '').slice(0, 160));
  console.log('     key_facts    :', (analysis.key_facts || []).length, 'item(s)');

  step(5, 'Build persistence params (sanitizeProse applies here)');
  const status = resolveFilingStatus(analysis, filing.company_name);
  const analyzed = analyzedFlagForAnalysis(analysis);
  const params = aiOutputParams(filing.id, analysis);
  console.log(`     status=${status}  analyzed=${analyzed}  params=${params.length}`);

  const rawDashes = scanDashes(analysis);
  // params order: [filing_id, display_type, ticker_summary, summary, verdict,
  //                verdict_reason, key_facts, context, grade_commentary, what_to_watch, ...]
  const prose = params.slice(1, 10).filter((v) => typeof v === 'string');
  const persistedDashes = prose.filter((v) => DASH_RE.test(v));
  console.log(`     model output had dashes in : ${rawDashes.length ? rawDashes.join(', ') : 'none'}`);
  console.log(`     dashes surviving into DB   : ${persistedDashes.length}`);
  if (persistedDashes.length) {
    console.log('     LEAK:', persistedDashes.map((s) => s.slice(0, 80)));
  }

  if (has('--write')) {
    step(6, 'PERSIST to database');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE filings SET analyzed = $2, status = $3 WHERE id = $1', [filing.id, analyzed, status]);
      await client.query(AI_OUTPUT_SQL, params);
      await client.query('COMMIT');
      console.log('     committed for filing', filing.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    step(6, 'Persist SKIPPED (dry run) - pass --write to commit');
  }

  if (pdf.cleanup) fs.unlinkSync(pdf.file);
  console.log(`\nPipeline OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch((err) => {
  console.error('\nPIPELINE FAILED:', err.message);
  console.error(err.stack?.split('\n').slice(1, 5).join('\n'));
  process.exit(1);
});
