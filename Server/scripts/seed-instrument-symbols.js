#!/usr/bin/env node
/**
 * Seed instrument_symbols from companies + market payloads (if table is empty).
 *   node scripts/seed-instrument-symbols.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../db');
const { seedInstrumentSymbolsIfEmpty } = require('../lib/market/instrument-symbols-store');

async function main() {
  const result = await seedInstrumentSymbolsIfEmpty();
  if (result.seeded) {
    console.log('[seed] instrument_symbols populated');
  } else {
    console.log('[seed] instrument_symbols already has rows — skipped');
  }
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
