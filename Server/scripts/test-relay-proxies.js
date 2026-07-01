#!/usr/bin/env node
/**
 * Test Relay / pipeline proxy endpoints with Playwright.
 * Usage: node scripts/test-relay-proxies.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path = require('path');
const { getDatacenterProxy, getResidentialProxy, getDirectProxy, DC_PORTS } = require('../relay/proxies');

function getChromium() {
  const scraperRoot = path.resolve(process.env.SCRAPER_PATH || path.join(__dirname, '../Scraper'));
  return require(path.join(scraperRoot, 'node_modules', 'playwright')).chromium;
}

const TEST_URL = process.env.RELAY_PROXY_TEST_URL || 'https://example.com/';
const TIMEOUT_MS = parseInt(process.env.RELAY_PROXY_TEST_TIMEOUT_MS || '25000', 10);

async function testProxy(label, proxy) {
  const chromium = getChromium();
  const started = Date.now();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    const contextOpts = {};
    if (proxy?.server) {
      contextOpts.proxy = {
        server: proxy.server,
        username: proxy.username || undefined,
        password: proxy.password || undefined,
      };
    }
    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const title = await page.title();
    const finalUrl = page.url();
    await context.close();
    return {
      label,
      ok: true,
      ms: Date.now() - started,
      title,
      url: finalUrl,
      server: proxy.server,
      username: proxy.username ? proxy.username.replace(/(sessid-)[\w-]+/i, '$1***') : null,
    };
  } catch (err) {
    return {
      label,
      ok: false,
      ms: Date.now() - started,
      error: err.message,
      server: proxy?.server,
      username: proxy?.username ? String(proxy.username).replace(/(sessid-)[\w-]+/i, '$1***') : null,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function testDirect() {
  const chromium = getChromium();
  const started = Date.now();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const title = await page.title();
    return { label: 'Direct (no proxy)', ok: true, ms: Date.now() - started, title, url: page.url() };
  } catch (err) {
    return { label: 'Direct (no proxy)', ok: false, ms: Date.now() - started, error: err.message };
  } finally {
    if (browser) try { await browser.close(); } catch { /* ignore */ }
  }
}

async function main() {
  console.log(`\nRelay proxy test → ${TEST_URL} (timeout ${TIMEOUT_MS}ms)\n`);
  console.log('USE_PROXY=%s  PROXY_SERVER=%s', process.env.USE_PROXY, process.env.PROXY_SERVER);
  console.log('PROXY_SERVER_2=%s\n', process.env.PROXY_SERVER_2 || process.env.Proxy_Server_2);

  const results = [];

  results.push(await testDirect());

  for (let i = 0; i < DC_PORTS.length; i++) {
    const proxy = getDatacenterProxy(i);
    results.push(await testProxy(`DC :${DC_PORTS[i]}`, proxy));
  }

  for (let i = 0; i < 3; i++) {
    const proxy = getResidentialProxy(i);
    results.push(await testProxy(`RES slot ${i + 1}`, proxy));
  }

  const directCount = parseInt(process.env.RELAY_DIRECT_COUNT || '2', 10);
  for (let i = 0; i < directCount; i++) {
    const proxy = getDirectProxy(i);
    results.push(await testProxy(`LOCAL ${i + 1}`, proxy));
  }

  console.log('─'.repeat(72));
  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.label.padEnd(22)} ${String(r.ms).padStart(6)}ms  ${r.title || ''}  ${r.server || ''}`);
    } else {
      console.log(`✗ ${r.label.padEnd(22)} ${String(r.ms).padStart(6)}ms  ${r.error}`);
      if (r.server) console.log(`    ${r.server}  user=${r.username || '(none)'}`);
    }
  }
  console.log('─'.repeat(72));

  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
