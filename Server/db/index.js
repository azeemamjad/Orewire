require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = pool;

/*
═══════════════════════════════════════════════════════════════════════
SUPABASE SCHEMA — run this in the Supabase SQL Editor before starting
═══════════════════════════════════════════════════════════════════════

CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  exchange TEXT,
  name TEXT NOT NULL,
  ticker TEXT,
  sedar_ticker TEXT,
  market_cap REAL,
  total_float REAL,
  has_gold INTEGER DEFAULT 0,
  has_silver INTEGER DEFAULT 0,
  has_copper INTEGER DEFAULT 0,
  sector TEXT,
  listing_date TEXT,
  region TEXT,
  raw_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE filings (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id),
  company_name TEXT NOT NULL,
  exchange TEXT,
  filing_type TEXT,
  pdf_filename TEXT,
  pdf_path TEXT UNIQUE,
  commodity TEXT,
  analyzed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'downloaded',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_output (
  id SERIAL PRIMARY KEY,
  filing_id INTEGER NOT NULL UNIQUE REFERENCES filings(id),
  display_type TEXT,
  ticker_summary TEXT,
  summary TEXT,
  verdict TEXT,
  verdict_reason TEXT,
  key_facts TEXT,
  context TEXT,
  grade_commentary TEXT,
  what_to_watch TEXT,
  cash_position REAL,
  burn_rate_quarterly REAL,
  resource_estimate TEXT,
  pp_amount REAL,
  pp_price REAL,
  insider_holdings TEXT,
  raw_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_exchange ON companies(exchange);
CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_companies_ticker ON companies(ticker);
CREATE INDEX idx_filings_company_id ON filings(company_id);
CREATE INDEX idx_filings_pdf_path ON filings(pdf_path);
CREATE INDEX idx_ai_output_verdict ON ai_output(verdict);
CREATE INDEX idx_ai_output_filing_id ON ai_output(filing_id);
*/
