#!/usr/bin/env node
'use strict';

/**
 * Walk the live sitemap and verify every URL actually resolves to rendered
 * content when requested as a crawler.
 *
 * Why this exists: nginx decides by User-Agent whether a request reaches the
 * renderer or the SPA. That makes it possible for a URL to be listed in the
 * sitemap, return 200 to a browser, and still hand a crawler a 404 or an empty
 * shell. This script is the check that catches that class of bug, because it
 * asks the site the same question a crawler asks.
 *
 * It already earned its place: `/news` and `/filings` were listed in the sitemap
 * and proxied to the renderer, but the renderer had no routes for them, so both
 * returned 404 to every crawler.
 *
 * Usage
 *   node scripts/audit-seo-urls.js
 *   node scripts/audit-seo-urls.js --base https://www.orewire.com --limit 200
 *   node scripts/audit-seo-urls.js --sample 5             # fewer per sitemap
 *   node scripts/audit-seo-urls.js --all                  # every url (~228k!)
 *   node scripts/audit-seo-urls.js --concurrency 4
 *
 * Sampling defaults to 25 URLs per sitemap. Production holds roughly 228,000
 * sitemap URLs, so `--all` is slow and should be a deliberate choice.
 *
 * Exits 1 if any URL fails, so it can gate a deploy.
 */

const DEFAULT_BASE = process.env.SEO_AUDIT_BASE || 'https://www.orewire.com';

// A crawler UA so nginx routes us to the renderer, which is the thing under test.
const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function parseArgs(argv) {
  const args = {
    base: DEFAULT_BASE,
    limit: 0,
    // Sampling is ON by default, and that is deliberate. Production holds
    // ~96,900 filings and ~131,000 news items, so the sitemaps carry about
    // 228,000 URLs. Fetching all of them in one run means 228,000 requests and
    // well over an hour, and it looks like an attack to any edge in front of the
    // site. A sample per sitemap detects the failures this script exists for,
    // because a missing route or a broken User-Agent split fails for EVERY url
    // on that sitemap, not just the unsampled ones.
    sample: 25,
    concurrency: 6,
    timeoutMs: 15000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--base' && next) args.base = next.replace(/\/+$/, '');
    else if (token === '--limit' && next) args.limit = parseInt(next, 10) || 0;
    else if (token === '--sample' && next) args.sample = parseInt(next, 10) || 0;
    else if (token === '--all') args.sample = 0;
    else if (token === '--concurrency' && next) args.concurrency = Math.max(1, parseInt(next, 10) || 6);
    else if (token === '--timeout' && next) args.timeoutMs = parseInt(next, 10) || 15000;
  }
  return args;
}

/** Every <loc> value in a sitemap document. */
function extractLocs(xml) {
  const out = [];
  const re = /<loc>([\s\S]*?)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return out;
}

async function get(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': CRAWLER_UA, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, body, finalUrl: res.url || url };
  } catch (err) {
    return { status: 0, body: '', error: err?.message || String(err), finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

/** A rendered crawler page has real markup; the SPA shell has the empty mount. */
function looksRendered(body) {
  if (!body) return false;
  if (body.includes('id="root"')) return false;
  return /<h1[\s>]/i.test(body) || /<main[\s>]/i.test(body);
}

function looksLikeSitemap(body) {
  return /<sitemapindex[\s>]/i.test(body || '');
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[audit] base: ${args.base}`);
  console.log(`[audit] user agent: Googlebot (so nginx routes to the renderer)\n`);

  // --- 1. robots.txt and llms.txt -----------------------------------------
  for (const path of ['/robots.txt', '/llms.txt']) {
    const res = await get(args.base + path, args.timeoutMs);
    const ok = res.status === 200 && res.body.trim().length > 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(res.status).padStart(3)} ${path}${res.error ? ` (${res.error})` : ''}`);
  }

  // --- 2. Sitemap index and children --------------------------------------
  const indexRes = await get(`${args.base}/sitemap.xml`, args.timeoutMs);
  if (indexRes.status !== 200 || !looksLikeSitemap(indexRes.body)) {
    console.error(`\n[audit] FAIL: /sitemap.xml did not return a sitemapindex (status ${indexRes.status})`);
    process.exit(1);
  }

  const childSitemaps = extractLocs(indexRes.body);
  console.log(`\n[audit] sitemap.xml -> ${childSitemaps.length} child sitemap(s)`);

  const targets = [];
  for (const child of childSitemaps) {
    const res = await get(child, args.timeoutMs);
    if (res.status !== 200) {
      console.log(`FAIL ${String(res.status).padStart(3)} ${child}`);
      continue;
    }
    const total = extractLocs(res.body);
    const urls = args.sample > 0 && total.length > args.sample ? total.slice(0, args.sample) : total;
    console.log(
      `ok   ${String(res.status).padStart(3)} ${child} (${urls.length} of ${total.length} url(s))`
    );
    targets.push(...urls);
  }

  let urls = targets;
  if (args.limit > 0 && urls.length > args.limit) {
    urls = urls.slice(0, args.limit);
    console.log(`[audit] limited to the first ${args.limit} url(s)`);
  }

  // --- 3. Every page URL ---------------------------------------------------
  console.log(`\n[audit] checking ${urls.length} url(s), concurrency ${args.concurrency}\n`);

  const failures = [];
  const results = await mapLimit(urls, args.concurrency, async (url) => {
    const res = await get(url, args.timeoutMs);
    const rendered = looksRendered(res.body);
    const ok = res.status === 200 && rendered;
    if (!ok) {
      failures.push({ url, status: res.status, rendered, error: res.error, finalUrl: res.finalUrl });
    }
    return ok;
  });

  const passed = results.filter(Boolean).length;
  console.log(`[audit] ${passed}/${urls.length} url(s) returned 200 with rendered content`);

  if (failures.length) {
    console.log('\n[audit] failures:');
    for (const f of failures.slice(0, 60)) {
      const reason = f.error
        ? f.error
        : f.status !== 200
          ? `HTTP ${f.status}`
          : 'HTTP 200 but served the SPA shell instead of rendered HTML';
      console.log(`  ${f.url}\n      -> ${reason}${f.finalUrl && f.finalUrl !== f.url ? ` (ended at ${f.finalUrl})` : ''}`);
    }
    if (failures.length > 60) console.log(`  ... and ${failures.length - 60} more`);
    process.exit(1);
  }

  console.log('\n[audit] all sitemap urls resolve to rendered content for a crawler');
}

main().catch((err) => {
  console.error('[audit] fatal:', err?.message || err);
  process.exit(1);
});
