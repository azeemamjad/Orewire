/**
 * Orphan reconciliation for Admin → Storage.
 *
 * An ORPHAN is a filing PDF that exists in the S3 bucket and/or on local disk
 * but has no row in `filings` pointing at it. They accumulate because both write
 * paths upload the object BEFORE inserting the row (pipeline/runner.js), so any
 * analysis failure or rolled-back sync leaves the object behind with no record.
 *
 * Two populations, and they behave very differently:
 *
 *   TICKER/…    keys written by the live pipeline. The first path segment is the
 *               company directory, so the issuer is recoverable from the key
 *               alone — these can be matched and adopted cheaply.
 *
 *   <prefix>/…  content-hash keys (filings/<sha256>.pdf) from the legacy import.
 *               The key carries no issuer signal at all, so matching would mean
 *               downloading and reading each PDF. Reported here as unmatchable;
 *               scripts/reconcile-s3-orphans.js is the (expensive) recovery path.
 *
 * Everything in this module is orphan-scoped: a key referenced by any filings
 * row is filtered out of the index up front and re-checked immediately before
 * any delete, so nothing here can touch live data.
 */
const fs = require('fs');
const path = require('path');

const db = require('../../db');
const aws = require('./aws-s3-storage');
const {
  getFilingPrefix,
  isStorageEnabled,
  parseStoragePath,
  localPathToObjectKey,
  persistFilingPdf,
  toDbStoragePath,
} = require('./object-storage');

const { DOWNLOADS_DIR } = require('../scraper/paths');
const {
  resolveFilingStatus,
  analyzedFlagForAnalysis,
  inferCommodity,
  aiOutputParams,
  AI_OUTPUT_SQL,
} = require('../scraper/analyzer/persist');
const { isExtractionFailed } = require('../scraper/analyzer/constants');
const { upsertInsiderData } = require('../../db/insiders');

// Listing 90k+ objects is ~90 paginated calls. Volume does not move minute to
// minute, so hold it; every mutating path invalidates explicitly.
const BUCKET_TTL_MS = 5 * 60 * 1000;
const INDEX_TTL_MS = 60 * 1000;

let bucketCache = null;
let indexCache = null;

function invalidate() {
  bucketCache = null;
  indexCache = null;
}

/** Whole-bucket object list, shared by the summary cards and the orphan index. */
async function getBucketObjects({ force = false } = {}) {
  if (!isStorageEnabled()) return [];
  const fresh = bucketCache && Date.now() - bucketCache.at < BUCKET_TTL_MS;
  if (fresh && !force) return bucketCache.objects;
  const objects = await aws.listObjects('');
  bucketCache = { at: Date.now(), objects };
  return objects;
}

function bucketCachedAt() {
  return bucketCache?.at ?? null;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

function sidecarFor(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, '_analysis.json');
}

function relKey(fullPath) {
  return path.relative(DOWNLOADS_DIR, fullPath).split(path.sep).join('/');
}

