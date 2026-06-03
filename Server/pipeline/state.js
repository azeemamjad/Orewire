const fs = require('fs');
const path = require('path');
const { inferLogSource } = require('../lib/log-sources');

const MAX_LOGS = 2000;
const LOG_FILE = path.join(__dirname, '../data/pipeline-logs.jsonl');

const state = {
  status: 'idle',          // idle | running | stopping
  activePipeline: null,    // 'main' | 'asx' | null — which filing pipeline is running
  startedAt: null,
  stoppedAt: null,
  currentPhase: null,      // 'seeding' | 'scraping' | 'analyzing' | 'syncing'
  progress: { total: 0, done: 0, errors: 0 },
  analysisProgress: { total: 0, done: 0, errors: 0 },
  logs: [],
  stopRequested: false,
};

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

module.exports = { state, addLog, restoreLogs };
