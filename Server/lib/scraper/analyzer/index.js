require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const pdfParse = require('pdf-parse');

const { SYSTEM_PROMPT, buildUserPrompt } = require('./prompt');
const { chatWithSystem } = require('../../ai/client');
const { ocrPdfText } = require('./ocr');
const { validateAnalysis } = require('./validate');
const {
  MIN_EXTRACT_CHARS,
  extractionFailedAnalysis,
  isExtractionFailed,
} = require('./constants');

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data   = await pdfParse(buffer);
  return data.text || '';
}

function parseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Extract text; OCR if the text layer is empty/near-empty.
 * @returns {{ text: string, usedOcr: boolean }}
 */
async function extractTextWithFallback(pdfPath) {
  let text = await extractText(pdfPath);
  let usedOcr = false;

  if (text.trim().length < MIN_EXTRACT_CHARS) {
    console.warn('  [AI] Warning: no text layer — attempting OCR…');
    const ocrText = await ocrPdfText(pdfPath);
    if (ocrText.trim().length >= MIN_EXTRACT_CHARS) {
      text = ocrText;
      usedOcr = true;
      console.log(`  [AI] OCR recovered ${text.trim().length} characters`);
    }
  }

  return { text, usedOcr };
}

/**
 * Analyze a single PDF. Never calls the LLM on empty/near-empty text.
 */
async function analyzePdf(pdfPath, meta = {}, { model } = {}) {
  console.log(`  [AI] Extracting text from ${path.basename(pdfPath)}…`);
  const { text, usedOcr } = await extractTextWithFallback(pdfPath);
  const textLength = text.trim().length;

  if (textLength < MIN_EXTRACT_CHARS) {
    console.warn('  [AI] Extraction failed — skipping LLM');
    return extractionFailedAnalysis(
      usedOcr
        ? 'OCR did not recover readable text from this PDF.'
        : 'PDF has no extractable text layer (image-only or corrupt).',
    );
  }

  const userPrompt = buildUserPrompt(meta, text);

  console.log(`  [AI] Sending to AI${model ? ` (${model})` : ''}…`);
  const { content: raw } = await chatWithSystem({
    feature: 'filing_analysis',
    system: SYSTEM_PROMPT,
    user: userPrompt,
    model,
  });

  let analysis;
  try {
    analysis = parseJson(raw);
  } catch (err) {
    console.error('  [AI] Invalid JSON from model:', err.message);
    return extractionFailedAnalysis('Model returned invalid JSON');
  }

  return validateAnalysis(analysis, { textLength });
}

async function analyzeDirectory(dirPath, meta = {}) {
  if (!fs.existsSync(dirPath)) {
    console.log('[ANALYZER] Directory not found:', dirPath);
    return [];
  }
  const files = fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith('.pdf'));

  if (files.length === 0) {
    console.log('[ANALYZER] No PDF files found in', dirPath);
    return [];
  }

  console.log(`[ANALYZER] Analyzing ${files.length} file(s) in ${dirPath}`);
  const results = [];

  for (const file of files) {
    const pdfPath  = path.join(dirPath, file);
    const outPath  = path.join(dirPath, file.replace(/\.pdf$/i, '_analysis.json'));

    if (fs.existsSync(outPath)) {
      console.log(`  [AI] Skipping ${file} (analysis exists)`);
      results.push({ file, skipped: true });
      continue;
    }

    try {
      const analysis = await analyzePdf(pdfPath, meta);
      fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));
      console.log(`  ✓ ${file} → verdict: ${analysis.verdict}`);
      results.push({ file, analysis, failed: isExtractionFailed(analysis) });
    } catch (err) {
      console.error(`  ✗ Failed (${file}): ${err.message}`);
      results.push({ file, error: err.message });
    }
  }

  return results;
}

module.exports = {
  analyzePdf,
  analyzeDirectory,
  extractText,
  extractTextWithFallback,
  isExtractionFailed,
};
