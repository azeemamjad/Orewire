#!/usr/bin/env node
/**
 * Reconcile S3 orphan PDFs into the filings table, matching companies and
 * running AI analysis — so orphaned documents in the bucket become processable.
 *
 * BACKGROUND
 *   S3 objects are named by content hash (filings/<sha256>.pdf) with NO company
 *   metadata in the key. The company↔file link only exists in the DB row created
 *   at scrape time. "Orphans" are S3 PDFs that no filings.pdf_path references.
 *   The only company signal for an orphan is INSIDE the document, so each orphan
 *   is downloaded, text-extracted, LLM-analyzed, and matched to a company by the
 *   issuer names the model reads out of the PDF.
 *
 * SAFETY
 *   - Dry-run by default: downloads + analyzes + matches, but writes NOTHING.
 *     Pass --commit to actually INSERT filings + ai_output.
 *   - INSERT uses ON CONFLICT (pdf_path) DO NOTHING — never clobbers existing rows.
 *   - One transaction PER orphan, so a single failure never rolls back the batch.
 *
 * USAGE
 *   node scripts/reconcile-s3-orphans.js                # dry-run, 25 orphans
 *   node scripts/reconcile-s3-orphans.js --limit 50     # dry-run, 50
 *   node scripts/reconcile-s3-orphans.js --limit 50 --commit   # write to DB
 *   node scripts/reconcile-s3-orphans.js --dump-orphans orphans.txt  # just list
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const db = require('../db');
const aws = require('../lib/infra/aws-s3-storage');
const { getFilingPrefix } = require('../lib/infra/object-storage');
const { analyzePdf, isExtractionFailed } = require('../lib/scraper/analyzer');
const { findCompanyForFiling } = require('../lib/companies/match');
const {
  resolveFilingStatus,
  analyzedFlagForAnalysis,
  aiOutputParams,
  AI_OUTPUT_SQL,
} = require('../lib/scraper/analyzer/persist');
const { upsertInsiderData } = require('../db/insiders');

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const LIMIT = Math.max(1, parseInt(opt('--limit', '25'), 10));
const COMMIT = flag('--commit');
const DUMP = opt('--dump-orphans', null);

const HASH_RE = /^filings\/[0-9a-f]{64}\.pdf$/;
const INSERT_FILING_SQL = `
  INSERT INTO filings
    (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, filing_type, analyzed, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (pdf_path) DO NOTHING
  RETURNING id
`;

// Local copy of upload.js's commodity heuristic (not exported there).
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

/** Try to resolve a companies row from the issuer names the model read out. */
async function matchCompany(client, analysis) {
  const issuers = Array.isArray(analysis?.issuer_names_from_document)
    ? analysis.issuer_names_from_document
    : [];
  for (const name of issuers) {
    if (!name) continue;
    const row = await findCompanyForFiling(client, { companyName: name });
    if (row) return { row, issuer: name };
  }
  return { row: null, issuer: issuers[0] || null };
}

async function downloadToTemp(objectKey) {
  const tmp = path.join(os.tmpdir(), `orphan-${crypto.randomBytes(6).toString('hex')}.pdf`);
  const stream = await aws.getObjectStream(objectKey);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });
  return tmp;
}

async function referencedKeys() {
  const { rows } = await db.query(`SELECT pdf_path FROM filings WHERE pdf_path IS NOT NULL`);
  const set = new Set();
  for (const { pdf_path: p } of rows) {
    if (p.startsWith('s3:')) set.add(p.slice(3));
    else if (p.startsWith('minio:')) set.add(p.slice(6));
    // https:// public URLs → best-effort last path segment
    else if (p.startsWith('https://')) {
      const m = p.match(/(filings\/[0-9a-f]{64}\.pdf)/);
      if (m) set.add(m[1]);
    }
  }
  return set;
}

