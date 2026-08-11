/**
 * In-process storage migration job for the Admin → Storage page.
 *
 * Two modes, both resumable and safe to re-run:
 *
 *   upload — filings whose pdf_path is still a local path get pushed to S3 and
 *            the row rewritten to the s3: key. This is the CLI equivalent of
 *            scripts/import-orphan-pdfs.js for rows that already exist in the DB.
 *
 *   prune  — filings already on S3 (s3:/minio:/https:) whose local copy is still
 *            sitting in DOWNLOADS_DIR get that local copy deleted, but only after
 *            a HEAD confirms the remote object exists AND its size matches byte
 *            for byte. This is what actually reclaims server disk: the pipeline
 *            uploads but never removes the local file, so downloads grow forever.
 *
 * Only one job runs at a time. The UI starts it with a button and polls
 * getStatus() for live progress; nothing here blocks the API event loop for long
 * because every iteration awaits network or fs work.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const {
  isStorageEnabled,
  isRemoteStoragePath,
  parseStoragePath,
  localPathToObjectKey,
  persistFilingPdf,
  statObject,
  ensureBucket,
} = require('./object-storage');

const orphanIndex = require('./orphans');

const { DOWNLOADS_DIR } = require('../scraper/paths');

const MAX_LOG = 60;

const state = {
  status: 'idle', // 'idle' | 'running' | 'done' | 'stopped' | 'error'
  mode: null, // 'upload' | 'prune' | 'adopt' | 'purge'
  dryRun: false,
  includeOrphans: false,
  scope: 'both',
  onlyMatched: true,
  purgeTarget: 'unmatched', // 'unmatched' | 'all'
  allowUnanalyzed: false,
  total: 0,
  processed: 0,
  uploaded: 0,
  pruned: 0,
  adopted: 0,
  skipped: 0,
  mismatched: 0,
  errors: 0,
  uploadedBytes: 0,
  freedBytes: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  stopRequested: false,
  log: [],
};

function addLog(level, message) {
  state.log.unshift({ level, message, at: Date.now() });
  if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
}

function getStatus() {
  const elapsedMs = state.startedAt ? ((state.finishedAt || Date.now()) - state.startedAt) : 0;
  const rate = elapsedMs > 0 ? state.processed / (elapsedMs / 1000) : 0;
  const remaining = Math.max(0, state.total - state.processed);
  const etaSec = rate > 0 && state.status === 'running' ? Math.round(remaining / rate) : null;
  return {
    status: state.status,
    running: state.status === 'running',
    mode: state.mode,
    dryRun: state.dryRun,
    includeOrphans: state.includeOrphans,
    scope: state.scope,
    onlyMatched: state.onlyMatched,
    purgeTarget: state.purgeTarget,
    allowUnanalyzed: state.allowUnanalyzed,
    total: state.total,
    processed: state.processed,
    uploaded: state.uploaded,
    pruned: state.pruned,
    adopted: state.adopted,
    skipped: state.skipped,
    mismatched: state.mismatched,
    errors: state.errors,
    uploadedBytes: state.uploadedBytes,
    freedBytes: state.freedBytes,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    lastError: state.lastError,
    elapsedMs,
    rate: +rate.toFixed(2),
    remaining,
    etaSec,
    log: state.log,
  };
}

// ---------------------------------------------------------------------------
// Disk scan — powers the "Local disk" cards on the Storage page
// ---------------------------------------------------------------------------

function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.json')) continue;
    try {
      out.push({ full, size: fs.statSync(full).size, isPdf: lower.endsWith('.pdf') });
    } catch {
      /* file vanished mid-walk */
    }
  }
  return out;
}

/**
 * Local footprint vs what the DB says is already remote. `reclaimable` is an
 * estimate — prune re-verifies every file against S3 before deleting anything.
 */
