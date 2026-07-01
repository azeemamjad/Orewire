const { getChromium } = require('./playwright');
const { STATUS } = require('./constants');
const { buildWorkerPlans, getPoolCounts, maskProxyForApi, refreshProxyCache } = require('./proxies');
const { clearQueue } = require('./worker-queue');
const { STEALTH_INIT, applyStealthIdentity, randomViewport } = require('./stealth');
const { forceKillBrowser } = require('./browser-kill');

const CLOSE_TIMEOUT_MS = 4000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

class RelayPool {
  constructor() {
    /** @type {Map<string, object>} */
    this.workers = new Map();
    this._starting = false;
    this._sweepTimer = null;
  }

  isStarting() {
    return this._starting;
  }

  /** Read the tab’s current URL from Playwright (keeps admin “live page” accurate). */
  syncWorkerUrl(entry) {
    if (!entry?.page) return entry?.url || 'about:blank';
    try {
      entry.url = entry.page.url();
    } catch {
      /* page may be closing */
    }
    return entry.url;
  }

  listWorkers() {
    return [...this.workers.values()].map((w) => ({
      id: w.id,
      label: w.label,
      status: w.status,
      url: this.syncWorkerUrl(w),
      viewport: w.viewport,
      startedAt: w.startedAt,
      lastError: w.lastError || null,
      viewers: w.viewerCount || 0,
      busy: !!w.busy,
      currentTask: w.currentTask || null,
      proxy: maskProxyForApi(w.proxy),
    }));
  }

  getWorker(id) {
    return this.workers.get(id) || null;
  }

  /** True only if the worker's Chromium is alive and usable right now. */
  isWorkerHealthy(id) {
    const w = typeof id === 'string' ? this.workers.get(id) : id;
    try {
      return !!(
        w &&
        w.browser && w.browser.isConnected() &&
        w.page && !w.page.isClosed() &&
        w.cdp
      );
    } catch {
      return false;
    }
  }

  /** Tear a worker down and start it again from its deterministic plan. */
  async respawnWorker(id) {
    await refreshProxyCache();
    const plan = buildWorkerPlans().find((p) => p.id === id);
    if (!plan) throw new Error(`No worker plan for ${id}`);
    const prev = this.workers.get(id);
    if (prev?.busy) {
      prev.busy = false;
      prev.currentTask = null;
    }
    await this.closeWorker(id);
    return this.spawnWorker({
      id: plan.id,
      label: plan.label,
      url: plan.url,
      status: STATUS.ACTIVE,
      proxy: plan.proxy,
    });
  }

  /**
   * Respawn when Chromium died but the worker entry is still in the map
   * (status error / "browser disconnected"). Safe to call before Relay View.
   */
  async ensureWorkerHealthy(id, opts = {}) {
    const w = this.getWorker(id);
    if (w && this.isWorkerHealthy(id)) return w;
    if (w?.busy && !opts.force) {
      throw new Error(
        `Worker ${id} browser died during a task — stop the task first, then respawn`,
      );
    }
    console.log(
      `[Relay] Respawning unhealthy worker ${id}${w?.lastError ? ` (${w.lastError})` : ''}`,
    );
    return this.respawnWorker(id);
  }

