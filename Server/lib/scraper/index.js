const { DOWNLOADS_DIR, COOKIE_FILE, SERVER_ROOT } = require('./paths');

module.exports = {
  DOWNLOADS_DIR,
  COOKIE_FILE,
  SERVER_ROOT,
  runSedarDownload: require('./runners/sedar').runSedarDownload,
  runAsxDownload: require('./runners/asx').runAsxDownload,
  runAnalyzeOne: require('./runners/analyze-one').runAnalyzeOne,
  runTransferAgentBatch: require('./runners/transfer-agents').runTransferAgentBatch,
  runAsxSeed: require('./runners/asx-seed').runAsxSeed,
  runCseSeed: require('./runners/cse-seed').runCseSeed,
  scrapeSedar: require('./sedar/scraper').scrapeSedar,
  scrapeAsxFilingsForCompany: require('./asx/filings-scraper').scrapeAsxFilingsForCompany,
  analyzePdf: require('./analyzer').analyzePdf,
  analyzeDirectory: require('./analyzer').analyzeDirectory,
};