async function scanLocalDisk() {
  const exists = fs.existsSync(DOWNLOADS_DIR);
  if (!exists) {
    return {
      downloadsDir: DOWNLOADS_DIR,
      exists: false,
      pdfCount: 0,
      pdfBytes: 0,
      jsonCount: 0,
      jsonBytes: 0,
      totalBytes: 0,
      reclaimableCount: 0,
      reclaimableBytes: 0,
      pendingUploadCount: 0,
      pendingUploadBytes: 0,
      orphanCount: 0,
      orphanBytes: 0,
    };
  }

  const files = walkFiles(DOWNLOADS_DIR);
  const pdfs = files.filter((f) => f.isPdf);
  const jsons = files.filter((f) => !f.isPdf);

  const { rows } = await db.query('SELECT pdf_path FROM filings WHERE pdf_path IS NOT NULL');

  // Object keys are DOWNLOADS_DIR-relative, so a remote row maps straight back
  // to the local file it was uploaded from.
  const remoteKeys = new Set();
  const localPaths = new Set();
  for (const row of rows) {
    if (isRemoteStoragePath(row.pdf_path)) {
      const key = parseStoragePath(row.pdf_path);
      if (key) remoteKeys.add(key);
    } else {
      localPaths.add(path.resolve(row.pdf_path));
    }
  }

  let reclaimableCount = 0;
  let reclaimableBytes = 0;
  let pendingUploadCount = 0;
  let pendingUploadBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;

  for (const f of pdfs) {
    const rel = path.relative(DOWNLOADS_DIR, f.full).split(path.sep).join('/');
    if (remoteKeys.has(rel)) {
      reclaimableCount++;
      reclaimableBytes += f.size;
    } else if (localPaths.has(f.full)) {
      pendingUploadCount++;
      pendingUploadBytes += f.size;
    } else {
      orphanCount++;
      orphanBytes += f.size;
    }
  }

  const pdfBytes = pdfs.reduce((s, f) => s + f.size, 0);
  const jsonBytes = jsons.reduce((s, f) => s + f.size, 0);

  return {
    downloadsDir: DOWNLOADS_DIR,
    exists: true,
    pdfCount: pdfs.length,
    pdfBytes,
    jsonCount: jsons.length,
    jsonBytes,
    totalBytes: pdfBytes + jsonBytes,
    reclaimableCount,
    reclaimableBytes,
    pendingUploadCount,
    pendingUploadBytes,
    orphanCount,
    orphanBytes,
  };
}

// ---------------------------------------------------------------------------
// Mode: upload — local pdf_path rows → S3
// ---------------------------------------------------------------------------

