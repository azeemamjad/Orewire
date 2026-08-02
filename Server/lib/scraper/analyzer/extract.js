/**
 * PDF text extraction via unpdf (modern PDF.js), with OCR fallback for
 * image-only / poorly extracted documents.
 */
const fs = require('fs');
const { ocrPdfText } = require('./ocr');
const { MIN_EXTRACT_CHARS, OCR_MAX_PAGES } = require('./constants');

/** Soft density gate: sparse text layers often mean scanned pages with a tiny caption. */
const MIN_CHARS_PER_PAGE = 40;

let _extractText;
let _getDocumentProxy;

async function loadUnpdf() {
  if (_extractText) return;
  // unpdf is ESM — load via dynamic import from CJS.
  const mod = await import('unpdf');
  _extractText = mod.extractText;
  _getDocumentProxy = mod.getDocumentProxy;
}

/**
 * Extract text with page stats using unpdf.
 * @returns {{ text: string, pages: number, charsPerPage: number }}
 */
async function extractTextUnpdf(pdfPath) {
  await loadUnpdf();
  const buffer = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await _getDocumentProxy(buffer);
  try {
    const result = await _extractText(pdf, { mergePages: true });
    const pages = Number(result.totalPages) || pdf.numPages || 1;
    const text = typeof result.text === 'string'
      ? result.text
      : Array.isArray(result.text)
        ? result.text.join('\n\n')
        : '';
    const trimmed = (text || '').replace(/\u0000/g, '');
    return {
      text: trimmed,
      pages,
      charsPerPage: trimmed.trim().length / Math.max(pages, 1),
    };
  } finally {
    try { await pdf.destroy?.(); } catch { /* ignore */ }
  }
}

function needsOcr({ text, charsPerPage }) {
  const len = (text || '').trim().length;
  if (len < MIN_EXTRACT_CHARS) return true;
  // Dense enough overall but suspiciously empty per page → likely scanned.
  if (charsPerPage < MIN_CHARS_PER_PAGE && len < MIN_EXTRACT_CHARS * 8) return true;
  return false;
}

/**
 * Extract text; OCR when the text layer is empty/sparse.
 * @returns {{ text: string, usedOcr: boolean, pages?: number }}
 */
async function extractTextWithFallback(pdfPath) {
  let text = '';
  let usedOcr = false;
  let pages;
  let charsPerPage = 0;

  try {
    const extracted = await extractTextUnpdf(pdfPath);
    text = extracted.text || '';
    pages = extracted.pages;
    charsPerPage = extracted.charsPerPage;
  } catch (err) {
    console.warn(`  [AI] unpdf extract failed (${err.message}) — trying OCR…`);
  }

  if (needsOcr({ text, charsPerPage })) {
    console.warn(
      `  [AI] Weak text layer (${text.trim().length} chars`
      + (pages ? `, ~${Math.round(charsPerPage)}/page` : '')
      + ') — attempting OCR…',
    );
    const ocrText = await ocrPdfText(pdfPath, { maxPages: OCR_MAX_PAGES });
    if (ocrText.trim().length >= MIN_EXTRACT_CHARS) {
      // Prefer OCR when it recovered meaningfully more text; otherwise keep text layer.
      if (ocrText.trim().length > text.trim().length) {
        text = ocrText;
        usedOcr = true;
        console.log(`  [AI] OCR recovered ${text.trim().length} characters`);
      }
    } else if (!text.trim()) {
      text = ocrText || '';
      usedOcr = !!ocrText.trim();
    }
  }

  return { text, usedOcr, pages };
}

/** Back-compat: return plain string (used by scripts). */
async function extractText(pdfPath) {
  const { text } = await extractTextWithFallback(pdfPath);
  return text;
}

module.exports = {
  extractText,
  extractTextWithFallback,
  extractTextUnpdf,
  needsOcr,
};
