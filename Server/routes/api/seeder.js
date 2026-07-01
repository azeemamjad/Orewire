const express = require('express');
const { runCseSeed } = require('../../lib/scraper/runners/cse-seed');
const { runAsxSeed } = require('../../lib/scraper/runners/asx-seed');
const { applyScraperEnv, restoreScraperEnv } = require('../../lib/scraper/env');
const router  = express.Router();
const XLSX    = require('xlsx');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const db      = require('../../db');

const TSX_URL = 'https://www.tsx.com/en/resource/101';

// ---------------------------------------------------------------------------
// Column parsing helpers (mirrors upload.js)
// ---------------------------------------------------------------------------

const EXACT_TOKENS = new Set([
  'exchange', 'name', 'ticker', 'sub', 'au', 'ag', 'sector', 'float',
  'owner', 'trading', 'volume', 'interval',
  'company', 'symbol', 'industry', 'indices', 'currency', 'tier',  // CSE-specific
]);
const PARTIAL_KEYWORDS = [
  'market cap', 'listing', 'sedar', 'float', 'exchange', 'name',
  'sector', 'date', 'index', 'filing',
];

function detectHeaderRow(rawRows) {
  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const cells = rawRows[i].map(c => String(c).toLowerCase().trim());
    if (cells.filter(c => EXACT_TOKENS.has(c)).length >= 2) return i;
  }
  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const nonEmpty = rawRows[i].filter(c => c !== '' && c !== null && c !== undefined);
    if (nonEmpty.length >= 5 && nonEmpty.every(c => typeof c === 'string' && c.length < 60)) return i;
  }
  let bestRow = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const cells = rawRows[i].map(c => String(c).toLowerCase().trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const score = PARTIAL_KEYWORDS.filter(k => cells.some(c => c.includes(k))).length * 3
                + cells.filter(c => c.length < 40).length;
    if (score > bestScore) { bestScore = score; bestRow = i; }
  }
  return bestRow;
}

function normalizeCol(col) {
  return String(col).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function parseSheet(sheet, headerRow) {
  return XLSX.utils.sheet_to_json(sheet, { range: headerRow, defval: null }).map(row => {
    const out = {};
    for (const [col, val] of Object.entries(row)) out[normalizeCol(col)] = val;
    return out;
  });
}

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
  { prefix: 'market cap (c$)',  field: 'market_cap'  },
  { prefix: 'o/s shares',       field: 'total_float' },
  { prefix: 'market cap',       field: 'market_cap'  },
  { prefix: 'total market cap', field: 'market_cap'  },
];

function resolveField(rawCol) {
  const key = normalizeCol(rawCol).toLowerCase();
  if (EXACT_COL[key]) return EXACT_COL[key];
  for (const { prefix, field } of PREFIX_COL) {
    if (key.startsWith(prefix)) return field;
  }
  return null;
}

