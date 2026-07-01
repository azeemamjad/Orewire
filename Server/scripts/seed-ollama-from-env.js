#!/usr/bin/env node
/**
 * One-time seed: reads OLLAMA_* from .env into ai_providers, then remove those vars.
 *   node scripts/seed-ollama-from-env.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../db');
const { stripTrailingSlash } = require('../lib/ai/ollama-store');

async function main() {
  const existing = await db.query(
    `SELECT COUNT(*)::int AS n FROM ai_providers WHERE provider = 'ollama'`,
  );
  if ((existing.rows[0]?.n || 0) > 0) {
    console.log('[seed] ai_providers already has an Ollama row — skipping');
    await db.end();
    return;
  }

  const host = process.env.OLLAMA_HOST || 'https://ollama.com';
  const apiKey = process.env.OLLAMA_API_KEY;
  const model = process.env.OLLAMA_MODEL || 'kimi';

  if (!apiKey) {
    console.error('[seed] OLLAMA_API_KEY required in .env');
    process.exit(1);
  }

  await db.query(
    `INSERT INTO ai_providers (name, provider, host, api_key, default_model, enabled)
     VALUES ($1, 'ollama', $2, $3, $4, TRUE)`,
    ['Ollama Cloud', stripTrailingSlash(host), apiKey, model],
  );

  console.log(`[seed] + Ollama provider (${stripTrailingSlash(host)}, model=${model})`);
  console.log('\n[seed] Done. Remove OLLAMA_HOST / OLLAMA_API_KEY / OLLAMA_MODEL from .env and restart.');
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
