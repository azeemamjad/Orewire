#!/usr/bin/env node
/**
 * Test DeepSeek API key, upsert as default provider, analyze 2–3 random filings.
 *
 *   DEEPSEEK_API_KEY=sk-... node scripts/setup-deepseek-and-sample.js
 *   DEEPSEEK_API_KEY=sk-... node scripts/setup-deepseek-and-sample.js --count 3
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const migrate = require('../db/migrate');
const {
  upsertProviderByType,
  setDefaultProvider,
  invalidateProviderCache,
  getActiveProvider,
} = require('../lib/ai/ollama-store');
const { chatWithSystem } = require('../lib/ai/client');
const { analyzePdf } = require('../lib/scraper/analyzer');
const {
  isRemoteStoragePath,
  parseStoragePath,
  getObjectStream,
  isStorageEnabled,
} = require('../lib/infra/object-storage');

const HOST = 'https://api.deepseek.com';
const MODEL = 'deepseek-v4-flash';

function argCount() {
  const i = process.argv.indexOf('--count');
  if (i >= 0) return Math.max(2, Math.min(5, parseInt(process.argv[i + 1], 10) || 3));
  return 3;
}

async function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const r = await db.query(
    `SELECT api_key FROM ai_providers WHERE provider = 'deepseek' AND api_key IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  return r.rows[0]?.api_key || '';
}

async function testDeepSeekKey(apiKey) {
  const res = await fetch(`${HOST}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      thinking: { type: 'disabled' },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek key test failed HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`DeepSeek key test: non-JSON response: ${text.slice(0, 200)}`);
  }
  const content = (data.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('DeepSeek key test: empty content');
  return { content, model: data.model || MODEL };
}

async function downloadToTemp(filing) {
  const pdfPath = filing.pdf_path;
  if (!isRemoteStoragePath(pdfPath)) {
    if (fs.existsSync(pdfPath)) return { localPath: pdfPath, cleanup: false };
    throw new Error(`Local PDF missing: ${pdfPath}`);
  }
  if (!isStorageEnabled()) {
    throw new Error('AWS S3 not enabled — cannot download remote PDFs');
  }
  const key = parseStoragePath(pdfPath);
  if (!key) throw new Error(`Cannot parse storage path: ${pdfPath}`);

  const tmp = path.join(os.tmpdir(), `orewire_ds_${filing.id}_${Date.now()}.pdf`);
  const stream = await getObjectStream(key);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    stream.pipe(out);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
  return { localPath: tmp, cleanup: true };
}

async function main() {
  await migrate();

  const API_KEY = await resolveApiKey();
  if (!API_KEY) {
    console.error('Set DEEPSEEK_API_KEY or save a DeepSeek provider in Admin → AI');
    process.exit(1);
  }

  process.stderr.write('[deepseek] Testing API key…\n');
  const test = await testDeepSeekKey(API_KEY);
  process.stderr.write(`[deepseek] Key OK — model=${test.model} reply=${JSON.stringify(test.content)}\n`);

  process.stderr.write('[deepseek] Upserting provider as default…\n');
  const row = await upsertProviderByType({
    name: 'DeepSeek',
    provider: 'deepseek',
    host: HOST,
    api_key: API_KEY,
    default_model: MODEL,
    enabled: true,
    is_default: true,
  });
  await setDefaultProvider(row.id);
  invalidateProviderCache();

  const active = await getActiveProvider();
  process.stderr.write(
    `[deepseek] Active provider: id=${active.id} type=${active.provider} model=${active.default_model} default=${active.is_default}\n`,
  );

  const ping = await chatWithSystem({
    feature: 'admin_test',
    system: 'Reply with exactly: OK',
    user: 'Say OK',
  });
  process.stderr.write(`[deepseek] Active chat OK — ${ping.model} (${ping.durationMs}ms)\n`);

  const count = argCount();
  const { rows: filings } = await db.query(
    `SELECT id, company_name, pdf_path, pdf_filename, exchange
       FROM filings
      WHERE pdf_path IS NOT NULL AND pdf_path <> ''
      ORDER BY random()
      LIMIT $1`,
    [count],
  );

  if (!filings.length) {
    throw new Error('No filings with pdf_path found');
  }

  const results = [];
  for (const filing of filings) {
    process.stderr.write(`[deepseek] Analyzing filing #${filing.id} ${filing.pdf_filename || ''}…\n`);
    let local = null;
    try {
      local = await downloadToTemp(filing);
      const analysis = await analyzePdf(local.localPath, {
        companyName: filing.company_name,
        exchange: filing.exchange,
      });
      results.push({
        filingId: filing.id,
        companyName: filing.company_name,
        pdfFilename: filing.pdf_filename,
        model: MODEL,
        provider: 'deepseek',
        analysis,
      });
    } catch (err) {
      results.push({
        filingId: filing.id,
        companyName: filing.company_name,
        pdfFilename: filing.pdf_filename,
        model: MODEL,
        provider: 'deepseek',
        error: err.message || String(err),
      });
    } finally {
      if (local?.cleanup && local.localPath && fs.existsSync(local.localPath)) {
        try { fs.unlinkSync(local.localPath); } catch { /* ignore */ }
      }
    }
  }

  // JSON only on stdout for easy capture
  console.log(JSON.stringify(results, null, 2));
  await db.end();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
