const {
  analyzedFlagForAnalysis,
  filingStatusForAnalysis,
  isExtractionFailed,
} = require('./constants');
const { issuerMatchesCompany } = require('../../companies/match');

/**
 * Resolve filing status after analysis (extraction_failed / company_mismatch / analyzed).
 */
function resolveFilingStatus(analysis, companyName) {
  if (isExtractionFailed(analysis)) return 'extraction_failed';

  const issuers = analysis?.issuer_names_from_document;
  if (
    companyName
    && Array.isArray(issuers)
    && issuers.length > 0
    && !issuerMatchesCompany(companyName, issuers)
  ) {
    return 'company_mismatch';
  }

  return filingStatusForAnalysis(analysis);
}

function aiOutputParams(filingId, analysis) {
  const ext = analysis.data_extracted || {};
  // Prefer structured insider_ownership (incl. options) in insider_holdings column when present
  const insiderJson = ext.insider_ownership || ext.insider_holdings || null;
  return [
    filingId,
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
    JSON.stringify(insiderJson),
    JSON.stringify(analysis),
  ];
}

const AI_OUTPUT_SQL = `
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

module.exports = {
  resolveFilingStatus,
  analyzedFlagForAnalysis,
  aiOutputParams,
  AI_OUTPUT_SQL,
};
