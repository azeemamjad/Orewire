/**
 * A record of documents already fetched, so a re-run never pays for the same
 * bytes twice.
 *
 * Why a ledger and not a file-existence check:
 *   - The saved filename comes from the response's Content-Disposition, which is
 *     only known *after* the download — too late to avoid the cost.
 *   - Local PDFs are pruned once they reach S3 (scripts/prune-migrated-local-pdfs.js),
 *     so "file is gone" does not mean "we still need it".
 *   - SEDAR+ document URLs are session-bound (`drr=`/`id=` are session tokens,
 *     identical across every row), so the href is useless as an identity.
 *
 * The key is what the results table shows *before* the fetch: issuer, document
 * name, and the submitted timestamp. That triple is stable across sessions and
 * unique per filing — two documents can share a name, but not a name and a
 * to-the-second submission time.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_ROOT } = require('../paths');

const LEDGER_FILE = path.resolve(
  process.env.DOWNLOAD_LEDGER_FILE || path.join(SERVER_ROOT, 'data/download-ledger.jsonl'),
);

let _keys = null;

function ledgerEnabled() {
  return process.env.DOWNLOAD_LEDGER !== 'false';
}

function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * @param {{ source: string, company: string, doc: string, submitted: string }} row
 */
function keyFor({ source, company, doc, submitted }) {
  const material = [source, company, doc, submitted].map(normalize).join('|');
  return crypto.createHash('sha1').update(material).digest('hex').slice(0, 16);
}

function load() {
  if (_keys) return _keys;
  _keys = new Map();
  try {
    if (!fs.existsSync(LEDGER_FILE)) return _keys;
    const text = fs.readFileSync(LEDGER_FILE, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.key) _keys.set(rec.key, rec);
      } catch {
        /* a torn last line from a hard kill — skip it, don't fail the run */
      }
    }
  } catch (err) {
    console.warn(`[Ledger] Could not read ${LEDGER_FILE}: ${err.message} — treating everything as new`);
  }
  return _keys;
}

function has(key) {
  if (!ledgerEnabled()) return false;
  return load().has(key);
}

function get(key) {
  return load().get(key) || null;
}

/** Append-only: a crash mid-run still keeps everything already fetched. */
function add(record) {
  if (!ledgerEnabled()) return;
  const keys = load();
  if (keys.has(record.key)) return;
  keys.set(record.key, record);
  try {
    fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
    fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(record)}\n`);
  } catch (err) {
    console.warn(`[Ledger] Could not append to ${LEDGER_FILE}: ${err.message}`);
  }
}

/** "129 KB" / "1.2 MB" from the results table → bytes, for savings accounting. */
function parseSize(text) {
  const m = String(text || '').match(/([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit] || 1;
  return Math.round(n * mult);
}

function stats() {
  const keys = load();
  return { entries: keys.size, file: LEDGER_FILE, enabled: ledgerEnabled() };
}

/** Test/maintenance helper — drops the in-memory cache so the file is re-read. */
function reload() {
  _keys = null;
  return load();
}

module.exports = { keyFor, has, get, add, parseSize, stats, reload, LEDGER_FILE, ledgerEnabled };
