const MAX_LOGS = 2000;

const state = {
  status: 'idle',          // idle | running | stopping
  startedAt: null,
  stoppedAt: null,
  currentPhase: null,      // 'seeding' | 'scraping' | 'analyzing' | 'syncing'
  progress: { total: 0, done: 0, errors: 0 },
  analysisProgress: { total: 0, done: 0, errors: 0 },
  logs: [],
  stopRequested: false,
};

function addLog(level, msg) {
  const lines = String(msg).split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (state.logs.length >= MAX_LOGS) state.logs.shift();
    state.logs.push({ t: Date.now(), level, msg: line });
  }
}

module.exports = { state, addLog };