async function runUpload() {
  const { rows } = await db.query(`
    SELECT id, pdf_path FROM filings
    WHERE pdf_path IS NOT NULL
      AND pdf_path NOT LIKE 's3:%'
      AND pdf_path NOT LIKE 'minio:%'
      AND pdf_path NOT LIKE 'https://%'
    ORDER BY id
  `);

  state.total = rows.length;
  addLog('info', `${rows.length} filing(s) with a local pdf_path`);
  if (rows.length === 0) return;

  if (!state.dryRun) await ensureBucket();

  for (const row of rows) {
    if (state.stopRequested) break;
    state.processed++;

    const localAbs = path.resolve(row.pdf_path);
    if (!fs.existsSync(localAbs)) {
      state.skipped++;
      continue;
    }

    try {
      const objectKey = localPathToObjectKey(localAbs, DOWNLOADS_DIR);
      const size = fs.statSync(localAbs).size;

      if (state.dryRun) {
        state.uploaded++;
        state.uploadedBytes += size;
        continue;
      }

      const storedPath = await persistFilingPdf(localAbs, objectKey);

      // filings.pdf_path is UNIQUE — another row may already own this key
      // (duplicate download). Guard the update so it degrades to a skip.
      const upd = await db.query(
        `UPDATE filings SET pdf_path = $1
           WHERE id = $2
             AND NOT EXISTS (SELECT 1 FROM filings f2 WHERE f2.pdf_path = $1 AND f2.id <> $2)
         RETURNING id`,
        [storedPath, row.id],
      );
      if (upd.rows.length === 0) {
        state.skipped++;
        if (state.skipped <= 10) addLog('warn', `id=${row.id}: ${objectKey} already owned by another row — kept local`);
        continue;
      }

      state.uploaded++;
      state.uploadedBytes += size;

      if (state.uploaded % 100 === 0) {
        addLog('info', `${state.uploaded} uploaded (${fmtBytes(state.uploadedBytes)})`);
      }
    } catch (err) {
      state.errors++;
      if (state.errors <= 15) addLog('err', `id=${row.id}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Mode: prune — delete local copies verified present in S3
// ---------------------------------------------------------------------------

async function runPrune() {
  const { rows } = await db.query(`
    SELECT id, pdf_path FROM filings
    WHERE pdf_path LIKE 's3:%' OR pdf_path LIKE 'minio:%' OR pdf_path LIKE 'https://%'
    ORDER BY id
  `);

  state.total = rows.length;
  addLog('info', `${rows.length} remote filing(s) to check against ${DOWNLOADS_DIR}`);

  for (const row of rows) {
    if (state.stopRequested) break;
    state.processed++;

    const key = parseStoragePath(row.pdf_path);
    if (!key) {
      state.skipped++;
      continue;
    }

    const localPath = path.join(DOWNLOADS_DIR, key);
    if (!fs.existsSync(localPath)) {
      state.skipped++;
      continue;
    }

    try {
      const localSize = fs.statSync(localPath).size;
      // HEAD before unlink — never delete a local copy we cannot prove is on S3.
      const remote = await statObject(key);
      if (remote.size !== localSize) {
        state.mismatched++;
        if (state.mismatched <= 10) {
          addLog('warn', `size mismatch id=${row.id} local=${localSize} remote=${remote.size} — kept`);
        }
        continue;
      }

      if (!state.dryRun) fs.unlinkSync(localPath);
      state.pruned++;
      state.freedBytes += localSize;

      if (state.pruned % 250 === 0) {
        addLog('info', `${state.pruned} removed (${fmtBytes(state.freedBytes)} freed)`);
      }
    } catch (err) {
      state.errors++;
      if (state.errors <= 15) addLog('err', `id=${row.id}: ${err.message}`);
    }
  }

  if (state.includeOrphans && !state.stopRequested) {
    await pruneOrphans();
  }
}

/**
 * PDFs on disk that no DB row points at. Irreversible — they are not in S3 and
 * not in the database, so this is opt-in behind an explicit confirmation.
 */
async function pruneOrphans() {
  addLog('warn', 'Scanning for orphan PDFs (on disk, not referenced by any filing)…');

  const { rows } = await db.query('SELECT pdf_path FROM filings WHERE pdf_path IS NOT NULL');
  const known = new Set();
  for (const row of rows) {
    if (isRemoteStoragePath(row.pdf_path)) {
      const key = parseStoragePath(row.pdf_path);
      if (key) known.add(key);
    } else {
      const rel = localPathToObjectKey(path.resolve(row.pdf_path), DOWNLOADS_DIR);
      known.add(rel);
    }
  }

  for (const file of walkFiles(DOWNLOADS_DIR)) {
    if (state.stopRequested) break;
    if (!file.isPdf) continue;
    const rel = path.relative(DOWNLOADS_DIR, file.full).split(path.sep).join('/');
    if (known.has(rel)) continue;
    try {
      if (!state.dryRun) fs.unlinkSync(file.full);
      state.pruned++;
      state.freedBytes += file.size;
    } catch (err) {
      state.errors++;
      if (state.errors <= 15) addLog('err', `orphan ${rel}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Mode: adopt — give matched orphans a filings row
// ---------------------------------------------------------------------------

/**
 * Walks the orphan index and adopts everything that has a resolved company.
 * Orphans without an analysis sidecar are skipped unless allowUnanalyzed, and
 * content-hash keys never match, so this only ever touches the pipeline-shaped
 * TICKER/… population.
 */
async function runAdopt() {
  const orphans = await orphanIndex.getIndex({ force: true });
  const targets = orphans.filter((o) => (state.onlyMatched ? !!o.company : true));

  state.total = targets.length;
  addLog('info', `${orphans.length} orphan(s); ${targets.length} with a matched company`);
  if (targets.length === 0) return;

  for (const orphan of targets) {
    if (state.stopRequested) break;
    state.processed++;

    if (!orphan.company) {
      state.skipped++;
      continue;
    }
    if (!orphan.hasAnalysis && !state.allowUnanalyzed) {
      state.skipped++;
      continue;
    }

    if (state.dryRun) {
      state.adopted++;
      continue;
    }

    try {
      const res = await orphanIndex.adoptOrphan(orphan, {
        allowUnanalyzed: state.allowUnanalyzed,
      });
      if (res.adopted) {
        state.adopted++;
        if (state.adopted % 250 === 0) addLog('info', `${state.adopted} adopted`);
      } else {
        state.skipped++;
        if (state.skipped <= 15) addLog('warn', `${orphan.key}: ${res.reason}${res.error ? ` — ${res.error}` : ''}`);
      }
    } catch (err) {
      state.errors++;
      if (state.errors <= 15) addLog('err', `${orphan.key}: ${err.message}`);
    }
  }

  orphanIndex.invalidate();
}

// ---------------------------------------------------------------------------
// Mode: purge — delete orphan copies from S3 and/or disk
// ---------------------------------------------------------------------------

/**
 * Deletes orphans in chunks so progress is visible and a stop lands promptly.
 *
 * purgeTarget 'unmatched' (the default) spares anything that resolved to a
 * company, so the legacy content-hash corpus can be cleared without risking
 * files that are still adoptable. 'all' is the explicit everything-goes option.
 */
async function runPurge() {
  const orphans = await orphanIndex.getIndex({ force: true });
  const targets = orphans.filter((o) => {
    if (state.purgeTarget !== 'all' && o.company) return false;
    if (state.scope === 's3' && !o.inS3) return false;
    if (state.scope === 'disk' && !o.onDisk) return false;
    return true;
  });

  state.total = targets.length;
  addLog('info', `${targets.length} ${state.purgeTarget} orphan(s) to delete from ${state.scope}`);
  if (targets.length === 0) return;

  if (state.dryRun) {
    state.processed = targets.length;
    state.pruned = targets.length;
    state.freedBytes = targets.reduce((s, o) => s + (o.size || 0), 0);
    return;
  }

  const CHUNK = 500;
  for (let i = 0; i < targets.length; i += CHUNK) {
    if (state.stopRequested) break;
    const chunk = targets.slice(i, i + CHUNK);
    try {
      const res = await orphanIndex.deleteOrphans(chunk.map((o) => o.key), { scope: state.scope });
      state.processed += chunk.length;
      state.pruned += Math.max(res.deletedS3, res.deletedDisk);
      state.freedBytes += res.freedBytes
        + chunk.reduce((s, o) => s + (o.inS3 && state.scope !== 'disk' ? (o.size || 0) : 0), 0);
      state.skipped += res.skippedReferenced;
      state.errors += res.errors.length;
      for (const e of res.errors.slice(0, 5)) addLog('err', `${e.key}: ${e.message}`);
      addLog('info', `${state.pruned} deleted (${fmtBytes(state.freedBytes)})`);
    } catch (err) {
      state.errors += chunk.length;
      addLog('err', `chunk at ${i}: ${err.message}`);
    }
  }

  orphanIndex.invalidate();
}

// ---------------------------------------------------------------------------

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

const SUMMARY = {
  upload: () => `${state.uploaded} uploaded (${fmtBytes(state.uploadedBytes)})`,
  prune: () => `${state.pruned} local copies removed (${fmtBytes(state.freedBytes)} freed)`,
  adopt: () => `${state.adopted} orphan(s) adopted, ${state.skipped} skipped`,
  purge: () => `${state.pruned} orphan(s) deleted (${fmtBytes(state.freedBytes)} freed)`,
};

async function runLoop() {
  try {
    if (state.mode === 'upload') await runUpload();
    else if (state.mode === 'adopt') await runAdopt();
    else if (state.mode === 'purge') await runPurge();
    else await runPrune();

    state.status = state.stopRequested ? 'stopped' : 'done';
    const summary = (SUMMARY[state.mode] || SUMMARY.prune)();
    addLog('info', `${state.dryRun ? '[dry run] ' : ''}Finished — ${summary}`);
  } catch (err) {
    state.status = 'error';
    state.lastError = err.message;
    addLog('err', `Fatal: ${err.message}`);
  } finally {
    state.finishedAt = Date.now();
  }
}

const MODES = ['upload', 'prune', 'adopt', 'purge'];

function startMigration({
  mode = 'prune',
  dryRun = false,
  includeOrphans = false,
  scope = 'both',
  onlyMatched = true,
  purgeTarget = 'unmatched',
  allowUnanalyzed = false,
} = {}) {
  if (state.status === 'running') {
    return { started: false, reason: 'already_running', status: getStatus() };
  }
  if (!MODES.includes(mode)) {
    return { started: false, reason: 'invalid_mode', status: getStatus() };
  }
  if (!isStorageEnabled()) {
    return { started: false, reason: 'storage_disabled', status: getStatus() };
  }

  Object.assign(state, {
    status: 'running',
    mode,
    dryRun: !!dryRun,
    includeOrphans: mode === 'prune' && !!includeOrphans,
    scope: ['s3', 'disk', 'both'].includes(scope) ? scope : 'both',
    onlyMatched: !!onlyMatched,
    purgeTarget: purgeTarget === 'all' ? 'all' : 'unmatched',
    allowUnanalyzed: !!allowUnanalyzed,
    total: 0,
    processed: 0,
    uploaded: 0,
    pruned: 0,
    adopted: 0,
    skipped: 0,
    mismatched: 0,
    errors: 0,
    uploadedBytes: 0,
    freedBytes: 0,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null,
    stopRequested: false,
    log: [],
  });

  const detail = mode === 'purge'
    ? ` (${state.purgeTarget} orphans, ${state.scope})`
    : (state.includeOrphans ? ' + orphans' : '');
  addLog('info', `Started ${mode}${state.dryRun ? ' (dry run)' : ''}${detail}`);
  // Fire and forget — progress lives in `state`, polled via getStatus().
  runLoop();
  return { started: true, status: getStatus() };
}

/** Graceful stop — the loop finishes the current file then exits. */
function stopMigration() {
  if (state.status === 'running') {
    state.stopRequested = true;
    addLog('warn', 'Stop requested — finishing current file');
    return { stopping: true, status: getStatus() };
  }
  return { stopping: false, status: getStatus() };
}

module.exports = {
  startMigration,
  stopMigration,
  getStatus,
  scanLocalDisk,
  DOWNLOADS_DIR,
};
