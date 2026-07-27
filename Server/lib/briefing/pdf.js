/**
 * Morning briefing → PDF (Playwright Chromium).
 * Shared client PDF: global briefing only (no per-user watchlist).
 */

const fs = require('fs');
const path = require('path');
const { buildGlobalBriefingData } = require('./data');
const { renderDailyBriefing } = require('../email-templates/daily-briefing');

function briefingDateStamp(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); // YYYY-MM-DD
}

function defaultOutPath() {
  return path.join(__dirname, '../../tmp', `morning-briefing-${briefingDateStamp()}.pdf`);
}

/** Wrap email HTML so Chromium prints cleanly on Letter. */
function pdfDocumentHtml(emailHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OreWire Morning Briefing</title>
  <style>
    @page { size: Letter; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { padding: 12px 0; }
    a { color: inherit; }
  </style>
</head>
<body>
${emailHtml}
</body>
</html>`;
}

/**
 * @param {object} [data] — optional prebuilt briefing data
 * @returns {Promise<Buffer>}
 */
async function generateBriefingPdfBuffer(data) {
  const briefing = data || (await buildGlobalBriefingData());
  const emailHtml = renderDailyBriefing(
    { ...briefing, watchlistFilings: [], watchlistCount: 0 },
    { userId: null },
  );
  const html = pdfDocumentHtml(emailHtml);

  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.45in', bottom: '0.5in', left: '0.45in' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Write morning briefing PDF to disk.
 * @param {string} [outPath]
 * @param {object} [data]
 * @returns {Promise<{ path: string, bytes: number }>}
 */
async function writeBriefingPdf(outPath, data) {
  const dest = path.resolve(outPath || defaultOutPath());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = await generateBriefingPdfBuffer(data);
  fs.writeFileSync(dest, buf);
  return { path: dest, bytes: buf.length };
}

module.exports = {
  briefingDateStamp,
  defaultOutPath,
  generateBriefingPdfBuffer,
  writeBriefingPdf,
};
