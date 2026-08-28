/** Exchange groupings for filing pipelines (Canada vs ASX). */

const CANADIAN_EXCHANGES = ['TSX', 'TSXV', 'TSX-V', 'CSE'];

function normalizeExchange(exchange) {
  return String(exchange || '').toUpperCase().replace(/-/g, '');
}

function isCanadianExchange(exchange) {
  const ex = normalizeExchange(exchange);
  return ex === 'TSX' || ex === 'TSXV' || ex === 'CSE';
}

function isAsxExchange(exchange) {
  return normalizeExchange(exchange) === 'ASX';
}

/** SQL fragment — bind-free, used in static queries only. */
const CANADA_COMPANIES_WHERE = `UPPER(REPLACE(exchange, '-', '')) IN ('TSX', 'TSXV', 'CSE')`;

const CANADA_COMPANIES_QUERY = `
  SELECT name, ticker, exchange FROM companies
  WHERE ${CANADA_COMPANIES_WHERE}
  ORDER BY name
`;

const ASX_COMPANIES_QUERY = `
  SELECT name, ticker, exchange FROM companies
  WHERE UPPER(exchange) = 'ASX'
  ORDER BY name
`;

module.exports = {
  CANADIAN_EXCHANGES,
  normalizeExchange,
  isCanadianExchange,
  isAsxExchange,
  CANADA_COMPANIES_WHERE,
  CANADA_COMPANIES_QUERY,
  ASX_COMPANIES_QUERY,
};
