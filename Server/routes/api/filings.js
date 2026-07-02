const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../../db');
const {
  isRemoteStoragePath,
  parseStoragePath,
  resolveDocumentRedirect,
  streamToResponse,
} = require('../../lib/infra/object-storage');

// SEDAR+/ASX hand out temporary links, so we serve our own downloaded copy.
const { DOWNLOADS_DIR } = require('../../lib/scraper/paths');

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

router.get('/stats', async (req, res) => {
  try {
    const [companies, filings, analyzed, noteworthy, watch, routine] = await Promise.all([
      db.query('SELECT COUNT(*) as c FROM companies').then(r => parseInt(r.rows[0].c, 10)),
      db.query('SELECT COUNT(*) as c FROM filings').then(r => parseInt(r.rows[0].c, 10)),
      db.query('SELECT COUNT(*) as c FROM filings WHERE analyzed = 1').then(r => parseInt(r.rows[0].c, 10)),
      db.query("SELECT COUNT(*) as c FROM ai_output WHERE verdict = 'noteworthy'").then(r => parseInt(r.rows[0].c, 10)),
      db.query("SELECT COUNT(*) as c FROM ai_output WHERE verdict = 'watch'").then(r => parseInt(r.rows[0].c, 10)),
      db.query("SELECT COUNT(*) as c FROM ai_output WHERE verdict = 'routine'").then(r => parseInt(r.rows[0].c, 10)),
    ]);
    res.json({ companies, filings, analyzed, noteworthy, watch, routine });
  } catch (err) {
    console.error('Stats query failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable', companies: 0, filings: 0, analyzed: 0, noteworthy: 0, watch: 0, routine: 0 });
  }
});

