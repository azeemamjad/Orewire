/**
 * Resolve a companies row for a filing without bare ticker collisions.
 * Prefer (exchange, ticker), then exact name, never loose ILIKE as primary.
 */

function normalizeExchange(ex) {
  if (!ex) return null;
  const upper = String(ex).toUpperCase().replace(/-/g, '');
  if (upper === 'TSXV' || upper === 'TSXVENTURE') return 'TSXV';
  if (upper === 'TSX') return 'TSX';
  if (upper === 'CSE') return 'CSE';
  if (upper === 'ASX') return 'ASX';
  if (upper === 'NEX') return 'NEX';
  return String(ex).toUpperCase();
}

function normalizeTicker(ticker) {
  if (!ticker) return null;
  return String(ticker).trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ ticker?: string, exchange?: string, companyName?: string }} opts
 */
async function findCompanyForFiling(db, { ticker, exchange, companyName } = {}) {
  const tk = normalizeTicker(ticker);
  const ex = normalizeExchange(exchange);
  const name = companyName ? String(companyName).replace(/_/g, ' ').trim() : null;

  if (tk && ex) {
    const r = await db.query(
      `SELECT id, name, exchange, ticker FROM companies
        WHERE UPPER(REPLACE(COALESCE(exchange, ''), '-', '')) = $1
          AND UPPER(REPLACE(COALESCE(ticker, ''), ' ', '')) = $2
        LIMIT 1`,
      [ex.replace(/-/g, ''), tk],
    );
    if (r.rows[0]) return r.rows[0];
  }

  if (tk && ex) {
    const r = await db.query(
      `SELECT id, name, exchange, ticker FROM companies
        WHERE UPPER(REPLACE(COALESCE(ticker, ''), ' ', '')) = $1
          AND (
            UPPER(REPLACE(COALESCE(exchange, ''), '-', '')) = $2
            OR UPPER(COALESCE(exchange, '')) = $3
          )
        LIMIT 1`,
      [tk, ex.replace(/-/g, ''), ex],
    );
    if (r.rows[0]) return r.rows[0];
  }

  // Ticker alone only if unique
  if (tk) {
    const r = await db.query(
      `SELECT id, name, exchange, ticker FROM companies
        WHERE UPPER(REPLACE(COALESCE(ticker, ''), ' ', '')) = $1`,
      [tk],
    );
    if (r.rows.length === 1) return r.rows[0];
  }

  if (name) {
    const exact = await db.query(
      `SELECT id, name, exchange, ticker FROM companies
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        LIMIT 1`,
      [name],
    );
    if (exact.rows[0]) return exact.rows[0];
  }

  return null;
}

/**
 * True if any issuer name from the document loosely matches the DB company name.
 */
function issuerMatchesCompany(companyName, issuerNames) {
  if (!companyName || !Array.isArray(issuerNames) || !issuerNames.length) return true;
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|corp|corporation|ltd|limited|plc|co|company)\b/g, '')
    .trim();
  const target = norm(companyName);
  if (!target) return true;
  return issuerNames.some((n) => {
    const a = norm(n);
    if (!a) return false;
    return a.includes(target) || target.includes(a);
  });
}

module.exports = {
  normalizeExchange,
  normalizeTicker,
  findCompanyForFiling,
  issuerMatchesCompany,
};
