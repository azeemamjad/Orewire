require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const pdfParse = require('pdf-parse');

const { SYSTEM_PROMPT, buildUserPrompt } = require('./prompt');

// ---------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data   = await pdfParse(buffer);
  return data.text || '';
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function callOllama(userPrompt) {
  const base   = process.env.OLLAMA_HOST  || 'https://ollama.com';
  const model  = process.env.OLLAMA_MODEL || 'kimi';
  const apiKey = process.env.OLLAMA_API_KEY;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.message?.content || '';
}

// ---------------------------------------------------------------------------
// JSON parsing — strips markdown code fences if present
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

  const model = process.env.OLLAMA_MODEL || 'kimi';
  console.log(`  [AI] Sending to Ollama (${model})…`);
  const raw      = await callOllama(userPrompt);
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
