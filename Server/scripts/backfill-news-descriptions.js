// One-off backfill: clean news_releases.description rows that stored raw, entity-escaped HTML.
//
//   node scripts/backfill-news-descriptions.js

require('dotenv').config();
const db = require('../db');
const { cleanRssText } = require('../lib/news-fetch');
const { TABLE_RELEASES } = require('../lib/news-db');

async function main() {
  const r = await db.query(
    `SELECT id, description FROM ${TABLE_RELEASES}
      WHERE description IS NOT NULL AND description <> ''
      ORDER BY id ASC`,
  );

  let updated = 0;
  for (const row of r.rows) {
    const cleaned = cleanRssText(row.description);
    if (!cleaned || cleaned === row.description) continue;
    await db.query(`UPDATE ${TABLE_RELEASES} SET description = $1 WHERE id = $2`, [cleaned.slice(0, 500), row.id]);
    updated++;
  }

  console.log(`Updated ${updated} of ${r.rows.length} descriptions`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