async function main() {
  const prefix = `${getFilingPrefix()}/`;
  console.log(`Mode: ${COMMIT ? 'COMMIT (writes to DB)' : 'DRY-RUN (no writes)'}  limit=${LIMIT}`);

  console.log('Loading referenced keys from DB…');
  const referenced = await referencedKeys();
  console.log(`  DB references ${referenced.size} object keys`);

  console.log(`Listing S3 objects under ${prefix}…`);
  const objects = await aws.listObjects(prefix);
  const pdfs = objects.filter((o) => HASH_RE.test(o.name));
  const orphans = pdfs.filter((o) => !referenced.has(o.name));
  console.log(`  S3: ${objects.length} objects, ${pdfs.length} hash-PDFs, ${orphans.length} ORPHANS`);

  if (DUMP) {
    fs.writeFileSync(DUMP, orphans.map((o) => o.name).join('\n'));
    console.log(`Wrote ${orphans.length} orphan keys to ${DUMP}`);
    await db.end();
    return;
  }

  const batch = orphans.slice(0, LIMIT);
  console.log(`\nProcessing ${batch.length} orphan(s)…\n`);

  const stats = {
    total: batch.length, analyzed: 0, matched: 0, unmatched: 0,
    extractionFailed: 0, inserted: 0, errors: 0, results: [],
  };

  for (const obj of batch) {
    const key = obj.name;
    let tmp;
    const client = await db.connect();
    try {
      tmp = await downloadToTemp(key);
      const analysis = await analyzePdf(tmp, {});
      stats.analyzed++;
      if (isExtractionFailed(analysis)) stats.extractionFailed++;

      const { row: companyRow, issuer } = await matchCompany(client, analysis);
      if (companyRow) stats.matched++; else stats.unmatched++;

      const companyName = companyRow?.name || issuer || 'Unknown Issuer';
      const status = resolveFilingStatus(analysis, companyName);
      const analyzed = analyzedFlagForAnalysis(analysis);
      const commodity = inferCommodity(analysis.summary, analysis.ticker_summary);
      const pdfPath = `s3:${key}`;
      const pdfFilename = path.basename(key);

      const record = {
        key,
        companyId: companyRow?.id ?? null,
        companyName,
        issuer,
        verdict: analysis.verdict,
        status,
        commodity,
      };

      if (COMMIT) {
        await client.query('BEGIN');
        const fi = await client.query(INSERT_FILING_SQL, [
          companyRow?.id ?? null,
          companyName,
          pdfFilename,
          pdfPath,
          commodity,
          companyRow?.exchange || null,
          'news release',
          analyzed,
          status,
        ]);
        const fid = fi.rows[0]?.id;
        if (fid) {
          await client.query(AI_OUTPUT_SQL, aiOutputParams(fid, analysis));
          if (!isExtractionFailed(analysis)) {
            await upsertInsiderData(client, companyRow?.id ?? null, fid, analysis.data_extracted || {});
          }
          stats.inserted++;
          record.filingId = fid;
        } else {
          record.note = 'conflict (already present) — skipped';
        }
        await client.query('COMMIT');
      }

      stats.results.push(record);
      console.log(
        `  ✓ ${key.slice(9, 21)}…  ${companyRow ? `[${companyRow.exchange || '?'}] ${companyName}` : `(no match) "${issuer || '—'}"`}` +
        `  verdict=${analysis.verdict} status=${status}${COMMIT ? (record.filingId ? ` inserted id=${record.filingId}` : ' [conflict]') : ' [dry-run]'}`,
      );
    } catch (err) {
      try { if (COMMIT) await client.query('ROLLBACK'); } catch { /* ignore */ }
      stats.errors++;
      stats.results.push({ key, error: err.message });
      console.log(`  ✗ ${key.slice(9, 21)}…  ERROR: ${err.message}`);
    } finally {
      client.release();
      if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    }
  }

  console.log('\n================ SUMMARY ================');
  console.log(`orphans in bucket : ${orphans.length}`);
  console.log(`processed         : ${stats.total}`);
  console.log(`analyzed          : ${stats.analyzed}`);
  console.log(`company matched   : ${stats.matched}`);
  console.log(`no company match  : ${stats.unmatched}`);
  console.log(`extraction failed : ${stats.extractionFailed}`);
  console.log(`inserted to DB    : ${COMMIT ? stats.inserted : '(dry-run — 0)'}`);
  console.log(`errors            : ${stats.errors}`);

  await db.end();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