  async spawnWorker({ id, label, url, status = STATUS.ACTIVE, proxy }) {
    if (this.workers.has(id)) {
      throw new Error(`Worker ${id} already exists`);
    }

    const chromium = getChromium();
    // Randomise the window size per worker — a fixed viewport across every
    // session is itself a weak fingerprint.
    const viewport = randomViewport();

    const entry = {
      id,
      label,
      status: STATUS.STARTING,
      url: url || 'about:blank',
      viewport,
      startedAt: new Date().toISOString(),
      browser: null,
      context: null,
      page: null,
      cdp: null,
      lastError: null,
      viewerCount: 0,
      proxy: proxy || null,
      navGen: 0,
      busy: false,
      currentTask: null,
    };
    this.workers.set(id, entry);

    try {
      const launchOpts = {
        headless: process.env.RELAY_HEADLESS !== 'false',
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
        // Drop the "Chrome is being controlled by automated test software" switch,
        // which sets navigator.webdriver and other automation tells.
        ignoreDefaultArgs: ['--enable-automation'],
      };

      const contextOpts = {
        acceptDownloads: true,
        viewport,
        locale: process.env.LOCALE || 'en-US',
        timezoneId: process.env.TIMEZONE || 'America/Toronto',
      };

      if (proxy?.server) {
        contextOpts.proxy = { server: proxy.server };
        if (proxy.username) contextOpts.proxy.username = proxy.username;
        if (proxy.password) contextOpts.proxy.password = proxy.password;
      }

      const browser = await chromium.launch(launchOpts);

      // A crashed/closed browser must not keep being handed out as if healthy.
      // Flag the entry so the manager respawns it on the next acquire.
      try {
        entry.browserPid = browser.process()?.pid || null;
      } catch {
        entry.browserPid = null;
      }

      browser.on('disconnected', () => {
        if (this.workers.get(id) !== entry) return;
        entry.status = STATUS.ERROR;
        entry.lastError = entry.lastError || 'browser disconnected';
        entry.busy = false;
        entry.currentTask = null;
        // Kill the OS process and drop Playwright refs — don't leave RAM-eating zombies.
        setImmediate(() => {
          this.purgeWorkerResources(id, { reason: entry.lastError }).catch((err) => {
            console.error(`[Relay] Failed to purge ${id} after disconnect: ${err.message}`);
          });
        });
      });

      // Pin the UA major version to the *actual* browser build so UA / engine /
      // client-hints stay consistent (a mismatch is an instant bot signal), and
      // strip the "HeadlessChrome" token Playwright leaks in headless mode.
      let realVersion = '124.0.0.0';
      try { realVersion = browser.version() || realVersion; } catch { /* ignore */ }
      const major = String(realVersion.split('.')[0] || '124');
      const ua = process.env.USER_AGENT ||
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
      contextOpts.userAgent = ua;

      const context = await browser.newContext(contextOpts);
      await context.addInitScript(STEALTH_INIT);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      // Apply UA + matching Sec-CH-UA client hints at the network layer.
      await applyStealthIdentity(cdp, browser, { userAgent: ua });

      const syncUrl = () => {
        try {
          entry.url = page.url();
        } catch {
          /* ignore */
        }
      };
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) syncUrl();
      });
      page.on('load', syncUrl);

      entry.browser = browser;
      entry.context = context;
      entry.page = page;
      entry.cdp = cdp;
      entry.browserPid = entry.browserPid || null;
      entry.status = status;

      if (url && url !== 'about:blank') {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        entry.url = page.url();
      } else {
        entry.url = 'about:blank';
      }

      const proxyTag = proxy?.label || 'direct';
      console.log(`[Relay] ${id} (${label}) ready — ${proxyTag} → ${entry.url}`);
      return entry;
    } catch (err) {
      entry.status = STATUS.ERROR;
      entry.lastError = err.message;
      await this.closeWorker(id).catch(() => {});
      throw err;
    }
  }

  /** Start full pool: one browser per enabled DB proxy + direct worker */
  async startPool() {
    if (this._starting) return this.listWorkers();
    this._starting = true;
    try {
      await refreshProxyCache();
      const plans = buildWorkerPlans();
      if (!plans.length) {
        throw new Error('Relay pool size is 0 — add enabled proxies in Admin → Proxies');
      }

      const planIds = new Set(plans.map((p) => p.id));
      for (const id of [...this.workers.keys()]) {
        if (!planIds.has(id)) {
          await this.closeWorker(id);
        }
      }

      const tasks = [];
      for (const plan of plans) {
        const existing = this.workers.get(plan.id);
        if (existing && this.isWorkerHealthy(plan.id)) continue;
        if (existing) {
          tasks.push(this.respawnWorker(plan.id));
        } else {
          tasks.push(
            this.spawnWorker({
              id: plan.id,
              label: plan.label,
              url: plan.url,
              status: STATUS.ACTIVE,
              proxy: plan.proxy,
            }),
          );
        }
      }
      await Promise.all(tasks);
      await this.sweepZombieWorkers();
      this.startZombieSweep();
      const { total } = getPoolCounts();
      console.log(`[Relay] Pool started — ${this.workers.size}/${total} workers`);
      return this.listWorkers();
    } finally {
      this._starting = false;
    }
  }

  async rebuildPool() {
    await this.shutdown();
    await refreshProxyCache();
    return this.startPool();
  }

  /** @deprecated use startPool */
  async startDemoWorkers(count) {
    const { total } = getPoolCounts();
    if (!count || count >= total) return this.startPool();
    const plans = buildWorkerPlans().slice(0, count);
    this._starting = true;
    try {
      await Promise.all(
        plans
          .filter((p) => !this.workers.has(p.id))
          .map((p) =>
            this.spawnWorker({
              id: p.id,
              label: p.label,
              url: p.url,
              status: STATUS.ACTIVE,
              proxy: p.proxy,
            })
          )
      );
      return this.listWorkers();
    } finally {
      this._starting = false;
    }
  }

  setStatus(id, status) {
    const w = this.workers.get(id);
    if (!w) throw new Error('Worker not found');
    const prev = w.status;
    w.status = status;
    // A human marked the worker active again — wake any captcha wait loop.
    if (prev === STATUS.NEEDS_HUMAN && status === STATUS.ACTIVE && typeof w._humanResume === 'function') {
      try { w._humanResume(true); } catch { /* ignore */ }
    }
    return w;
  }

  async attachViewer(id) {
    const w = await this.ensureWorkerHealthy(id);
    if (!w?.page || !w?.cdp) {
      throw new Error('Worker not available after respawn');
    }
    return w;
  }

  /** Abort hung navigation and return to a blank page */
  async resetPage(id) {
    let w = this.workers.get(id);
    if (!w || !this.isWorkerHealthy(id)) {
      w = await this.ensureWorkerHealthy(id);
    }
    if (!w?.page) throw new Error('Worker not found');
    w.navGen = (w.navGen || 0) + 1;
    const { page } = w;
    // CDP stopLoading aborts an in-flight (possibly hung) navigation immediately,
    // before we try page-level calls that could otherwise block behind it.
    try { await w.cdp?.send('Page.stopLoading'); } catch { /* ignore */ }
    try {
      await page.evaluate(() => window.stop()).catch(() => {});
    } catch { /* ignore */ }
    try {
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 20000 });
    } catch (err) {
      w.lastError = err.message;
      throw err;
    }
    w.url = page.url();
    w.lastError = null;
    if (w.status === STATUS.ERROR) w.status = STATUS.ACTIVE;
    console.log(`[Relay] Reset ${id} → ${w.url}`);
    return w;
  }

  incrementViewers(id) {
    const w = this.workers.get(id);
    if (w) w.viewerCount = (w.viewerCount || 0) + 1;
    return w ? w.viewerCount : 0;
  }

  /** @returns {number} viewers remaining after the decrement */
  decrementViewers(id) {
    const w = this.workers.get(id);
    if (!w) return 0;
    if (w.viewerCount > 0) w.viewerCount -= 1;
    return w.viewerCount;
  }

  /**
   * Kill Chromium and null Playwright handles. Keeps the worker slot in the map
   * (status error) so the admin UI still shows it until respawn.
   */
  async purgeWorkerResources(id, opts = {}) {
    const w = this.workers.get(id);
    if (!w || w._purging) return;
    w._purging = true;
    const browser = w.browser;
    const pid = w.browserPid;
    try {
      try { if (w.cdp) w.cdp.removeAllListeners(); } catch { /* ignore */ }
      try {
        if (w.page && !w.page.isClosed()) {
          await withTimeout(w.page.close(), CLOSE_TIMEOUT_MS);
        }
      } catch { /* ignore */ }
      try {
        if (w.context) await withTimeout(w.context.close(), CLOSE_TIMEOUT_MS);
      } catch { /* ignore */ }
      await forceKillBrowser(browser, pid);
      w.browser = null;
      w.context = null;
      w.page = null;
      w.cdp = null;
      w.browserPid = null;
      w.status = STATUS.ERROR;
      w.lastError = opts.reason || w.lastError || 'browser disconnected';
      w.busy = false;
      w.currentTask = null;
      console.log(`[Relay] Purged ${id} — Chromium killed (pid ${pid || 'unknown'})`);
    } finally {
      w._purging = false;
    }
  }

  /** Kill any dead workers that still hold browser refs or orphaned processes. */
  async sweepZombieWorkers() {
    for (const [id, w] of this.workers) {
      if (w._purging) continue;
      if (this.isWorkerHealthy(id)) continue;
      if (w.viewerCount > 0) continue;
      if (w.busy) continue;
      await this.purgeWorkerResources(id).catch(() => {});
    }
  }

  startZombieSweep() {
    if (this._sweepTimer) return;
    const ms = parseInt(process.env.RELAY_ZOMBIE_SWEEP_MS || '30000', 10);
    if (ms <= 0) return;
    this._sweepTimer = setInterval(() => {
      this.sweepZombieWorkers().catch((err) => {
        console.error('[Relay] Zombie sweep failed:', err.message);
      });
    }, ms);
    if (this._sweepTimer.unref) this._sweepTimer.unref();
  }

  stopZombieSweep() {
    if (!this._sweepTimer) return;
    clearInterval(this._sweepTimer);
    this._sweepTimer = null;
  }

  async closeWorker(id) {
    const w = this.workers.get(id);
    if (!w) return;
    this.workers.delete(id);
    clearQueue(id);
    w.busy = false;
    w.currentTask = null;
    const browser = w.browser;
    const pid = w.browserPid;
    try {
      if (w.page && !w.page.isClosed()) {
        await withTimeout(w.page.close(), CLOSE_TIMEOUT_MS);
      }
    } catch { /* ignore */ }
    try {
      if (w.context) await withTimeout(w.context.close(), CLOSE_TIMEOUT_MS);
    } catch { /* ignore */ }
    await forceKillBrowser(browser, pid);
    w.browser = null;
    w.context = null;
    w.page = null;
    w.cdp = null;
    w.browserPid = null;
  }

  async shutdown() {
    this.stopZombieSweep();
    const ids = [...this.workers.keys()];
    await Promise.all(ids.map((id) => this.closeWorker(id)));
  }
}

const pool = new RelayPool();

module.exports = { RelayPool, pool };
