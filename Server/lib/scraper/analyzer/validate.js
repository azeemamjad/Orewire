const { MIN_EXTRACT_CHARS, extractionFailedAnalysis } = require('./constants');

const DEBUG_WATCH_RE = /re-?submit|pipeline|extracted text for a complete analysis|operator/i;

/**
 * Normalize / repair analysis JSON after the LLM (or force extraction_failed).
 * @param {object} analysis
 * @param {{ textLength?: number }} opts
 */
function validateAnalysis(analysis, { textLength = 0 } = {}) {
  if (!analysis || typeof analysis !== 'object') {
    return extractionFailedAnalysis('Invalid analysis payload');
  }

  let out = { ...analysis };

  if (textLength < MIN_EXTRACT_CHARS) {
    return extractionFailedAnalysis(
      'PDF has no extractable text layer (image-only or corrupt).',
    );
  }

  const verdict = String(out.verdict || '').toLowerCase();
  if (verdict === 'extraction_failed') {
    return {
      ...extractionFailedAnalysis(out.verdict_reason),
      ...out,
      verdict: 'extraction_failed',
      display_type: 'ticker',
      key_facts: Array.isArray(out.key_facts) && out.key_facts.length
        ? [out.key_facts[0]]
        : ['Text extraction failed; filing could not be analyzed.'],
      what_to_watch: 'View the original PDF for details.',
      data_extracted: null,
    };
  }

  if (out.what_to_watch && DEBUG_WATCH_RE.test(String(out.what_to_watch))) {
    out.what_to_watch = 'View the original PDF for details.';
  }

  // Move misused PP dilution into acquisition when acquisition-like fields exist.
  const ext = out.data_extracted && typeof out.data_extracted === 'object'
    ? { ...out.data_extracted }
    : null;

  if (ext) {
    const hasAcquisition = ext.acquisition
      || (ext.pp_dilution_pct != null && ext.pp_amount == null && ext.pp_price == null
        && (ext.jv_partner || ext.resale_restrictions || ext.lockup_schedule));

    if (hasAcquisition && ext.pp_dilution_pct != null && ext.pp_amount == null && ext.pp_price == null) {
      ext.acquisition = {
        ...(ext.acquisition || {}),
        dilution_pct_post: ext.acquisition?.dilution_pct_post ?? ext.pp_dilution_pct,
      };
      ext.pp_dilution_pct = null;
    }

    // Consistency: expand ↔ noteworthy/watch, ticker ↔ routine|extraction_failed
    const v = String(out.verdict || '').toLowerCase();
    if (v === 'routine') out.display_type = 'ticker';
    if (v === 'noteworthy' || v === 'watch') out.display_type = 'expand';

    out.data_extracted = ext;
  }

  return out;
}

module.exports = { validateAnalysis, DEBUG_WATCH_RE };
