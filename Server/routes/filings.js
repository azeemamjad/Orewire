const express = require('express');
const router  = express.Router();
const db      = require('../db');

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
    const { company_id, verdict, search, commodity, exchange, limit } = req.query;
    let query = `
      SELECT f.id, f.company_name, f.filing_type, f.pdf_filename,
             f.analyzed, f.status, f.created_at, f.commodity,
             COALESCE(NULLIF(f.exchange, ''), c.exchange) as exchange,
             a.verdict, a.ticker_summary, a.summary, a.verdict_reason
      FROM filings f
      LEFT JOIN ai_output a ON a.filing_id = f.id
      LEFT JOIN companies c ON c.id = f.company_id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 0;

    if (company_id) {
      paramIdx++;
      query += ` AND f.company_id = $${paramIdx}`;
      params.push(company_id);
    }
    if (verdict) {
      paramIdx++;
      query += ` AND a.verdict = $${paramIdx}`;
      params.push(verdict);
    }
    if (search) {
      paramIdx++;
      query += ` AND f.company_name ILIKE $${paramIdx}`;
      params.push(`%${search}%`);
    }

    const parsedLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 500));
    query += ` ORDER BY f.created_at DESC LIMIT ${parsedLimit}`;
    const result = await db.query(query, params);
    const rows = result.rows;

    const enriched = rows.map(row => ({
      ...row,
      commodity: row.commodity || inferCommodity(row.summary, row.ticker_summary),
      verdict: row.verdict ? row.verdict.charAt(0).toUpperCase() + row.verdict.slice(1) : null,
    }));

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

module.exports = router;
