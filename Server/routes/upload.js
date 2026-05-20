const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');

const upload = multer({ dest: './uploads/' });

// ---------------------------------------------------------------------------
// Header-row detection
// ---------------------------------------------------------------------------

const EXACT_TOKENS = new Set([
  'exchange', 'name', 'ticker', 'sub', 'au', 'ag', 'sector', 'float',
  'owner', 'trading', 'volume', 'interval',
]);
const PARTIAL_KEYWORDS = [
  'market cap', 'listing', 'sedar', 'float', 'exchange', 'name',
  'sector', 'date', 'index', 'filing',
];

function detectHeaderRow(rawRows) {
  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const cells = rawRows[i].map(c => String(c).toLowerCase().trim());
    const exact = cells.filter(c => EXACT_TOKENS.has(c)).length;
    if (exact >= 2) return i;
  }
  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const nonEmpty = rawRows[i].filter(c => c !== '' && c !== null && c !== undefined);
    if (nonEmpty.length < 5) continue;
    const allStrings = nonEmpty.every(c => typeof c === 'string' && c.length < 60);
    if (allStrings) return i;
  }
  let bestRow = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const cells = rawRows[i].map(c => String(c).toLowerCase().trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const hits      = PARTIAL_KEYWORDS.filter(k => cells.some(c => c.includes(k))).length;
    const shortCels = cells.filter(c => c.length < 40).length;
    const score     = hits * 3 + shortCels;
    if (score > bestScore) { bestScore = score; bestRow = i; }
  }
  return bestRow;
}

