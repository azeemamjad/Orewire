const { STATUS } = require('./constants');
const { buildWorkerPlans, getPoolCounts, maskProxyForApi, refreshProxyCache } = require('./proxies');
const { clearQueue } = require('./worker-queue');
const { launchSession, describeEngine } = require('./engines');
const { createScreen } = require('./screen');
const { forceKillBrowser } = require('./browser-kill');
const { resolveRelayHeadless } = require('./env');

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
      engine: w.engine || null,
      driver: w.driver || null,
      channel: w.channel || null,
      headless: w.headless ?? null,
      timezone: w.geo?.timezoneId || null,
    }));
  }

  getWorker(id) {
    return this.workers.get(id) || null;
  }

  /** True only if the worker's Chromium is alive and usable right now. */
  isWorkerHealthy(id) {
    const w = typeof id === 'string' ? this.workers.get(id) : id;
    try {
      // A persistent context has no Browser handle — Playwright returns null from
      // context.browser() for launchPersistentContext — so health is judged from
      // the context and page. `cdp` is deliberately not required: Camoufox
      // workers are Firefox and never have one.
      return !!(
        w &&
        w.context && !w._closed &&
        w.page && !w.page.isClosed()
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

    const entry = {
      id,
      label,
      status: STATUS.STARTING,
      url: url || 'about:blank',
      viewport: { width: 1366, height: 768 },
      startedAt: new Date().toISOString(),
      browser: null,
      context: null,
      page: null,
      cdp: null,
      screen: null,
      engine: null,
      driver: null,
      channel: null,
      headless: null,
      profileDir: null,
      geo: null,
      supportsCdp: false,
      lastError: null,
      viewerCount: 0,
      proxy: proxy || null,
      navGen: 0,
      busy: false,
      currentTask: null,
    };
    this.workers.set(id, entry);

    try {
      // Everything about *how* the browser is launched — which engine, real
      // Chrome vs bundled Chromium, persistent profile, headed vs headless,
      // locale/timezone matched to the proxy's exit IP — lives in relay/engines.
      // The pool only cares that it gets a usable page back.
      const session = await launchSession({
        workerId: id,
        proxy: proxy || null,
        headless: resolveRelayHeadless(),
      });

      entry.context = session.context;
      entry.page = session.page;
      entry.cdp = session.cdp;
      entry.browser = session.browser;
      entry.browserPid = session.pid;
      entry.viewport = session.viewport;
      entry.engine = session.engine;
      entry.driver = session.driver;
      entry.channel = session.channel;
      entry.headless = session.headless;
      entry.profileDir = session.profileDir;
      entry.geo = session.geo;
      entry.supportsCdp = session.supportsCdp;
      entry.screen = createScreen(entry);

      // A persistent context emits 'close' where a Browser emits 'disconnected'.
      // Same meaning: the browser is gone, stop handing it out.
      session.context.on('close', () => {
        if (this.workers.get(id) !== entry) return;
        entry._closed = true;
        entry.status = STATUS.ERROR;
        entry.lastError = entry.lastError || 'browser closed';
        entry.busy = false;
        entry.currentTask = null;
        // Kill the OS process and drop driver refs — don't leave RAM-eating zombies.
        setImmediate(() => {
          this.purgeWorkerResources(id, { reason: entry.lastError }).catch((err) => {
            console.error(`[Relay] Failed to purge ${id} after close: ${err.message}`);
          });
        });
      });

      const syncUrl = () => {
        try {
          entry.url = session.page.url();
        } catch {
          /* ignore */
        }
      };
      session.page.on('framenavigated', (frame) => {
        if (frame === session.page.mainFrame()) syncUrl();
      });
      session.page.on('load', syncUrl);

      entry.status = status;

      // Normalise the start page: a persistent Chrome profile can open on
      // chrome://newtab, which would show up as the worker's "live page".
      // Skip the navigation when the page is already there — a freshly launched
      // Camoufox context is still navigating to about:blank at this point, and a
      // second goto to the same URL is rejected as an interrupted navigation.
      const target = url && url !== 'about:blank' ? url : 'about:blank';
      const current = session.page.url();
      if (target !== 'about:blank' || !/^(about:blank)?$/.test(current)) {
        await session.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120000 });
      }
      entry.url = session.page.url();

      const proxyTag = proxy?.label || 'direct';
      const geoTag = session.geo?.timezoneId ? ` tz=${session.geo.timezoneId}` : '';
      console.log(
        `[Relay] ${id} (${label}) ready — ${session.engine}/${session.channel} `
        + `${session.headless ? 'headless' : 'headed'} — ${proxyTag}${geoTag} → ${entry.url}`,
      );
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
    if (this._starting) return { workers: this.listWorkers(), errors: [] };
    this._starting = true;
    try {
      await refreshProxyCache();
      const engineInfo = describeEngine();
      console.log(
        `[Relay] Engine: ${engineInfo.engine} via ${engineInfo.driver}`
        + `${engineInfo.patched ? '' : ' (UNPATCHED — expect bot walls)'}`
        + `${engineInfo.chromeChannel ? ` channel=${engineInfo.chromeChannel}` : ''}`,
      );
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
      const spawnErrors = [];
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
      const results = await Promise.allSettled(tasks);
      for (const r of results) {
        if (r.status === 'rejected') {
          const msg = r.reason?.message || String(r.reason);
          spawnErrors.push(msg);
          console.error('[Relay] Worker spawn failed:', msg);
        }
      }
      await this.sweepZombieWorkers();
      this.startZombieSweep();
      const { total } = getPoolCounts();
      const healthy = [...this.workers.keys()].filter((id) => this.isWorkerHealthy(id)).length;
      console.log(`[Relay] Pool started — ${healthy}/${total} workers healthy (${this.workers.size} slots)`);
      if (healthy === 0 && spawnErrors.length > 0) {
        throw new Error(spawnErrors.join(' | '));
      }
      return { workers: this.listWorkers(), errors: spawnErrors };
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
    // Abort an in-flight (possibly hung) navigation immediately, before we try
    // page-level calls that could otherwise block behind it. CDP does this
    // out-of-band on Chromium; the Firefox path falls back to window.stop().
    try { await w.screen?.stopLoading(); } catch { /* ignore */ }
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
    const context = w.context;
    const pid = w.browserPid;
    try {
      try { if (w.cdp) w.cdp.removeAllListeners(); } catch { /* ignore */ }
      try { await w.screen?.pause(); } catch { /* ignore */ }
      try {
        if (w.page && !w.page.isClosed()) {
          await withTimeout(w.page.close(), CLOSE_TIMEOUT_MS);
        }
      } catch { /* ignore */ }
      await forceKillBrowser({ browser, context, pid });
      w.browser = null;
      w.context = null;
      w.page = null;
      w.cdp = null;
      w.screen = null;
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
    const context = w.context;
    const pid = w.browserPid;
    try { await w.screen?.pause(); } catch { /* ignore */ }
    try {
      if (w.page && !w.page.isClosed()) {
        await withTimeout(w.page.close(), CLOSE_TIMEOUT_MS);
      }
    } catch { /* ignore */ }
    await forceKillBrowser({ browser, context, pid });
    w.browser = null;
    w.context = null;
    w.page = null;
    w.cdp = null;
    w.screen = null;
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
