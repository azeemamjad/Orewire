'use strict';

/**
 * IndexNow submission.
 *
 * Bing, Yandex, Seznam and Naver share a single IndexNow endpoint. Bing is the
 * one that matters most here: it backs Copilot and is the index that several
 * chat products lean on, so getting a fresh company profile into Bing quickly is
 * a direct route to being answerable. Google does not participate in IndexNow,
 * so this is a supplement to the sitemap, never a replacement.
 *
 * The protocol requires a key file at the site root containing the key:
 *
 *   https://www.orewire.com/<key>.txt   ->   <key>
 *
 * Set INDEXNOW_KEY to enable. Without it, every function here is a no-op, so
 * nothing breaks in an environment that has not been configured.
 *
 * Key rules: 8 to 128 characters, only a-z A-Z 0-9 and dashes.
 */

const { siteOrigin, absoluteUrl } = require('./util');

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS_PER_REQUEST = 10000;
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

/** The configured key, or an empty string. */
function key() {
  return String(process.env.INDEXNOW_KEY || '').trim();
}

/** True when a well-formed key is configured. */
function enabled() {
  return KEY_PATTERN.test(key());
}

/** Where the key file has to be served from. */
function keyLocation() {
  return absoluteUrl(`/${key()}.txt`);
}

/**
 * Submit one or more URLs. Accepts site relative paths or absolute URLs.
 * Never throws: submission is a best-effort side channel, and a failure must not
 * break whatever job called it.
 */
async function submit(urls) {
  if (!enabled()) {
    return { ok: false, skipped: 'INDEXNOW_KEY is not set or is malformed' };
  }

  const list = (Array.isArray(urls) ? urls : [urls])
    .filter(Boolean)
    .map((u) => absoluteUrl(String(u)))
    .slice(0, MAX_URLS_PER_REQUEST);

  if (!list.length) return { ok: false, skipped: 'no urls supplied' };

  let host;
  try {
    host = new URL(siteOrigin()).host;
  } catch {
    return { ok: false, skipped: 'SITE_ORIGIN is not a valid URL' };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        host,
        key: key(),
        keyLocation: keyLocation(),
        urlList: list,
      }),
    });
    return { ok: res.ok, status: res.status, submitted: list.length, host };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), submitted: 0 };
  }
}

module.exports = {
  ENDPOINT,
  MAX_URLS_PER_REQUEST,
  key,
  enabled,
  keyLocation,
  submit,
};
