#!/usr/bin/env node
'use strict';

/**
 * Submit URLs to IndexNow (Bing, Yandex, Seznam, Naver).
 *
 * Bing is the target that matters: it backs Copilot and feeds several answer
 * products, so a freshly created or updated company profile reaching Bing
 * quickly is a direct route to being answerable. Google does not use IndexNow.
 *
 * Usage
 *   node scripts/submit-indexnow.js                 hubs, static pages, sitemap
 *   node scripts/submit-indexnow.js --recent 200    the 200 most recently updated companies
 *   node scripts/submit-indexnow.js --companies     every company profile
 *
 * Before running: INDEXNOW_KEY must be set and deployed, because IndexNow
 * verifies the key by fetching https://<host>/<key>.txt. Verify that first:
 *
 *   curl https://www.orewire.com/<key>.txt
 */

require('dotenv').config();

const data = require('../lib/seo/data');
const indexnow = require('../lib/seo/indexnow');
const { absoluteUrl, companyUrl, siteOrigin } = require('../lib/seo/util');

const BATCH_SIZE = Math.min(indexnow.MAX_URLS_PER_REQUEST, 10000);

function parseArgs(argv) {
  const args = { companies: false, recent: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--companies') args.companies = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--recent') args.recent = Math.max(1, parseInt(argv[i + 1], 10) || 200);
  }
  return args;
}

function staticPaths() {
  return ['/', '/companies', '/filings', '/news', '/market-news'];
}

function hubPaths() {
  return [
    ...data.HUB_COMMODITIES.map((c) => `/companies?commodity=${encodeURIComponent(c)}`),
    ...data.HUB_EXCHANGES.map((e) => `/companies?exchange=${encodeURIComponent(e)}`),
  ];
}

/** Every company profile path, fetched in pages so memory stays flat. */
async function allCompanyPaths() {
  const paths = [];
  let offset = 0;
  for (;;) {
    const rows = await data.listCompanySitemapRows(offset, BATCH_SIZE);
    if (!rows.length) break;
    for (const row of rows) paths.push(companyUrl(row.name));
    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return paths;
}

/** The most recently updated company profiles, newest first. */
async function recentCompanyPaths(limit) {
  // listCompanySitemapRows is ordered by id; take the tail, which is the newest.
  const total = await data.countCompanies();
  const offset = Math.max(0, total - limit);
  const rows = await data.listCompanySitemapRows(offset, limit);
  return rows.map((row) => companyUrl(row.name));
}

async function report(label, paths) {
  if (!paths.length) {
    console.log(`[indexnow] ${label}: nothing to submit`);
    return;
  }
  let submitted = 0;
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const result = await indexnow.submit(batch);
    if (result.ok) {
      submitted += result.submitted || batch.length;
      console.log(`[indexnow] ${label}: submitted ${batch.length} (HTTP ${result.status})`);
    } else {
      console.error(
        `[indexnow] ${label}: batch failed -> ${result.skipped || result.error || `HTTP ${result.status}`}`
      );
    }
  }
  console.log(`[indexnow] ${label}: ${submitted} url(s) accepted`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[indexnow] origin: ${siteOrigin()}`);

  if (!indexnow.enabled()) {
    console.error(
      '[indexnow] INDEXNOW_KEY is not set or is malformed.\n' +
        '           Expected 8-128 characters of a-z A-Z 0-9 and dashes.\n' +
        '           Set it on the backend service, redeploy, then verify\n' +
        `           ${siteOrigin()}/<key>.txt returns the key.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[indexnow] key file: ${indexnow.keyLocation()}`);

  if (args.dryRun) {
    const preview = [...staticPaths(), ...hubPaths()].map(absoluteUrl);
    console.log('[indexnow] dry run, would submit:');
    for (const url of preview) console.log(`           ${url}`);
    return;
  }

  await report('static and hubs', [...staticPaths(), ...hubPaths()]);

  if (args.recent) {
    await report(`${args.recent} most recent companies`, await recentCompanyPaths(args.recent));
  }

  if (args.companies) {
    await report('all companies', await allCompanyPaths());
  }
}

main()
  // Explicit exit, matching the other scripts here: the shared pg pool would
  // otherwise keep the event loop alive after the work is done.
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error('[indexnow] fatal:', err?.message || err);
    process.exit(1);
  });
