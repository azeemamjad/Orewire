/** Minimum characters of extracted text required before calling the LLM. */
const MIN_EXTRACT_CHARS = 80;

/** Max PDF pages to OCR (cost/latency cap). */
const OCR_MAX_PAGES = 15;

function extractionFailedAnalysis(reason) {
  return {
    display_type: 'ticker',
    ticker_summary: 'Text extraction failed — view original PDF.',
    summary:
      'This filing could not be processed automatically because no readable text was found.',
    verdict: 'extraction_failed',
    verdict_reason: reason || 'PDF has no extractable text layer (image-only or corrupt).',
    key_facts: ['Text extraction failed; filing could not be analyzed.'],
    context: null,
    grade_commentary: null,
    what_to_watch: 'View the original PDF for details.',
    data_extracted: null,
    issuer_names_from_document: null,
  };
}

function isExtractionFailed(analysis) {
  return analysis?.verdict === 'extraction_failed';
}

/** analyzed=1 only for successful LLM analyses (not extraction failures). */
function analyzedFlagForAnalysis(analysis) {
  return isExtractionFailed(analysis) ? 0 : 1;
}

function filingStatusForAnalysis(analysis) {
  if (isExtractionFailed(analysis)) return 'extraction_failed';
  if (analysis?.verdict === 'company_mismatch') return 'company_mismatch';
  return 'analyzed';
}

module.exports = {
  MIN_EXTRACT_CHARS,
  OCR_MAX_PAGES,
  extractionFailedAnalysis,
  isExtractionFailed,
  analyzedFlagForAnalysis,
  filingStatusForAnalysis,
};
