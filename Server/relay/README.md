# Relay browser stack

How the relay gets a browser past a bot wall, and why it is built this way.

## The short version

The wall on SEDAR+ is Radware / ShieldSquare (it redirects to
`validate.perfdrive.com`). It was never really rejecting the **IP** — it was
rejecting the **browser**. Same machine, same IP, same minute:

| stack | result at the "Documents" step |
|---|---|
| vanilla Playwright + bundled Chromium + headless + faked Windows UA | redirected to `validate.perfdrive.com` |
| patchright + real Chrome + headed + persistent profile | search form renders |

No proxy involved in either run. Reproduce with `npm run relay:test-sedar`.

## What was wrong

1. **Vanilla Playwright leaks before our code runs.** It calls CDP
   `Runtime.enable` to build its isolated world, and walls probe for exactly
   that. No init script can hide a leak that lives in the driver.
2. **The stealth init script was the loudest signal on the page.** It faked
   `navigator.plugins` with a plain `Array`, so
   `Object.prototype.toString.call(navigator.plugins)` returned
   `[object Array]` — a value no real browser has ever reported. It also left an
   own `webdriver` property on the navigator instance (real Chrome inherits it
   from the prototype and nothing shadows it) and replaced
   `WebGLRenderingContext.prototype.getParameter` with a function that no longer
   stringifies to `[native code]`.
3. **Bundled Chromium is not Chrome.** It advertises `HeadlessChrome` in its
   `sec-ch-ua` client hints and ships a different codec and font set. That is
   scored at the header layer, before any JS runs.
4. **The identity contradicted itself.** A Windows UA and Windows client hints
   were pinned onto a Linux host whose fonts, WebGL renderer and platform stayed
   Linux. SEDAR+'s block page echoes the pinned UA straight back in its `sst=`
   parameter.
5. **Timezone never matched the exit IP.** `America/Toronto` was hardcoded for
   every worker regardless of where its proxy actually exited.
6. **Production could not win.** The Dockerfile forced headless bundled
   Chromium, so the deployed relay was in the worst configuration available.

## What it does now

Everything about *how* a browser is launched lives in `relay/engines/`. The pool
and the viewer never branch on the engine — only on `supportsCdp`.

- `engines/driver.js` — loads **patchright** (a drop-in Playwright fork that
  removes the `Runtime.enable` / `Console.enable` / command-flag leaks), warning
  loudly if it has to fall back to vanilla Playwright.
- `engines/chromium.js` — **real Google Chrome**, `headless: false`,
  `launchPersistentContext`, `viewport: null`, no UA override, no extra headers,
  minimal flags. Locale and timezone come from `relay/geo.js`.
- `engines/camoufox.js` — **Camoufox**, a patched Firefox where the
  anti-fingerprint work happens inside the engine. The escape hatch when a
  Chromium stack keeps losing. Slower, and no CDP.
- `relay/geo.js` — asks `ip-api.com` *through the proxy itself* what the world
  sees, so the browser's timezone and locale match its exit IP. Cached per proxy.
- `relay/screen.js` — the viewer transport. CDP screencast on Chromium; polled
  screenshots plus Playwright-level input on Firefox, so the live view and human
  captcha-solving keep working on either engine.
- `relay/stealth.js` — deliberately a no-op now. Read its header before adding
  anything back.

## Configuration

| env | default | meaning |
|---|---|---|
| `RELAY_ENGINE` | `chrome` | `chrome` or `camoufox` |
| `RELAY_DRIVER` | `patchright` | set to `playwright` only to measure the difference |
| `RELAY_HEADLESS` | follows `$DISPLAY` | `true` forces headless; unset runs headed when a display exists |
| `BROWSER_CHANNEL` | auto-detects Chrome | `chromium` to force the bundled build |
| `RELAY_GEO_MATCH` | `true` | `false` reverts to the hardcoded `LOCALE`/`TIMEZONE` |
| `RELAY_PROFILE_DIR` | `Server/data/profiles` | persistent user-data-dirs, one per worker |
| `RELAY_LEGACY_STEALTH` | `false` | restores the old init script (for A/B only) |
| `RELAY_POLL_FPS_MS` | `400` | polled-viewer frame interval (Camoufox) |
| `CAMOUFOX_OS` | random | `windows` / `macos` / `linux`, comma-separated |

Headed is the important one. Headless Chrome differs from headed in ways no init
script reaches, so run under a virtual display rather than going headless:

```bash
./start-headed.sh          # xvfb-run + node index.js
```

The Dockerfile does the same thing (`CMD ["xvfb-run", …]`) and installs real
Chrome at build time.

## Testing

```bash
npm run relay:test-stealth        # fingerprint audit: asserts every signal above
npm run relay:test-sedar          # walks the real SEDAR+ search flow
npm run relay:test-engine         # pool + viewer transport + teardown, end to end
```

All three take `RELAY_ENGINE=camoufox` and `--proxy res`. Run them under
`xvfb-run -a` so the browser is headed, and treat a failure as a real one —
these assert the exact things the wall scores.

## In Docker / Dokploy

The image does four things a plain Node image does not, all of them load-bearing:

- installs **real Google Chrome** (bundled Chromium is rejected at the header layer);
- starts **Xvfb** in `docker-entrypoint.sh` so Chrome runs **headed** — set
  `RELAY_HEADLESS=false` in Dokploy, the old `=true` advice re-breaks scraping;
