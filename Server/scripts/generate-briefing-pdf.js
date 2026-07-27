#!/usr/bin/env node
/**
 * Generate today’s morning briefing as a PDF to share with a client.
 *
 * Usage:
 *   node scripts/generate-briefing-pdf.js
 *   node scripts/generate-briefing-pdf.js --out ./client-briefing.pdf
 *   npm run briefing:pdf
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path = require('path');
const { writeBriefingPdf, defaultOutPath } = require('../lib/briefing/pdf');

function parseOutArg(argv) {
  const i = argv.indexOf('--out');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  const eq = argv.find((a) => a.startsWith('--out='));
  if (eq) return path.resolve(eq.slice('--out='.length));
  return defaultOutPath();
}

(async () => {
  try {
    const out = parseOutArg(process.argv.slice(2));
    console.log('[briefing:pdf] Building morning briefing PDF…');
    const result = await writeBriefingPdf(out);
    console.log(`[briefing:pdf] Wrote ${result.bytes} bytes`);
    console.log(result.path);
    process.exit(0);
  } catch (err) {
    console.error('[briefing:pdf] Failed:', err?.message || err);
    if (err?.message && /Executable doesn't exist|browserType\.launch/i.test(String(err.message))) {
      console.error('[briefing:pdf] Tip: run `npx playwright install chromium` in Server/');
    }
    process.exit(1);
  }
})();
