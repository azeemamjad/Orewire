const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { inferLogSource } = require('../lib/log-sources');

const MAX_LOGS = 2000;
const LOG_FILE = path.join(__dirname, '../data/pipeline-logs.jsonl');

/**
 * The Canada and ASX pipelines run at the same time but must not share a status
 * flag. They did, and because both began with `if (state.status === 'running')
 * return;` the second one to start was silently ignored — ASX's 07:00 cron fired
 * while a Canada run was still going and did nothing, all day, every day. They use
 * different transports (Canada is the relay browser, ASX is Markit HTTP) so there
 * was never a resource conflict to guard against.
 *
 * Each pipeline now gets its own run object, and `state` becomes an accessor
 * surface that resolves to whichever run is executing. AsyncLocalStorage carries
 * that through every async call, which matters because the download and analysis
 * workers increment `state.progress`/`state.analysisProgress` from deep inside
 * shared code — passing a scoped object by hand would have meant touching those
 * call sites too.
 */

const RUN_FIELDS = [
  'status',
  'activePipeline',
  'startedAt',
  'stoppedAt',
  'currentPhase',
  'progress',
  'analysisProgress',
  'stopRequested',
];

function createRunState() {
  return {
    status: 'idle', // idle | running | stopping
    activePipeline: null, // 'canada' | 'asx' | null
    startedAt: null,
    stoppedAt: null,
    currentPhase: null, // 'seeding' | 'scraping' | 'analyzing' | 'syncing'
    progress: { total: 0, done: 0, errors: 0 },
    analysisProgress: { total: 0, done: 0, errors: 0 },
    stopRequested: false,
  };
}

/** One independent run slot per filing pipeline. */
const runs = {
  canada: createRunState(),
  asx: createRunState(),
};

const runStore = new AsyncLocalStorage();

/**
 * Run `fn` with `state.*` resolving to this pipeline's run object.
 * Every async call made inside inherits the binding, including the shared workers.
 */
function withPipelineState(name, fn) {
  const run = runs[name];
  if (!run) throw new Error(`Unknown pipeline run: ${name}`);
  return runStore.run(run, fn);
}

/** The first running pipeline, for readers outside any run context. */
function activeRun() {
  return Object.values(runs).find((r) => r.status === 'running') || null;
}

const state = { logs: [] };

for (const field of RUN_FIELDS) {
  Object.defineProperty(state, field, {
    enumerable: true,
    get() {
      const scoped = runStore.getStore();
      if (scoped) return scoped[field];
      // Outside a run: report a running pipeline if there is one so the admin
      // status endpoint keeps answering sensibly, else Canada's idle values.
      const active = activeRun();
      return (active || runs.canada)[field];
    },
    set(value) {
      const target = runStore.getStore() || activeRun() || runs.canada;
      target[field] = value;
    },
  });
}

/** Ask every running pipeline to stop. Returns how many were asked. */
function requestStop() {
  let asked = 0;
  for (const run of Object.values(runs)) {
    if (run.status === 'running') {
      run.stopRequested = true;
      asked += 1;
    }
  }
  return asked;
}

/** A plain snapshot of both runs, for the status endpoint. */
function runsSnapshot() {
  const out = {};
  for (const [name, run] of Object.entries(runs)) {
    out[name] = {
      ...run,
      progress: { ...run.progress },
      analysisProgress: { ...run.analysisProgress },
      running: run.status === 'running',
    };
  }
  return out;
}

function ensureLogDir() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  } catch {
    /* ignore */
  }
}

function addLog(level, msg, source) {
  ensureLogDir();
  const lines = String(msg).split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const entry = {
      t: Date.now(),
      level,
      msg: line,
      source: source || inferLogSource(line),
    };
    if (state.logs.length >= MAX_LOGS) state.logs.shift();
    state.logs.push(entry);
    fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, () => {});
  }
}

/** Reload recent log lines from disk (survives server restarts). */
function restoreLogs() {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) return;
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    state.logs = lines.slice(-MAX_LOGS).map((line) => {
      const entry = JSON.parse(line);
      if (!entry.source) entry.source = inferLogSource(entry.msg);
      return entry;
    });
    if (state.logs.length > 0) {
      console.log(`[Pipeline] Restored ${state.logs.length} log line(s) from disk`);
    }
  } catch (err) {
    console.error('[Pipeline] Log restore failed:', err?.message || err);
  }
}

module.exports = {
  state,
  addLog,
  restoreLogs,
  runs,
  createRunState,
  withPipelineState,
  requestStop,
  runsSnapshot,
};