router.get('/', async (req, res) => {
  try {
    const { company_id, verdict, search, commodity, exchange, limit, page } = req.query;

    // Build the shared WHERE clause for both the data and count queries.
    let where = ' WHERE 1=1';
    const params = [];
    let paramIdx = 0;

    if (company_id) {
      paramIdx++;
      where += ` AND f.company_id = $${paramIdx}`;
      params.push(company_id);
    }
    if (verdict) {
      paramIdx++;
      where += ` AND a.verdict = $${paramIdx}`;
      params.push(verdict);
    }
    if (search) {
      paramIdx++;
      where += ` AND (
        f.company_name ILIKE $${paramIdx}
        OR COALESCE(a.summary, '') ILIKE $${paramIdx}
        OR COALESCE(a.ticker_summary, '') ILIKE $${paramIdx}
        OR COALESCE(f.filing_type, '') ILIKE $${paramIdx}
        OR COALESCE(c.ticker, '') ILIKE $${paramIdx}
      )`;
      params.push(`%${search}%`);
    }
    if (commodity && commodity !== 'All') {
      paramIdx++;
      where += ` AND COALESCE(f.commodity, '') = $${paramIdx}`;
      params.push(commodity);
    }
    if (exchange && exchange !== 'All') {
      const norm = String(exchange).toUpperCase().replace('TSX-V', 'TSXV').replace('-', '');
      if (norm === 'TSX') {
        where += ` AND UPPER(COALESCE(NULLIF(f.exchange, ''), c.exchange, '')) = 'TSX'`;
      } else {
        paramIdx++;
        where += ` AND REPLACE(UPPER(COALESCE(NULLIF(f.exchange, ''), c.exchange, '')), '-', '') = $${paramIdx}`;
        params.push(norm);
      }
    }

    const selectSql = `
      SELECT f.id, f.company_name, f.filing_type, f.pdf_filename,
             f.analyzed, f.status, f.created_at, f.commodity,
             COALESCE(NULLIF(f.exchange, ''), c.exchange) as exchange,
             a.verdict, a.ticker_summary, a.summary, a.verdict_reason
      FROM filings f
      LEFT JOIN ai_output a ON a.filing_id = f.id
      LEFT JOIN companies c ON c.id = f.company_id
    `;

    const enrich = (rows) => rows.map(row => ({
      ...row,
      commodity: row.commodity || inferCommodity(row.summary, row.ticker_summary),
      verdict: row.verdict ? row.verdict.charAt(0).toUpperCase() + row.verdict.slice(1) : null,
    }));

    // --- Paginated mode: return an envelope with total/totalPages. -----------
    if (page !== undefined) {
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const pageLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
      const offset = (parsedPage - 1) * pageLimit;

      const fromJoins = `FROM filings f LEFT JOIN ai_output a ON a.filing_id = f.id LEFT JOIN companies c ON c.id = f.company_id`;
      const countQuery = `SELECT COUNT(*)::int AS total ${fromJoins}${where}`;
      const dataQuery = `${selectSql}${where} ORDER BY f.created_at DESC LIMIT ${pageLimit} OFFSET ${offset}`;

      const [countResult, dataResult] = await Promise.all([
        db.query(countQuery, params),
        db.query(dataQuery, params),
      ]);
      const total = countResult.rows[0]?.total || 0;
      const totalPages = Math.max(1, Math.ceil(total / pageLimit));

      return res.json({
        items: enrich(dataResult.rows),
        pagination: {
          page: parsedPage,
          limit: pageLimit,
          total,
          totalPages,
          hasNext: parsedPage < totalPages,
          hasPrev: parsedPage > 1,
        },
      });
    }

    // --- Legacy mode: plain array (with post-query exchange/commodity filters).
    const parsedLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 500));
    const result = await db.query(`${selectSql}${where} ORDER BY f.created_at DESC LIMIT ${parsedLimit}`, params);
    const enriched = enrich(result.rows);

    const normExchange = exchange ? exchange.toUpperCase().replace('TSX-V', 'TSXV') : null;
    let resultData = enriched;
    if (normExchange && normExchange !== 'ALL') {
      resultData = resultData.filter(r => {
        const ex = (r.exchange || '').toUpperCase();
        if (normExchange === 'TSX') return ex === 'TSX';
        return ex === normExchange;
      });
    }
    if (commodity) {
      resultData = resultData.filter(r => r.commodity === commodity);
    }
    res.json(resultData);
  } catch (err) {
    console.error('Filings query failed:', err?.message || err);
    res.status(503).json([]);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const filingResult = await db.query('SELECT * FROM filings WHERE id = $1', [req.params.id]);
    const filing = filingResult.rows[0];
    if (!filing) return res.status(404).json({ error: 'Not found' });
    const analysisResult = await db.query('SELECT * FROM ai_output WHERE filing_id = $1', [req.params.id]);
    res.json({ ...filing, analysis: analysisResult.rows[0] || null });
  } catch (err) {
    console.error('Filing detail query failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

// GET /api/filings/:id/document — serve our downloaded copy of the original PDF.
router.get('/:id/document', async (req, res) => {
  try {
    const result = await db.query('SELECT pdf_path, pdf_filename FROM filings WHERE id = $1', [req.params.id]);
    const filing = result.rows[0];
    if (!filing || !filing.pdf_path) return res.status(404).json({ error: 'Document not found' });

    if (isRemoteStoragePath(filing.pdf_path)) {
      try {
        const redirectUrl = await resolveDocumentRedirect(filing.pdf_path);
        if (redirectUrl) {
          return res.redirect(302, redirectUrl);
        }
      } catch (err) {
        console.error('Presigned redirect failed:', err?.message || err);
      }

      const objectKey = parseStoragePath(filing.pdf_path);
      if (!objectKey) {
        return res.status(404).json({ error: 'Document not found' });
      }
      try {
        await streamToResponse(objectKey, res, { filename: filing.pdf_filename || 'filing.pdf' });
        return;
      } catch (err) {
        if (err?.name === 'NotFound' || err?.code === 'NotFound' || err?.code === 'NoSuchKey') {
          return res.status(404).json({ error: 'File no longer available' });
        }
        throw err;
      }
    }

    // Legacy local disk path — resolve and constrain to the downloads dir.
    const resolved = path.resolve(filing.pdf_path);
    if (resolved !== DOWNLOADS_DIR && !resolved.startsWith(DOWNLOADS_DIR + path.sep)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File no longer available' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filing.pdf_filename || 'filing.pdf'}"`);
    res.sendFile(resolved);
  } catch (err) {
    console.error('Filing document serve failed:', err?.message || err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

module.exports = router;
