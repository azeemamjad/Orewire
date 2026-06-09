const { getChromium } = require('./playwright');
const { STATUS } = require('./constants');
const { buildWorkerPlans, getPoolCounts, maskProxyForApi } = require('./proxies');
const { clearQueue } = require('./worker-queue');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const STEALTH_INIT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: {} };
`;

class RelayPool {
  constructor() {
    /** @type {Map<string, object>} */
    this.workers = new Map();
    this._starting = false;
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

  async spawnWorker({ id, label, url, status = STATUS.ACTIVE, proxy }) {
    if (this.workers.has(id)) {
      throw new Error(`Worker ${id} already exists`);
    }

    const chromium = getChromium();
    const viewport = { width: 1280, height: 900 };

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
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      };

      const contextOpts = {
        acceptDownloads: true,
        viewport,
        userAgent: process.env.USER_AGENT || DEFAULT_UA,
        locale: process.env.LOCALE || 'en-US',
        timezoneId: process.env.TIMEZONE || 'America/Toronto',
      };

      if (proxy?.server) {
        contextOpts.proxy = { server: proxy.server };
        if (proxy.username) contextOpts.proxy.username = proxy.username;
        if (proxy.password) contextOpts.proxy.password = proxy.password;
      }

      const browser = await chromium.launch(launchOpts);
      const context = await browser.newContext(contextOpts);
      await context.addInitScript(STEALTH_INIT);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);

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

  /** Start full pool: 5 datacenter + 3 residential (configurable via env) */
  async startPool() {
    if (this._starting) return this.listWorkers();
    this._starting = true;
    try {
      const plans = buildWorkerPlans();
      if (!plans.length) {
        throw new Error('Relay pool size is 0 — check RELAY_DATACENTER_COUNT / RELAY_RESIDENTIAL_COUNT');
      }

      const tasks = [];
      for (const plan of plans) {
        if (this.workers.has(plan.id)) continue;
        tasks.push(
          this.spawnWorker({
            id: plan.id,
            label: plan.label,
            url: plan.url,
            status: STATUS.ACTIVE,
            proxy: plan.proxy,
          })
        );
      }
      await Promise.all(tasks);
      const { total } = getPoolCounts();
      console.log(`[Relay] Pool started — ${this.workers.size}/${total} workers`);
      return this.listWorkers();
    } finally {
      this._starting = false;
    }
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
    w.status = status;
    return w;
  }

  async attachViewer(id) {
    const w = this.workers.get(id);
    if (!w || !w.page || !w.cdp) throw new Error('Worker not available');
    return w;
  }

  /** Abort hung navigation and return to a blank page */
  async resetPage(id) {
    const w = this.workers.get(id);
    if (!w?.page) throw new Error('Worker not found');
    w.navGen = (w.navGen || 0) + 1;
    const { page } = w;
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

  async closeWorker(id) {
    const w = this.workers.get(id);
    if (!w) return;
    this.workers.delete(id);
    clearQueue(id);
    try {
      if (w.context) await w.context.close();
    } catch { /* ignore */ }
    try {
      if (w.browser) await w.browser.close();
    } catch { /* ignore */ }
  }

  async shutdown() {
    const ids = [...this.workers.keys()];
    await Promise.all(ids.map((id) => this.closeWorker(id)));
  }
}

const pool = new RelayPool();

module.exports = { RelayPool, pool };
