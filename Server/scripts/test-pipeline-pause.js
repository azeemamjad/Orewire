#!/usr/bin/env node
/**
 * Behavioural test for the pipeline's pause-instead-of-abort proxy handling.
 *
 *   node scripts/test-pipeline-pause.js
 *
 * Stubs the pipeline's heavy dependencies (DB, scrapers, relay store) and runs
 * the real `runDownloadQueue` drain loop against a fake proxy that can be made
 * to fail and recover, then asserts:
 *
 *   1. PAUSE + AUTO-RESUME: while the proxy is down, companies are re-queued
 *      (never marked as errors) and the run pauses; the moment the proxy is
 *      back the run finishes every company on its own.
 *   2. PAUSE BUDGET: with PIPELINE_PROXY_PAUSE_MAX_MS set and the proxy never
 *      returning, the run aborts cleanly with companies unmarked.
 */
require('dotenv').config();

const Module = require('module');
const path = require('path');

// --- Stub the heavy/DB-bound modules runner.js pulls in ---------------------
const realLoad = Module._load;
let tunnelUp = false;
let sedarCalls = 0;

const stub = (request, parent, isMain) => {
  switch (request) {
    case './regions':
      return { CANADA_COMPANIES_QUERY: '-- stubbed', ASX_COMPANIES_QUERY: '-- stubbed' };
    case './config':
      return {
        load: () => ({}),
        loadConfig: () => ({ concurrency: 1, analysisConcurrency: 1, daysBack: 1, analyze: false, seedOnStart: false }),
      };
    case '../db':
      return {
        query: async () => ({ rows: [] }),
        connect: async () => ({ query: async () => ({}), release: () => {} }),
      };
    case '../db/insiders':
      return { upsertInsiderData: async () => {} };
    case '../lib/scraper/paths':
      return { DOWNLOADS_DIR: '/tmp/orewire-pipeline-pause-test' };
    case '../lib/companies/match':
      return { findCompanyForFiling: async () => null };
    case '../lib/scraper/analyzer/persist':
      return { resolveFilingStatus: () => 'unverified', analyzedFlagForAnalysis: () => true, aiOutputParams: () => ({}), AI_OUTPUT_SQL: '--' };
    case '../lib/scraper/analyzer/constants':
      return { isExtractionFailed: () => false };
    case '../lib/infra/object-storage':
      return { isStorageEnabled: () => false, persistFilingPdf: async (p) => p, localPathToObjectKey: (p) => p };
    case '../lib/scraper/env':
      return { applyScraperEnv: () => ({}), restoreScraperEnv: () => {}, relayWiringEnabled: () => true };
    case '../lib/scraper/runners/sedar':
      return {
        runSedarDownload: async () => {
          sedarCalls += 1;
          if (!tunnelUp) {
            throw new Error(
              'page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://www.sedarplus.ca/home/',
            );
          }
        },
      };
    case '../lib/scraper/runners/asx':
      return { runAsxDownload: async () => {} };
    case '../lib/scraper/runners/analyze-one':
      return { runAnalyzeOne: async () => ({ verdict: 'ok' }) };
    case '../relay/proxy-store':
      return { refreshProxyCache: async () => {}, getPrimaryProxyWorkersForTier: () => [1] };
    case '../relay/net-errors':
      return realLoad.call(this, request, parent, isMain); // keep the real transport classification
    default:
      return null;
  }
};

Module._load = function (request, parent, isMain) {
  const s = stub(request, parent, isMain);
  return s !== null ? s : realLoad.call(this, request, parent, isMain);
};

const { state } = require('../pipeline/state');

// PROXY_PAUSE_* are read at module load, so each scenario re-requires runner.js
// with the env set (require.cache busted) while sharing the same state singleton.
function loadRunner() {
  const p = require.resolve('../pipeline/runner');
  delete require.cache[p];
  return require(p);
}

// Silence the state module's own console noise and redirect our assertions.
const logs = () => state.logs.map((e) => e.msg);

function resetState() {
  state.logs = [];
  state.status = 'idle';
  state.stopRequested = false;
  state.progress = { total: 0, done: 0, errors: 0 };
  state.analysisProgress = { total: 0, done: 0, errors: 0 };
}

const companies = Array.from({ length: 10 }, (_, i) => ({
  name: `Company ${i}`,
  ticker: `T${i}`,
  exchange: 'TSXV',
}));

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ok: ${label}`);
  }
}

(async () => {
  // --- Test 1: pause, then auto-resume when the proxy comes back -------------
  console.log('\nTest 1 — pause + auto-resume');
  resetState();
  tunnelUp = false;
  sedarCalls = 0;
  process.env.PIPELINE_PROXY_PAUSE_MS = '40';
  delete process.env.PIPELINE_PROXY_PAUSE_MAX_MS;
  const { runDownloadQueue } = loadRunner();

  const cfg = { concurrency: 1, analysisConcurrency: 1, daysBack: 1, analyze: false, seedOnStart: false };
  const run1 = runDownloadQueue([...companies], cfg);

  // Let it hit the pause a few times, then "the laptop wakes up".
  await sleep(150);
  const sawPauseWhileDown = logs().some((m) => m.includes('[Pipeline] PAUSING'));
  tunnelUp = true;

  await run1;
  await sleep(20);

  assert(sawPauseWhileDown, 'paused while the proxy was down');
  assert(!logs().some((m) => m.includes('ABORTING')), 'did not abort');
  assert(state.progress.done === companies.length,
    `all ${companies.length} companies completed (got ${state.progress.done})`);
  assert(state.progress.errors === 0, 'no companies marked as errors');
  assert(sedarCalls > companies.length, 'companies were retried after the outage');

  // --- Test 2: bounded pause budget eventually aborts cleanly -----------------
  console.log('\nTest 2 — pause budget aborts cleanly');
  resetState();
  tunnelUp = false;
  sedarCalls = 0;
  process.env.PIPELINE_PROXY_PAUSE_MS = '20';
  process.env.PIPELINE_PROXY_PAUSE_MAX_MS = '45';
  const { runDownloadQueue: run2 } = loadRunner();

  await run2([...companies], cfg);
  await sleep(20);

  const abortLines = logs().filter((m) => m.includes('ABORTING'));
  assert(abortLines.length > 0, 'aborted after the pause budget was exceeded');
  assert(abortLines.some((m) => /re-queued/.test(m)), 'abort mentions re-queued companies');
  assert(state.progress.done === 0, 'no companies completed');
  assert(state.progress.errors === 0, 'no companies marked as errors');

  // --- Test 3: zero pause restores the old abort behaviour --------------------
  console.log('\nTest 3 — PIPELINE_PROXY_PAUSE_MS=0 aborts immediately (legacy)');
  resetState();
  tunnelUp = false;
  sedarCalls = 0;
  process.env.PIPELINE_PROXY_PAUSE_MS = '0';
  delete process.env.PIPELINE_PROXY_PAUSE_MAX_MS;
  const { runDownloadQueue: run3 } = loadRunner();

  await run3([...companies], cfg);
  await sleep(20);

  assert(logs().some((m) => m.includes('ABORTING')), 'aborted without pausing');
  assert(state.progress.done === 0, 'no companies completed');

  console.log(process.exitCode ? '\nFAILURES PRESENT' : '\nALL TESTS PASSED');
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