function normalizeCol(col) {
  return String(col).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function parseSheet(sheet, headerRow) {
  const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRow, defval: null });
  return rows.map(row => {
    const out = {};
    for (const [col, val] of Object.entries(row)) {
      out[normalizeCol(col)] = val;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Ollama — used ONLY for data validation + column mapping
// ---------------------------------------------------------------------------

async function callOllama(prompt) {
  const base   = process.env.OLLAMA_HOST  || 'https://ollama.com';
  const model  = process.env.OLLAMA_MODEL || 'qwen3.5:cloud';
  const apiKey = process.env.OLLAMA_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST', headers, signal: ctrl.signal,
      body: JSON.stringify({
        model, stream: false,
        messages: [
          { role: 'system', content: 'You are a data validation assistant. Respond ONLY with valid JSON — no markdown, no extra text.' },
          { role: 'user',   content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    return (await res.json()).message?.content || '{}';
  } finally {
    clearTimeout(timer);
  }
}

function buildValidationPrompt(columns, sample30) {
  return `A user uploaded a spreadsheet. The column headers we detected are:
${JSON.stringify(columns)}

First 30 data rows (sample):
${JSON.stringify(sample30, null, 2)}

Is this a list of publicly-listed mining / resource companies (TSX, TSXV, CSE, ASX, or similar stock exchange issuers)?
Be GENEROUS — mark is_valid=true if there are company names, exchange identifiers, tickers, or market-cap data. Only mark false for clearly unrelated data (invoices, IoT sensor readings, personal contacts, etc.).

Map the exact column names to our database fields.

Respond with ONLY this JSON — no markdown:
{
  "is_valid": true or false,
  "confidence": "high" | "medium" | "low",
  "data_type": "one-line description",
  "reason": "one sentence",
  "column_mapping": {
    "exchange":     "exact column name or null",
    "name":         "exact column name for company name or null",
    "ticker":       "exact column name for stock ticker or null",
    "sedar_ticker": "exact column name for SEDAR ticker or null",
    "market_cap":   "exact column name for market cap or null",
    "total_float":  "exact column name for float/shares outstanding or null",
    "has_gold":     "exact column name for gold exposure (AU/Gold) or null",
    "has_silver":   "exact column name for silver exposure (AG/Silver) or null",
    "sector":       "exact column name for sector/industry or null",
    "listing_date": "exact column name for listing date or null"
  }
}`;
}

async function aiValidate(columns, sample30) {
  try {
    const raw     = await callOllama(buildValidationPrompt(columns, sample30));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    return {
      is_valid: true, confidence: 'low',
      data_type: 'Unknown (AI unavailable)',
      reason: `AI error: ${err.message}`,
      column_mapping: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

const EXACT_COL = {
  'exchange':              'exchange',
  'name':                  'name',
  'ticker':                'ticker',
  'root ticker':           'ticker',
  'symbol':                'ticker',
  'sedar tickers':         'sedar_ticker',
  'sedar ticker':          'sedar_ticker',
  'co_id':                 'sedar_ticker',
  'total market cap':      'market_cap',
  'total market cap (c$)': 'market_cap',
  'market cap':            'market_cap',
  'market cap (c$)':       'market_cap',
  'total float':           'total_float',
  'float':                 'total_float',
  'o/s shares':            'total_float',
  'shares outstanding':    'total_float',
  'au':                    'has_gold',
  'gold':                  'has_gold',
  'ag':                    'has_silver',
  'silver':                'has_silver',
  'sector index':          'sector',
  'sector':                'sector',
  'listing date':          'listing_date',
};

const PREFIX_COL = [
  { prefix: 'market cap (c$)',  field: 'market_cap'   },
  { prefix: 'o/s shares',       field: 'total_float'  },
  { prefix: 'market cap',       field: 'market_cap'   },
  { prefix: 'total market cap', field: 'market_cap'   },
];

function buildColMap(aiColumnMap) {
  const map = { ...EXACT_COL };
  if (aiColumnMap) {
    for (const [field, colName] of Object.entries(aiColumnMap)) {
      if (colName) map[normalizeCol(colName).toLowerCase()] = field;
    }
  }
  return map;
}

function resolveField(rawCol, colMap) {
  const key = normalizeCol(rawCol).toLowerCase();
  if (colMap[key]) return colMap[key];
  for (const { prefix, field } of PREFIX_COL) {
    if (key.startsWith(prefix)) return field;
  }
  return null;
}

function mapRow(row, colMap) {
  const out = {
    exchange: null, name: null, ticker: null, sedar_ticker: null,
    market_cap: null, total_float: null, has_gold: 0, has_silver: 0,
    sector: null, listing_date: null,
    raw_data: JSON.stringify(row),
  };
  for (const [col, val] of Object.entries(row)) {
    const field = resolveField(col, colMap);
    if (!field || val === null || val === undefined || val === '') continue;
    if (field === 'has_gold' || field === 'has_silver') {
      out[field] = (val && val !== '0' && val !== 0 && val !== 'N' && val !== 'n') ? 1 : 0;
    } else if (field === 'market_cap' || field === 'total_float') {
      const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
      if (!isNaN(n)) out[field] = n;
    } else {
      out[field] = String(val).trim();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/upload/excel
router.post('/excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const wb        = XLSX.readFile(req.file.path);
    const preview   = {};
    const aiResults = {};

    for (const sheet of wb.SheetNames) {
      const rawRows   = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
      const headerRow = detectHeaderRow(rawRows);
      const rows    = parseSheet(wb.Sheets[sheet], headerRow);
      const columns = rows.length ? Object.keys(rows[0]) : [];

      preview[sheet] = { columns, rowCount: rows.length, sample: rows.slice(0, 3), headerRow };
      aiResults[sheet] = await aiValidate(columns, rows.slice(0, 30));
    }

    res.json({ tempPath: req.file.path, sheets: wb.SheetNames, preview, aiResults });
  } catch (err) {
    fs.existsSync(req.file.path) && fs.unlinkSync(req.file.path);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/upload/import
router.post('/import', express.json(), async (req, res) => {
  const { tempPath, sheetName, aiColumnMap, headerRow } = req.body;
  if (!tempPath || !fs.existsSync(tempPath))
    return res.status(400).json({ error: 'Temp file not found — please re-upload.' });

  try {
    const wb      = XLSX.readFile(tempPath);
    const name    = sheetName || wb.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    const hRow    = (typeof headerRow === 'number' && headerRow >= 0)
                      ? headerRow
                      : detectHeaderRow(rawRows);
    const rows    = parseSheet(wb.Sheets[name], hRow);
    const colMap  = buildColMap(aiColumnMap);

    const ins = `
      INSERT INTO companies
        (exchange, name, ticker, sedar_ticker, market_cap, total_float,
         has_gold, has_silver, sector, listing_date, raw_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    const client = await db.connect();
    let inserted = 0, skipped = 0;
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const m = mapRow(row, colMap);
        if (!m.name) { skipped++; continue; }
        const exists = await client.query(
          'SELECT id FROM companies WHERE name = $1 AND (exchange = $2 OR (exchange IS NULL AND $2 IS NULL))',
          [m.name, m.exchange]
        );
        if (exists.rows.length > 0) { skipped++; continue; }
        await client.query(ins, [
          m.exchange, m.name, m.ticker, m.sedar_ticker, m.market_cap, m.total_float,
          m.has_gold, m.has_silver, m.sector, m.listing_date, m.raw_data,
        ]);
        inserted++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    fs.unlinkSync(tempPath);
    res.json({ ok: true, inserted, skipped, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function inferCommodity(summary, tickerSummary) {
  const text = `${summary || ''} ${tickerSummary || ''}`.toLowerCase();
  if (/\b(gold|au\b|g\/t|oz.*gold)\b/i.test(text)) return 'Gold';
  if (/\b(silver|ag\b)\b/i.test(text)) return 'Silver';
  if (/\b(copper|cu\b|cu.*eq|copper equivalent)\b/i.test(text)) return 'Copper';
  if (/\b(lithium|li\b|spodumene|lithium.*carbonate)\b/i.test(text)) return 'Lithium';
  if (/\b(uranium|u3o8|u₃o₈)\b/i.test(text)) return 'Uranium';
  if (/\b(nickel|ni\b)\b/i.test(text)) return 'Nickel';
  return null;
}

// POST /api/upload/sync-analyses
router.post('/sync-analyses', express.json(), async (req, res) => {
  const downloadsDir = path.resolve(
    process.env.DOWNLOADS_DIR || path.join(__dirname, '../../Scraper/downloads')
  );
  if (!fs.existsSync(downloadsDir))
    return res.status(404).json({ error: `Downloads dir not found: ${downloadsDir}` });

  const stats = { imported: 0, skipped: 0, errors: [] };

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const insFilin = `
      INSERT INTO filings
        (company_id, company_name, pdf_filename, pdf_path, commodity, exchange, analyzed, status)
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'analyzed')
      ON CONFLICT (pdf_path) DO NOTHING
      RETURNING id
    `;
    const insAI = `
      INSERT INTO ai_output
        (filing_id, display_type, ticker_summary, summary, verdict, verdict_reason,
         key_facts, context, grade_commentary, what_to_watch,
         cash_position, burn_rate_quarterly, resource_estimate,
         pp_amount, pp_price, insider_holdings, raw_response)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (filing_id) DO UPDATE SET
        display_type = EXCLUDED.display_type,
        ticker_summary = EXCLUDED.ticker_summary,
        summary = EXCLUDED.summary,
        verdict = EXCLUDED.verdict,
        verdict_reason = EXCLUDED.verdict_reason,
        key_facts = EXCLUDED.key_facts,
        context = EXCLUDED.context,
        grade_commentary = EXCLUDED.grade_commentary,
        what_to_watch = EXCLUDED.what_to_watch,
        cash_position = EXCLUDED.cash_position,
        burn_rate_quarterly = EXCLUDED.burn_rate_quarterly,
        resource_estimate = EXCLUDED.resource_estimate,
        pp_amount = EXCLUDED.pp_amount,
        pp_price = EXCLUDED.pp_price,
        insider_holdings = EXCLUDED.insider_holdings,
        raw_response = EXCLUDED.raw_response
    `;

    const dirs = fs.readdirSync(downloadsDir)
      .filter(f => fs.statSync(path.join(downloadsDir, f)).isDirectory());

    for (const dir of dirs) {
      const dp    = path.join(downloadsDir, dir);
      const jsons = fs.readdirSync(dp).filter(f => f.endsWith('_analysis.json'));
      for (const jf of jsons) {
        const pdfName = jf.replace(/_analysis\.json$/, '.pdf');
        const pdfPath = path.join(dp, pdfName);
        try {
          const existing = await client.query('SELECT id FROM filings WHERE pdf_path = $1', [pdfPath]);
          if (existing.rows.length > 0) { stats.skipped++; continue; }

          const analysis = JSON.parse(fs.readFileSync(path.join(dp, jf), 'utf8'));
          const company  = await client.query('SELECT id, exchange FROM companies WHERE name ILIKE $1', [`%${dir.replace(/_/g, ' ')}%`]);
          const companyRow = company.rows[0];
          const commodity = inferCommodity(analysis.summary, analysis.ticker_summary);

          const fiResult = await client.query(insFilin, [
            companyRow?.id ?? null,
            dir.replace(/_/g, ' '),
            pdfName,
            pdfPath,
            commodity,
            companyRow?.exchange || null,
          ]);
          const fid = fiResult.rows[0]?.id;
          if (!fid) { stats.skipped++; continue; }

          const ext = analysis.data_extracted || {};
          await client.query(insAI, [
            fid,
            analysis.display_type ?? null,
            analysis.ticker_summary ?? null,
            analysis.summary ?? null,
            analysis.verdict ?? null,
            analysis.verdict_reason ?? null,
            JSON.stringify(analysis.key_facts ?? []),
            analysis.context ?? null,
            analysis.grade_commentary ?? null,
            analysis.what_to_watch ?? null,
            ext.cash_position ?? null,
            ext.burn_rate_quarterly ?? null,
            JSON.stringify(ext.resource_estimates ?? null),
            ext.pp_amount ?? null,
            ext.pp_price ?? null,
            JSON.stringify(ext.insider_holdings ?? null),
            JSON.stringify(analysis),
          ]);
          stats.imported++;
        } catch (err) { stats.errors.push({ file: jf, error: err.message }); }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json(stats);
});

module.exports = router;
