// One-off backfill: clean news.description rows that stored raw, entity-escaped
// HTML (e.g. "&lt;a href=...&gt;Title&lt;/a&gt;...") from Google News RSS before
// the scraper was fixed to decode + strip them. Re-runs are safe/idempotent.
//
//   node scripts/backfill-news-descriptions.js          (dry run, shows samples)
//   node scripts/backfill-news-descriptions.js --apply  (writes changes)

require('dotenv').config();
const db = require('../db');
const { cleanRssText } = require('../lib/news-fetch');

const APPLY = process.argv.includes('--apply');

async function main() {
  // Rows whose description still carries escaped or literal HTML markup.
  const { rows } = await db.query(
    `SELECT id, description FROM news
     WHERE description IS NOT NULL
       AND (description LIKE '%&lt;%' OR description LIKE '%&amp;%' OR description ~ '<[a-zA-Z/]')`
  );

  console.log(`Found ${rows.length} candidate rows with HTML in description.`);

  let changed = 0;
  let samplesShown = 0;
  for (const row of rows) {
    const cleaned = cleanRssText(row.description);
    if (cleaned === row.description) continue;
    changed++;

    if (samplesShown < 5) {
      console.log(`\n[${row.id}]`);
      console.log(`  before: ${row.description.slice(0, 160)}`);
      console.log(`  after : ${cleaned.slice(0, 160)}`);
      samplesShown++;
    }

    if (APPLY) {
      await db.query(`UPDATE news SET description = $1 WHERE id = $2`, [cleaned.slice(0, 500), row.id]);
    }
  }

  console.log(
    `\n${APPLY ? 'Updated' : 'Would update'} ${changed} rows.` +
      (APPLY ? '' : '  Re-run with --apply to write changes.')
  );
  await db.end?.();
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exit(1);
});
