/**
 * Pipeline log sources — map log lines to process IDs for filtering.
 */

const SOURCE_CATALOG = [
  { id: 'all', label: 'All logs' },
  { id: 'filing-pipeline', label: 'Main filings (Canada)' },
  { id: 'asx-pipeline', label: 'ASX filings' },
  { id: 'transfer-agents', label: 'Transfer agents (SEDAR+)' },
  { id: 'profiles', label: 'Company profiles' },
  { id: 'news', label: 'News pipeline' },
  { id: 'seeders', label: 'Company seeders' },
  { id: 'scheduler', label: 'Schedulers' },
  { id: 'system', label: 'System / other' },
];

function inferLogSource(msg) {
  const m = String(msg || '');
  if (m.startsWith('[TA]')) return 'transfer-agents';
  if (m.startsWith('[Profiles]')) return 'profiles';
  if (m.startsWith('[News Pipeline]') || m.startsWith('[News]')) return 'news';
  if (m.startsWith('[ASX Pipeline]')) return 'asx-pipeline';
  if (m.startsWith('[Seeder Cron]')) return 'seeders';
  if (m.startsWith('[Scheduler]')) return 'scheduler';
  if (m.startsWith('[Pipeline]') || /^\[W\d+\|/.test(m) || m.startsWith('[Sync]')) return 'filing-pipeline';
  return 'system';
}

function entrySource(entry) {
  return entry?.source || inferLogSource(entry?.msg);
}

function isSourceRunning(id) {
  if (id === 'all') return false;
  const { state } = require('../pipeline/state');
  const { isJobRunning } = require('./job-tracker');

  switch (id) {
    case 'transfer-agents':
      return isJobRunning('transfer-agents');
    case 'profiles': {
      try {
        const { isRunning } = require('../scripts/scrape-profiles');
        return isRunning();
      } catch {
        return isJobRunning('profiles');
      }
    }
    case 'news': {
      try {
        const { isNewsPipelineRunning } = require('./news-pipeline');
        return isNewsPipelineRunning();
      } catch {
        return false;
      }
    }
    case 'filing-pipeline':
      return state.status === 'running' && state.activePipeline === 'main';
    case 'asx-pipeline':
      return state.status === 'running' && state.activePipeline === 'asx';
    default:
      return false;
  }
}

function filterLogs(logs, sourceId) {
  if (!sourceId || sourceId === 'all') return logs;
  return logs.filter((e) => entrySource(e) === sourceId);
}

function getLogSourcesPayload(logs) {
  const counts = {};
  for (const entry of logs) {
    const src = entrySource(entry);
    counts[src] = (counts[src] || 0) + 1;
  }

  const running = [];
  const idle = [];

  for (const def of SOURCE_CATALOG) {
    if (def.id === 'all') continue;
    const runningNow = isSourceRunning(def.id);
    const item = {
      id: def.id,
      label: def.label,
      running: runningNow,
      logCount: counts[def.id] || 0,
    };
    if (runningNow) running.push(item);
    else if (item.logCount > 0) idle.push(item);
  }

  return {
    sources: SOURCE_CATALOG.map((def) => ({
      id: def.id,
      label: def.label,
      running: def.id === 'all' ? false : isSourceRunning(def.id),
      logCount: def.id === 'all' ? logs.length : (counts[def.id] || 0),
    })),
    running,
    idle,
  };
}

module.exports = {
  SOURCE_CATALOG,
  inferLogSource,
  entrySource,
  isSourceRunning,
  filterLogs,
  getLogSourcesPayload,
};
