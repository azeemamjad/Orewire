#!/usr/bin/env node
/**
 * Normalize AI-tell punctuation (em/en dashes, smart quotes, ellipses) in prose
 * that was stored before sanitizeProse was applied at write time.
 *
 * Writes a JSON backup of every original value before touching anything.
 *
 * Usage:
 *   node scripts/backfill-prose-dashes.js              # dry run, reports counts
 *   node scripts/backfill-prose-dashes.js --apply      # perform the update
 *   node scripts/backfill-prose-dashes.js --restore <backup.json>
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { sanitizeProse } = require('../lib/text/sanitize-prose');

const DASH_RE = /[—–―‒]/;

// news_releases.title is publisher-supplied, not model output, so it is left alone.
const TARGETS = [
  {
    table: 'ai_output',
    key: 'filing_id',
    text: ['summary', 'verdict_reason', 'ticker_summary', 'context', 'grade_commentary', 'what_to_watch'],
    json: ['key_facts'],
  },
  {
    table: 'news_releases',
    key: 'id',
    text: ['summary'],
    json: [],
  },
];

function cleanJsonValue(value) {
  if (typeof value === 'string') return sanitizeProse(value);
  if (Array.isArray(value)) return value.map(cleanJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanJsonValue(v)]));
  }
  return value;
}

async function collect(target) {
  const cols = [...target.text, ...target.json];
  const where = cols.map((c) => `${c}::text ~ '[—–―‒]'`).join(' OR ');
  const r = await db.query(
    `SELECT ${target.key}, ${cols.join(', ')} FROM ${target.table} WHERE ${where}`,
  );

  const changes = [];
  for (const row of r.rows) {
    const before = {};
    const after = {};
    for (const c of target.text) {
      if (typeof row[c] === 'string' && DASH_RE.test(row[c])) {
        const cleaned = sanitizeProse(row[c]);
        if (cleaned !== row[c]) { before[c] = row[c]; after[c] = cleaned; }
      }
    }
    for (const c of target.json) {
      if (row[c] == null) continue;
      const cleaned = cleanJsonValue(row[c]);
      if (JSON.stringify(cleaned) !== JSON.stringify(row[c])) {
        before[c] = row[c]; after[c] = cleaned;
      }
    }
    if (Object.keys(after).length) {
      changes.push({ key: row[target.key], before, after });
    }
  }
  return changes;
}

async function apply(target, changes) {
  for (const ch of changes) {
    const cols = Object.keys(ch.after);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const vals = cols.map((c) => (target.json.includes(c) ? JSON.stringify(ch.after[c]) : ch.after[c]));
    await db.query(
      `UPDATE ${target.table} SET ${sets} WHERE ${target.key} = $1`,
      [ch.key, ...vals],
    );
  }
}

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.query('BEGIN');
  try {
    for (const entry of backup.targets) {
      const target = TARGETS.find((t) => t.table === entry.table);
      for (const ch of entry.changes) {
        const cols = Object.keys(ch.before);
        const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        const vals = cols.map((c) => (target.json.includes(c) ? JSON.stringify(ch.before[c]) : ch.before[c]));
        await db.query(`UPDATE ${target.table} SET ${sets} WHERE ${target.key} = $1`, [ch.key, ...vals]);
      }
      console.log(`[restore] ${entry.table}: ${entry.changes.length} row(s)`);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

(async () => {
  const args = process.argv.slice(2);
  const restoreIdx = args.indexOf('--restore');
  if (restoreIdx !== -1) {
    await restore(args[restoreIdx + 1]);
    process.exit(0);
  }

  const shouldApply = args.includes('--apply');
  const targets = [];

  for (const target of TARGETS) {
    const changes = await collect(target);
    targets.push({ table: target.table, key: target.key, changes });
    const fields = {};
    for (const ch of changes) for (const c of Object.keys(ch.after)) fields[c] = (fields[c] || 0) + 1;
    console.log(`${target.table}: ${changes.length} row(s)`, JSON.stringify(fields));
  }

  const total = targets.reduce((n, t) => n + t.changes.length, 0);
  if (!total) { console.log('Nothing to do.'); process.exit(0); }

  const backupFile = path.join(__dirname, '..', 'tmp', `prose-dashes-backup-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  fs.writeFileSync(backupFile, JSON.stringify({ targets }, null, 1));
  console.log('backup written:', backupFile);

  if (!shouldApply) {
    const sample = targets.flatMap((t) => t.changes).slice(0, 3);
    for (const ch of sample) {
      const col = Object.keys(ch.after)[0];
      console.log(`\n  ${col} #${ch.key}`);
      console.log('   before:', String(JSON.stringify(ch.before[col])).slice(0, 160));
      console.log('   after :', String(JSON.stringify(ch.after[col])).slice(0, 160));
    }
    console.log(`\nDry run. Re-run with --apply to update ${total} row(s).`);
    process.exit(0);
  }

  await db.query('BEGIN');
  try {
    for (let i = 0; i < TARGETS.length; i++) await apply(TARGETS[i], targets[i].changes);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('rolled back:', err.message);
    process.exit(1);
  }
  console.log(`Updated ${total} row(s). Restore with: node scripts/backfill-prose-dashes.js --restore ${backupFile}`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
