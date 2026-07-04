const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { OCR_MAX_PAGES } = require('./constants');

const execFileAsync = promisify(execFile);

function which(cmd) {
  return execFileAsync('which', [cmd])
    .then((r) => (r.stdout || '').trim())
    .catch(() => '');
}

/**
 * OCR image-only PDFs via pdftoppm + tesseract when available.
 * Returns concatenated text or '' if tools missing / OCR fails.
 */
async function ocrPdfText(pdfPath, { maxPages = OCR_MAX_PAGES } = {}) {
  const pdftoppm = await which('pdftoppm');
  const tesseract = await which('tesseract');
  if (!pdftoppm || !tesseract) {
    console.warn('  [OCR] pdftoppm or tesseract not installed — skipping OCR fallback');
    return '';
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orewire-ocr-'));
  const prefix = path.join(tmpDir, 'page');

  try {
    await execFileAsync(pdftoppm, [
      '-png',
      '-f', '1',
      '-l', String(maxPages),
      '-r', '200',
      pdfPath,
      prefix,
    ], { timeout: 120_000 });

    const pages = fs.readdirSync(tmpDir)
      .filter((f) => f.endsWith('.png'))
      .sort();

    if (!pages.length) return '';

    const chunks = [];
    for (const page of pages) {
      const imgPath = path.join(tmpDir, page);
      try {
        const { stdout } = await execFileAsync(
          tesseract,
          [imgPath, 'stdout', '-l', 'eng', '--psm', '6'],
          { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
        );
        const text = (stdout || '').trim();
        if (text) chunks.push(text);
      } catch (err) {
        console.warn(`  [OCR] page ${page} failed:`, err.message);
      }
    }
    return chunks.join('\n\n');
  } catch (err) {
    console.warn('  [OCR] fallback failed:', err.message);
    return '';
  } finally {
    try {
      for (const f of fs.readdirSync(tmpDir)) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
      fs.rmdirSync(tmpDir);
    } catch { /* ignore */ }
  }
}

module.exports = { ocrPdfText };