- passes `--enable-unsafe-swiftshader` when there is no `/dev/dri`, because
  Chrome 126+ otherwise exposes **no WebGL at all** — a much louder signal than
  software rendering;
- `exec`s node as PID 1, so a redeploy's SIGTERM lands on node rather than being
  swallowed by an `xvfb-run` wrapper.

Needs **≥1 GB `/dev/shm`**. Profiles live on the `/app/data` volume, so sessions
survive redeploys. Verify any built image with:

```bash
docker run --rm --shm-size=1g <image> node scripts/test-stealth.js --flow sedar
```

Deployment details: [deploy/DOKPLOY.md](../deploy/DOKPLOY.md).

## Profiles

Each worker keeps a persistent Chrome/Firefox profile under
`Server/data/profiles/<engine>/<worker-id>`. A browser whose storage is empty on
every visit looks nothing like a returning human, and patchright is only fully
patched on the persistent path. The directories hold **live session cookies** and
are gitignored — never commit them. Delete one to burn a session:

```js
require('./relay/engines').resetProfile('relay-proxy-3');
```

## Proxy bandwidth

Residential proxies bill per GB, so this was measured rather than guessed
(`npm run relay:measure-bandwidth -- --flow sedar`, wire bytes via CDP):

| | bytes |
|---|---|
| SEDAR+ search flow, **cold profile** | 2.74 MB (images 56%, scripts 25%, third-party 7.9%) |
| SEDAR+ search flow, **warm profile** | **0.08 MB** — 1.85 MB served from the profile's disk cache |
| One filing PDF | ~130 KB – 2 MB, and PDFs dominate a real run |

Two things follow.

**The persistent profile already won the page-overhead fight.** A warm profile
costs 3% of a cold one. This is why the `/app/data` volume matters: wipe the
profiles and every worker pays full price again on its next run.

**Blocking images/fonts is not worth it.** It is the obvious move and it buys
almost nothing — those bytes are cached after the first visit — while adding a
detection surface, since a browser that fetches no images is not behaving like
the browser it claims to be. Left off deliberately.

**The real cost was re-downloading PDFs.** `downloadPage()` had no dedupe, so a
nightly run over a 30-day window re-fetched ~29 days of documents it already
owned. `lib/scraper/utils/download-ledger.js` now keys each document on
`(issuer, document name, submitted timestamp)` — all three are in the results
table *before* the fetch — and skips what is already held:

```
[SEDAR] Page 1 — 4/4 already downloaded, not re-fetched
[SEDAR] Done — 0 file(s) downloaded (0.00 MB); 1.02 MB skipped as already held
```

The ledger cannot key on the document URL: SEDAR+ hrefs carry session tokens
(`drr=`, `id=`) that are identical across every row and change every session. It
lives at `data/download-ledger.jsonl` (append-only, survives a crash mid-run, and
survives PDF pruning — file existence is not a valid substitute once
`prune-migrated-local-pdfs.js` has run). `DOWNLOAD_LEDGER=false` disables it.

The `source` field makes it reusable for ASX/CSE; only SEDAR is wired up so far.

## Batch behaviour

**One search page, many companies.** The scraper used to walk
home → "Search SEDAR+" → "Documents" for every company. Over a 1571-company run
that is 1571 home-page loads from a single residential IP, which is a pattern in
itself — a real user runs many searches from the same page. SEDAR+ has a
"Clear search criteria" link on the results page that puts the profile input
back; `tryReuseSearchPage()` uses it when the worker is already on a search page,
costing ~32 KB instead of three page loads. Measured over three companies: one
home-page load instead of three, with the correct profile applied each time.

Reuse is skipped automatically whenever the page is not a SEDAR+ search page —
after a bot wall, a crash, or on the local path where each company gets a fresh
context — so a broken state always falls back to the full navigation.
`SEDAR_REUSE_SEARCH=false` disables it.

**Retries and the circuit breaker.** A company gets `PIPELINE_COMPANY_ATTEMPTS`
tries (3) spaced `PIPELINE_RETRY_DELAY_MS` apart (5 min), but only for failures
worth retrying: proxy/network errors, a 403 or perfdrive redirect, a timeout, or
the profile re-render race. "No SEDAR+ profile matches" is permanent — most
companies that fail do so for that reason, and retrying them would burn ten
minutes each for nothing.

The retry wait happens *outside* the relay permit, so a sleeping worker never
holds the single residential slot hostage.

Behind that, `PIPELINE_TRANSPORT_FAILURE_LIMIT` (3) consecutive companies that
exhaust every attempt with **network** errors aborts the run and leaves the rest
of the queue unattempted rather than marked as errors. This exists because a
single dead proxy once produced 1559 identical `ERR_TUNNEL_CONNECTION_FAILED`
errors at roughly one company per second. Note the split: a 403 or bot wall is
retried but does *not* count toward the breaker — that is the site, not the
network.

## If it starts failing again

1. `npm run relay:test-stealth` first — it tells you *which* signal regressed.
2. Update patchright (`npm i patchright@latest && npx patchright install chrome`).
   Every open-source stealth tool needs patching after a Chrome release.
3. Try `RELAY_ENGINE=camoufox`. A different engine family means a wall tuned for
   Chromium automation has much less to grip.
4. Do **not** reach for a new init script. That is what caused this.
