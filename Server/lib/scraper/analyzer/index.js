require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const pdfParse = require('pdf-parse');

const { SYSTEM_PROMPT, buildUserPrompt } = require('./prompt');
const { chatWithSystem } = require('../../ai/client');

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data   = await pdfParse(buffer);
  return data.text || '';
}

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

function parseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Analyze a single PDF
// ---------------------------------------------------------------------------

async function analyzePdf(pdfPath, meta = {}) {
  console.log(`  [AI] Extracting text from ${path.basename(pdfPath)}…`);
  const text = await extractText(pdfPath);

  if (!text.trim()) {
    console.warn('  [AI] Warning: no text extracted (scanned image PDF?)');
  }

  const userPrompt = buildUserPrompt(meta, text);

  console.log(`  [AI] Sending to Ollama…`);
  const { content: raw } = await chatWithSystem({
    feature: 'filing_analysis',
    system: SYSTEM_PROMPT,
    user: userPrompt,
  });
  const analysis = parseJson(raw);

  return analysis;
}

// ---------------------------------------------------------------------------
// Analyze every PDF in a directory
// ---------------------------------------------------------------------------

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

    // Skip if already analyzed
    if (fs.existsSync(outPath)) {
      console.log(`  [AI] Skipping ${file} (analysis exists)`);
      results.push({ file, skipped: true });
      continue;
    }

    try {
      const analysis = await analyzePdf(pdfPath, meta);
      fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));
      console.log(`  ✓ ${file} → verdict: ${analysis.verdict}`);
      results.push({ file, analysis });
    } catch (err) {
      console.error(`  ✗ Failed (${file}): ${err.message}`);
      results.push({ file, error: err.message });
    }
  }

  return results;
}

module.exports = { analyzePdf, analyzeDirectory, extractText };