function walkPdfs(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPdfs(full, out);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.pdf')) continue;
    try {
      const st = fs.statSync(full);
      out.push({ full, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* vanished mid-walk */
    }
  }
  return out;
}

/** Every object key any filings row points at, remote or local. */
async function referencedKeys() {
  const { rows } = await db.query('SELECT pdf_path FROM filings WHERE pdf_path IS NOT NULL');
  const keys = new Set();
  for (const row of rows) {
    const remote = parseStoragePath(row.pdf_path);
    if (remote) {
      keys.add(remote);
      continue;
    }
    try {
      keys.add(localPathToObjectKey(path.resolve(row.pdf_path), DOWNLOADS_DIR));
    } catch {
      /* unparseable legacy path — cannot collide with a bucket key */
    }
  }
  return keys;
}

/**
 * Company directory from an object key. Content-hash keys under the configured
 * filing prefix carry no issuer, so they return null and stay unmatchable.
 */
function tickerFromKey(key) {
  const parts = String(key).split('/');
  if (parts.length < 2) return null;
  if (parts[0] === getFilingPrefix()) return null;
  return parts[0] || null;
}

/**
 * The pipeline names a company directory two different ways: ASX uses the
 * ticker, SEDAR uses the company name with non-word characters replaced by "_"
 * (see queueAnalysesForCompany in pipeline/runner.js). Reversing that
 * sanitisation is what lets a bare directory name resolve back to a company.
 */
function sanitizeToDirName(name) {
  return String(name || '').replace(/[^\w\s-]/g, '_').trim().toLowerCase();
}

/**
 * In-memory company index. There are only a couple of thousand companies but
 * tens of thousands of orphans across ~1k directories — doing this with
 * findCompanyForFiling would be thousands of sequential round-trips and the
 * admin page would hang for minutes. One query, then match locally.
 */
async function buildCompanyIndex() {
  const { rows } = await db.query('SELECT id, name, exchange, ticker FROM companies');

  const tickerCounts = new Map();
  const byTicker = new Map();
  const byName = new Map();
  const byDirName = new Map();

  for (const c of rows) {
    const tk = (c.ticker || '').trim().toUpperCase().replace(/\s+/g, '');
    if (tk) {
      tickerCounts.set(tk, (tickerCounts.get(tk) || 0) + 1);
      if (!byTicker.has(tk)) byTicker.set(tk, c);
    }
    const nm = (c.name || '').trim().toLowerCase();
    if (nm && !byName.has(nm)) byName.set(nm, c);
    const dir = sanitizeToDirName(c.name);
    if (dir && !byDirName.has(dir)) byDirName.set(dir, c);
  }

  return { tickerCounts, byTicker, byName, byDirName };
}

/**
 * Resolve each orphan's company from its object key, mirroring the precedence
 * in lib/companies/match.js: an unambiguous ticker wins, then the directory
 * name, then the plain company name. An ambiguous ticker (same symbol on two
 * exchanges) deliberately stays unmatched rather than guessing an issuer.
 */
async function attachCompanies(orphans) {
  const idx = await buildCompanyIndex();
  const resolved = new Map();

  for (const orphan of orphans) {
    const dir = tickerFromKey(orphan.key);
    orphan.ticker = dir;
    if (!dir) {
      orphan.company = null;
      orphan.matchedBy = null;
      continue;
    }

    if (!resolved.has(dir)) {
      const tk = dir.trim().toUpperCase().replace(/\s+/g, '');
      let company = null;
      let matchedBy = null;

      if (idx.tickerCounts.get(tk) === 1) {
        company = idx.byTicker.get(tk);
        matchedBy = 'ticker';
      }
      if (!company) {
        company = idx.byDirName.get(dir.toLowerCase());
        if (company) matchedBy = 'directory name';
      }
      if (!company) {
        company = idx.byName.get(dir.replace(/_/g, ' ').trim().toLowerCase());
        if (company) matchedBy = 'company name';
      }
      if (!company && idx.tickerCounts.get(tk) > 1) matchedBy = 'ambiguous ticker';

      resolved.set(dir, { company, matchedBy });
    }

    const { company, matchedBy } = resolved.get(dir);
    orphan.company = company
      ? { id: company.id, name: company.name, exchange: company.exchange, ticker: company.ticker }
      : null;
    orphan.matchedBy = company ? matchedBy : (matchedBy || null);
  }

  return orphans;
}

/**
 * Full orphan index: everything in the bucket or on disk with no filings row.
 * `hasAnalysis` decides whether an adopt can carry real AI output or would land
 * an unanalyzed shell row.
 */
async function buildIndex({ force = false } = {}) {
  const referenced = await referencedKeys();
  const byKey = new Map();

  for (const obj of await getBucketObjects({ force })) {
    const key = obj.name || '';
    if (!key.toLowerCase().endsWith('.pdf')) continue;
    if (referenced.has(key)) continue;
    byKey.set(key, {
      key,
      size: obj.size || 0,
      mtime: obj.mtime || null,
      inS3: true,
      onDisk: false,
      hasAnalysis: false,
      underPrefix: key.startsWith(`${getFilingPrefix()}/`),
    });
  }

  for (const file of walkPdfs(DOWNLOADS_DIR)) {
    const key = relKey(file.full);
    if (referenced.has(key)) continue;
    const entry = byKey.get(key) || {
      key,
      size: file.size,
      mtime: file.mtime,
      inS3: false,
      onDisk: false,
      hasAnalysis: false,
      underPrefix: key.startsWith(`${getFilingPrefix()}/`),
    };
    entry.onDisk = true;
    entry.localSize = file.size;
    entry.localPath = file.full;
    entry.hasAnalysis = fs.existsSync(sidecarFor(file.full));
    byKey.set(key, entry);
  }

  const orphans = [...byKey.values()];
  await attachCompanies(orphans);
  orphans.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return orphans;
}

async function getIndex({ force = false } = {}) {
  const fresh = indexCache && Date.now() - indexCache.at < INDEX_TTL_MS;
  if (fresh && !force) return indexCache.orphans;
  const orphans = await buildIndex({ force });
  indexCache = { at: Date.now(), orphans };
  return orphans;
}

function summarize(orphans) {
  const acc = {
    total: 0,
    bytes: 0,
    matched: 0,
    matchedBytes: 0,
    unmatched: 0,
    unmatchedBytes: 0,
    withAnalysis: 0,
    inS3Only: 0,
    inS3OnlyBytes: 0,
    onDiskOnly: 0,
    onDiskOnlyBytes: 0,
    both: 0,
    underPrefix: 0,
    underPrefixBytes: 0,
  };
  for (const o of orphans) {
    acc.total++;
    acc.bytes += o.size || 0;
    if (o.company) { acc.matched++; acc.matchedBytes += o.size || 0; } else { acc.unmatched++; acc.unmatchedBytes += o.size || 0; }
    if (o.hasAnalysis) acc.withAnalysis++;
    if (o.inS3 && o.onDisk) acc.both++;
    else if (o.inS3) { acc.inS3Only++; acc.inS3OnlyBytes += o.size || 0; }
    else { acc.onDiskOnly++; acc.onDiskOnlyBytes += o.size || 0; }
    if (o.underPrefix) { acc.underPrefix++; acc.underPrefixBytes += o.size || 0; }
  }
  return acc;
}

/** Paged, filtered view for the admin table. */
async function listOrphans({
  source = 'all',
  match = 'all',
  q = '',
  limit = 50,
  offset = 0,
  force = false,
} = {}) {
  const all = await getIndex({ force });

  const needle = String(q || '').trim().toLowerCase();
  const filtered = all.filter((o) => {
    if (source === 's3' && !o.inS3) return false;
    if (source === 'disk' && !o.onDisk) return false;
    if (source === 's3-only' && (!o.inS3 || o.onDisk)) return false;
    if (match === 'matched' && !o.company) return false;
    if (match === 'unmatched' && o.company) return false;
    if (needle && !o.key.toLowerCase().includes(needle)
      && !(o.company?.name || '').toLowerCase().includes(needle)) return false;
    return true;
  });

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  return {
    rows: filtered.slice(safeOffset, safeOffset + safeLimit),
    filteredCount: filtered.length,
    filteredBytes: filtered.reduce((s, o) => s + (o.size || 0), 0),
    summary: summarize(all),
    downloadsDir: DOWNLOADS_DIR,
    filingPrefix: getFilingPrefix(),
    bucketCachedAt: bucketCachedAt(),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function findByKeys(keys) {
  const wanted = new Set(keys);
  const all = await getIndex();
  return all.filter((o) => wanted.has(o.key));
}

// ---------------------------------------------------------------------------
// Adopt — give an orphan a filings row
// ---------------------------------------------------------------------------

function readAnalysis(orphan) {
  if (!orphan.onDisk || !orphan.hasAnalysis) return null;
  try {
    return JSON.parse(fs.readFileSync(sidecarFor(orphan.localPath), 'utf8'));
  } catch {
    return null;
  }
}

const INSERT_FILING_SQL = `
  INSERT INTO filings
    (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status, filing_type)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (pdf_path) DO NOTHING
  RETURNING id
`;

/**
 * Adopt one orphan inside its own transaction, so a bad file never rolls back a
 * batch. Requires a company; without an analysis sidecar it refuses unless the
 * caller opts into an unanalyzed shell row (`allowUnanalyzed`), because every
 * filing currently carries exactly one ai_output and blank rows surface on site.
 */
async function adoptOrphan(orphan, { companyId = null, allowUnanalyzed = false } = {}) {
  if (!isStorageEnabled()) return { adopted: false, reason: 'storage_disabled' };

  const analysis = readAnalysis(orphan);
  if (!analysis && !allowUnanalyzed) return { adopted: false, reason: 'no_analysis' };

  const client = await db.connect();
  try {
    let company = null;
    if (companyId) {
      const r = await client.query(
        'SELECT id, name, exchange, ticker FROM companies WHERE id = $1',
        [companyId],
      );
      company = r.rows[0] || null;
    } else if (orphan.company?.id) {
      company = orphan.company;
    }
    if (!company) return { adopted: false, reason: 'no_company' };

    await client.query('BEGIN');

    // The object must be in S3 before the row points at it. Disk-only orphans
    // get uploaded here; ones already in the bucket short-circuit on exists.
    let storedPath;
    if (orphan.onDisk && fs.existsSync(orphan.localPath)) {
      storedPath = await persistFilingPdf(orphan.localPath, orphan.key);
    } else if (orphan.inS3) {
      storedPath = toDbStoragePath(orphan.key);
    } else {
      await client.query('ROLLBACK');
      return { adopted: false, reason: 'file_gone' };
    }

    const companyName = company.name;
    const status = analysis ? resolveFilingStatus(analysis, companyName) : 'downloaded';
    const analyzed = analysis ? analyzedFlagForAnalysis(analysis) : 0;
    const commodity = analysis
      ? inferCommodity(analysis.summary, analysis.ticker_summary)
      : null;

    const inserted = await client.query(INSERT_FILING_SQL, [
      company.id,
      companyName,
      path.basename(orphan.key),
      storedPath,
      commodity,
      company.exchange || null,
      analyzed,
      status,
      analysis?.filing_type || null,
    ]);

    const filingId = inserted.rows[0]?.id;
    if (!filingId) {
      await client.query('ROLLBACK');
      return { adopted: false, reason: 'already_exists' };
    }

    if (analysis) {
      await client.query(AI_OUTPUT_SQL, aiOutputParams(filingId, analysis));
      if (!isExtractionFailed(analysis)) {
        await upsertInsiderData(client, company.id, filingId, analysis.data_extracted || {});
      }
    }

    await client.query('COMMIT');
    return { adopted: true, filingId, companyId: company.id, companyName };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already unwound */ }
    return { adopted: false, reason: 'error', error: err.message };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Delete — orphans only, re-verified at the last moment
// ---------------------------------------------------------------------------

/**
 * Delete orphan copies. `scope` picks where: 's3', 'disk', or 'both'.
 *
 * Every key is re-checked against filings immediately before deletion, so a row
 * created between the index build and this call protects its object. Local
 * deletes take the _analysis.json sidecar with them — a stranded sidecar whose
 * PDF is gone would make the next pipeline sync insert a row pointing at a
 * nonexistent local file.
 */
async function deleteOrphans(keys, { scope = 'both' } = {}) {
  const requested = [...new Set(keys || [])].filter(Boolean);
  const result = {
    requested: requested.length,
    deletedS3: 0,
    deletedDisk: 0,
    freedBytes: 0,
    skippedReferenced: 0,
    errors: [],
  };
  if (requested.length === 0) return result;

  const referenced = await referencedKeys();
  const safe = [];
  for (const key of requested) {
    if (referenced.has(key)) result.skippedReferenced++;
    else safe.push(key);
  }
  if (safe.length === 0) return result;

  const index = new Map((await getIndex()).map((o) => [o.key, o]));

  if (scope === 'disk' || scope === 'both') {
    for (const key of safe) {
      const localPath = index.get(key)?.localPath || path.join(DOWNLOADS_DIR, key);
      try {
        const st = fs.statSync(localPath);
        fs.unlinkSync(localPath);
        result.deletedDisk++;
        result.freedBytes += st.size;
        try { fs.unlinkSync(sidecarFor(localPath)); } catch { /* no sidecar */ }
      } catch {
        /* not on disk — nothing to reclaim */
      }
    }
  }

  if ((scope === 's3' || scope === 'both') && isStorageEnabled()) {
    const inBucket = safe.filter((key) => index.get(key)?.inS3 !== false);
    const res = await aws.deleteObjects(inBucket);
    result.deletedS3 = res.deleted;
    result.errors.push(...res.errors);
  }

  invalidate();
  return result;
}

module.exports = {
  getBucketObjects,
  bucketCachedAt,
  invalidate,
  getIndex,
  listOrphans,
  findByKeys,
  summarize,
  adoptOrphan,
  deleteOrphans,
  tickerFromKey,
  DOWNLOADS_DIR,
};