function mapRow(row, exchangeFallback) {
  const out = {
    exchange: exchangeFallback, name: null, ticker: null, sedar_ticker: null,
    market_cap: null, total_float: null, has_gold: 0, has_silver: 0,
    sector: null, listing_date: null,
    raw_data: JSON.stringify(row),
  };
  for (const [col, val] of Object.entries(row)) {
    const field = resolveField(col);
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
// POST /api/seeder/tsx
// ---------------------------------------------------------------------------

router.post('/tsx', async (req, res) => {
  let tmpFile = null;
  try {
    const resp = await fetch(TSX_URL, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
        'Referer':    'https://www.tsx.com/',
      },
    });
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);

    const buf = Buffer.from(await resp.arrayBuffer());
    tmpFile = path.join(os.tmpdir(), `tsx_seed_${Date.now()}.xlsx`);
    fs.writeFileSync(tmpFile, buf);

    const wb = XLSX.readFile(tmpFile);
    const stats = { inserted: 0, skipped: 0, errors: [], sheets: [] };

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ins = `
        INSERT INTO companies
          (exchange, name, ticker, sedar_ticker, market_cap, total_float,
           has_gold, has_silver, sector, listing_date, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;

      for (const sheetName of wb.SheetNames) {
        const upper = sheetName.toUpperCase().trim();
        const isTSXV = upper.startsWith('TSXV');
        const isTSX  = !isTSXV && upper.startsWith('TSX');
        if (!isTSX && !isTSXV) {
          console.log(`[seeder] Skipping sheet "${sheetName}"`);
          continue;
        }
        const exchangeLabel = isTSXV ? 'TSXV' : 'TSX';

        const rawRows   = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
        const headerRow = detectHeaderRow(rawRows);
        const rows      = parseSheet(wb.Sheets[sheetName], headerRow);

        console.log(`[seeder] Sheet "${sheetName}": ${rows.length} rows, header at row ${headerRow}`);

        let inserted = 0, skipped = 0;
        for (const row of rows) {
          try {
            const m = mapRow(row, exchangeLabel);
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
          } catch (err) {
            stats.errors.push({ row: row.name ?? '?', error: err.message });
          }
        }

        stats.sheets.push({ name: sheetName, inserted, skipped });
        stats.inserted += inserted;
        stats.skipped  += skipped;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpFile && fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
});

// GET /api/seeder/tsx/preview
router.get('/tsx/preview', async (req, res) => {
  let tmpFile = null;
  try {
    const resp = await fetch(TSX_URL, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
        'Referer':    'https://www.tsx.com/',
      },
    });
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);

    const buf = Buffer.from(await resp.arrayBuffer());
    tmpFile = path.join(os.tmpdir(), `tsx_preview_${Date.now()}.xlsx`);
    fs.writeFileSync(tmpFile, buf);

    const wb      = XLSX.readFile(tmpFile);
    const preview = {};

    for (const sheetName of wb.SheetNames) {
      const upper  = sheetName.toUpperCase().trim();
      const isTSXV = upper.startsWith('TSXV');
      const isTSX  = !isTSXV && upper.startsWith('TSX');
      if (!isTSX && !isTSXV) continue;

      const rawRows   = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      const headerRow = detectHeaderRow(rawRows);
      const rows      = parseSheet(wb.Sheets[sheetName], headerRow);

      preview[sheetName] = {
        rowCount:  rows.length,
        columns:   rows.length ? Object.keys(rows[0]) : [],
        sample:    rows.slice(0, 3),
        headerRow,
      };
    }

    res.json({ sheets: wb.SheetNames, preview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpFile && fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
});

// ---------------------------------------------------------------------------
// Seed-state helpers (24 h throttle per source)
// ---------------------------------------------------------------------------

const SEED_STATE_FILE = path.join(__dirname, '../data/seed-state.json');

function loadSeedState() {
  try {
    if (fs.existsSync(SEED_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(SEED_STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveSeedState(state) {
  try {
    fs.mkdirSync(path.dirname(SEED_STATE_FILE), { recursive: true });
    fs.writeFileSync(SEED_STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

function canSeedCse() {
  const state = loadSeedState();
  const last = state.cse ? new Date(state.cse) : null;
  if (!last) return { allowed: true };
  const next = new Date(last.getTime() + 24 * 60 * 60 * 1000);
  if (Date.now() < next.getTime()) {
    const mins = Math.ceil((next.getTime() - Date.now()) / 60000);
    return { allowed: false, next, minutesLeft: mins };
  }
  return { allowed: true };
}

function canSeedAsx() {
  const state = loadSeedState();
  const last = state.asx ? new Date(state.asx) : null;
  if (!last) return { allowed: true };
  const next = new Date(last.getTime() + 24 * 60 * 60 * 1000);
  if (Date.now() < next.getTime()) {
    const mins = Math.ceil((next.getTime() - Date.now()) / 60000);
    return { allowed: false, next, minutesLeft: mins };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// CSE helpers
// ---------------------------------------------------------------------------

function parseCseListingDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().split('T')[0];
  }
  return String(raw).replace(/\s*T\d+\s*$/i, '').trim() || null;
}

function mapCseRow(row) {
  return {
    exchange:      'CSE',
    name:          row['Company']  ? String(row['Company']).trim()  : null,
    ticker:        row['Symbol']   ? String(row['Symbol']).trim()   : null,
    sedar_ticker:  null,
    market_cap:    null,
    total_float:   null,
    has_gold:      0,
    has_silver:    0,
    sector:        row['Industry'] ? String(row['Industry']).trim() : null,
    listing_date:  parseCseListingDate(row['Trading']),
    raw_data:      JSON.stringify(row),
  };
}

// ---------------------------------------------------------------------------
// POST /api/seeder/cse
// ---------------------------------------------------------------------------

router.post('/cse', async (req, res) => {
  const throttle = canSeedCse();
  if (!throttle.allowed) {
    return res.status(429).json({
      error: `CSE can only be seeded once every 24 hours. Try again in ${throttle.minutesLeft} minute(s).`,
      retryAfter: throttle.minutesLeft * 60,
    });
  }

  const state = loadSeedState();
  state.cse = new Date().toISOString();
  saveSeedState(state);

  const logs = [];
  let xlsxPath = null;
  const saved = applyScraperEnv({ relay: false });
  try {
    const result = await runCseSeed();
    if (!result.ok) return res.status(500).json({ error: result.error, logs });
    xlsxPath = result.path;

    const wb      = XLSX.readFile(xlsxPath);
    const sheet   = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const hRow    = detectHeaderRow(rawRows);
    const rows    = parseSheet(sheet, hRow);

    const stats = { inserted: 0, skipped: 0, errors: [], logs };

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ins = `
        INSERT INTO companies
          (exchange, name, ticker, sedar_ticker, market_cap, total_float,
           has_gold, has_silver, sector, listing_date, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;

      for (const row of rows) {
        try {
          const m = mapCseRow(row);
          if (!m.name) { stats.skipped++; continue; }

          const exists = await client.query(
            'SELECT id FROM companies WHERE name = $1 AND exchange = $2',
            [m.name, 'CSE']
          );

          if (exists.rows.length > 0) { stats.skipped++; continue; }
          await client.query(ins, [
            m.exchange, m.name, m.ticker, m.sedar_ticker, m.market_cap, m.total_float,
            m.has_gold, m.has_silver, m.sector, m.listing_date, m.raw_data,
          ]);
          stats.inserted++;
        } catch (err) {
          stats.errors.push({ row: row['Company'] ?? row['Name'] ?? '?', error: err.message });
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
  } catch (err) {
    res.status(500).json({ error: err.message, logs });
  } finally {
    restoreScraperEnv(saved);
    if (xlsxPath && fs.existsSync(xlsxPath)) {
      try { fs.unlinkSync(xlsxPath); } catch { /* ignore */ }
    }
  }
});

// GET /api/seeder/cse/status — when was CSE last seeded?
router.get('/cse/status', (req, res) => {
  const state = loadSeedState();
  const last = state.cse ? new Date(state.cse) : null;
  const throttle = canSeedCse();
  res.json({
    lastSeed: state.cse || null,
    allowed: throttle.allowed,
    nextSeed: throttle.allowed ? null : throttle.next.toISOString(),
    minutesLeft: throttle.allowed ? 0 : throttle.minutesLeft,
  });
});

// GET /api/seeder/cse/preview — download + return columns/sample without inserting
router.get('/cse/preview', async (req, res) => {
  const logs = [];
  let xlsxPath = null;
  const saved = applyScraperEnv({ relay: false });
  try {
    const result = await runCseSeed();
    if (!result.ok) return res.status(500).json({ error: result.error, logs });
    xlsxPath = result.path;

    const wb      = XLSX.readFile(xlsxPath);
    const sheet   = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const hRow    = detectHeaderRow(rawRows);
    const rows    = parseSheet(sheet, hRow);
    res.json({
      sheetNames: wb.SheetNames,
      headerRow:  hRow,
      columns:    rows.length ? Object.keys(rows[0]) : [],
      rowCount:   rows.length,
      sample:     rows.slice(0, 3),
      logs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, logs });
  } finally {
    restoreScraperEnv(saved);
    if (xlsxPath && fs.existsSync(xlsxPath)) {
      try { fs.unlinkSync(xlsxPath); } catch { /* ignore */ }
    }
  }
});

// ---------------------------------------------------------------------------
// ASX helpers
// ---------------------------------------------------------------------------

function parseAsxDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s || null;
}

function mapAsxRow(row) {
  const ticker     = row['ASX code']           ? String(row['ASX code']).trim()           : null;
  const name       = row['Company name']        ? String(row['Company name']).trim()        : null;
  const sector     = row['GICs industry group'] ? String(row['GICs industry group']).trim() : null;
  const rawDate    = row['Listing date'];
  const rawCap     = row['Market Cap'];

  const market_cap = (rawCap !== null && rawCap !== undefined && rawCap !== '')
    ? parseFloat(String(rawCap).replace(/[$,\s]/g, '')) || null
    : null;

  return {
    exchange:     'ASX',
    name,
    ticker,
    sedar_ticker: null,
    market_cap,
    total_float:  null,
    has_gold:     0,
    has_silver:   0,
    sector,
    listing_date: parseAsxDate(rawDate),
    raw_data:     JSON.stringify(row),
  };
}

async function fetchAsxSeed() {
  const saved = applyScraperEnv({ relay: false });
  try {
    const result = await runAsxSeed();
    return { result, logs: [] };
  } finally {
    restoreScraperEnv(saved);
  }
}

function parseAsxCsv(csvPath) {
  const wb      = XLSX.readFile(csvPath, { raw: false });
  const sheet   = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const hRow    = detectHeaderRow(rawRows);
  return parseSheet(sheet, hRow);
}

// ---------------------------------------------------------------------------
// POST /api/seeder/asx
// ---------------------------------------------------------------------------

router.post('/asx', async (req, res) => {
  const throttle = canSeedAsx();
  if (!throttle.allowed) {
    return res.status(429).json({
      error: `ASX can only be seeded once every 24 hours. Try again in ${throttle.minutesLeft} minute(s).`,
      retryAfter: throttle.minutesLeft * 60,
    });
  }

  // Record start time so we don't re-run even if the scraper crashes
  const state = loadSeedState();
  state.asx = new Date().toISOString();
  saveSeedState(state);

  let csvPath = null;
  try {
    const { result, logs } = await fetchAsxSeed();
    if (!result.ok) return res.status(500).json({ error: result.error, logs });
    csvPath = result.path;

    const rows  = parseAsxCsv(csvPath);
    const stats = { inserted: 0, skipped: 0, errors: [], logs };

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const ins = `
        INSERT INTO companies
          (exchange, name, ticker, sedar_ticker, market_cap, total_float,
           has_gold, has_silver, sector, listing_date, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `;

      for (const row of rows) {
        try {
          const m = mapAsxRow(row);
          if (!m.name) { stats.skipped++; continue; }

          // ASX seed: only keep Materials (mining) companies
          const sector = m.sector ? String(m.sector).trim().toLowerCase() : '';
          if (sector !== 'materials') { stats.skipped++; continue; }

          const exists = await client.query(
            'SELECT id FROM companies WHERE name = $1 AND exchange = $2',
            [m.name, 'ASX']
          );

          if (exists.rows.length > 0) { stats.skipped++; continue; }
          await client.query(ins, [
            m.exchange, m.name, m.ticker, m.sedar_ticker, m.market_cap, m.total_float,
            m.has_gold, m.has_silver, m.sector, m.listing_date, m.raw_data,
          ]);
          stats.inserted++;
        } catch (err) {
          stats.errors.push({ row: row['Company name'] ?? '?', error: err.message });
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
  } catch (err) {
    res.status(500).json({ error: err.message, logs: err.logs });
  } finally {
    if (csvPath && fs.existsSync(csvPath)) {
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
  }
});

// GET /api/seeder/asx/status — when was ASX last seeded?
router.get('/asx/status', (req, res) => {
  const state = loadSeedState();
  const last = state.asx ? new Date(state.asx) : null;
  const throttle = canSeedAsx();
  res.json({
    lastSeed: state.asx || null,
    allowed: throttle.allowed,
    nextSeed: throttle.allowed ? null : throttle.next.toISOString(),
    minutesLeft: throttle.allowed ? 0 : throttle.minutesLeft,
  });
});

// GET /api/seeder/asx/preview
router.get('/asx/preview', async (req, res) => {
  let csvPath = null;
  try {
    const { result, logs } = await fetchAsxSeed();
    if (!result.ok) return res.status(500).json({ error: result.error, logs });
    csvPath = result.path;

    const rows = parseAsxCsv(csvPath);
    res.json({
      rowCount: rows.length,
      columns:  rows.length ? Object.keys(rows[0]) : [],
      sample:   rows.slice(0, 3),
      logs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, logs: err.logs });
  } finally {
    if (csvPath && fs.existsSync(csvPath)) {
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
  }
});

module.exports = router;
