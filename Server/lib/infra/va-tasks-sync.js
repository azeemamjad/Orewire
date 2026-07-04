const db = require('../../db');
const { state } = require('../../pipeline/state');
const { entrySource } = require('./log-sources');
const { getAllJobs } = require('./job-tracker');

const LOG_WINDOW_MS = 6 * 60 * 60 * 1000;

const MODULE_LABELS = {
  relay: 'Relay browsers',
  'transfer-agents': 'Transfer agents',
  'filing-pipeline': 'Main filings pipeline',
  'asx-pipeline': 'ASX filings pipeline',
  profiles: 'Company profiles',
  news: 'News pipeline',
  seeders: 'Company seeders',
  scheduler: 'Schedulers',
  system: 'System jobs',
  contact: 'Contact inbox',
  filings: 'Filings analysis',
  scraper: 'Manual scraper',
  companies: 'Company data',
};

function classifyError(msg) {
  const m = String(msg || '').toLowerCase();
  if (/429|rate.?limit|too many requests/.test(m)) return 'rate_limit';
  if (/captcha|needs_human|bot wall|perimeterx|incapsula|cloudflare|validate\.perfdrive/.test(m)) return 'captcha';
  if (/navigationblocked|navigation blocked|blocked.*http/.test(m)) return 'navigation_blocked';
  if (/relay scrape failed/.test(m)) return 'relay_failure';
  if (/\bexit \d+\b/.test(m)) return 'process_exit';
  if (/\bfatal\b/.test(m)) return 'fatal';
  if (/spawn error/.test(m)) return 'spawn_error';
  if (/analysis error|parse error|db save failed/.test(m)) return 'analysis_error';
  return 'error';
}

const ERROR_LABELS = {
  needs_human: 'Captcha / human verification needed',
  worker_error: 'Relay worker error',
  rate_limit: 'Rate limited (429)',
  captcha: 'Captcha / bot wall',
  navigation_blocked: 'Navigation blocked (HTTP error)',
  relay_failure: 'Relay scrape failed',
  process_exit: 'Process exited with error',
  fatal: 'Fatal error',
  spawn_error: 'Failed to start process',
  analysis_error: 'Filing analysis error',
  error: 'Scraper / pipeline error',
  stale_job: 'Stale background job',
  failed_job: 'Failed background job',
  unread_messages: 'Unread contact messages',
  pending_analysis: 'Filings awaiting AI analysis',
  missing_people: 'Companies missing managers/directors',
  symbol_invalid: 'Invalid or stale ticker symbol',
};

function moduleLabel(module) {
  return MODULE_LABELS[module] || module;
}

function errorLabel(errorType) {
  return ERROR_LABELS[errorType] || errorType;
}

function getRelayWorkers() {
  try {
    const { pool } = require('../../relay/pool');
    return pool.listWorkers();
  } catch {
    return [];
  }
}

function collectPipelineErrors() {
  const cutoff = Date.now() - LOG_WINDOW_MS;
  const groups = new Map();

  for (const entry of state.logs) {
    if (entry.level !== 'err' || entry.t < cutoff) continue;
    const source = entrySource(entry);
    const errorType = classifyError(entry.msg);
    const key = `${source}|${errorType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { module: source, errorType, count: 1, sample: entry.msg });
    }
  }

  return [...groups.values()];
}

async function collectActiveTasks() {
  const tasks = [];
  const workers = getRelayWorkers();
  const needsHuman = workers.filter((w) => w.status === 'needs_human');
  if (needsHuman.length) {
    const sample = needsHuman.map((w) => `${w.label}: ${w.url || 'unknown page'}`).join('; ');
    tasks.push({
      sourceKey: 'relay|needs_human',
      module: 'relay',
      errorType: 'needs_human',
      title: 'Solve captcha in Relay View',
      description: `${needsHuman.length} browser worker(s) paused for human verification. Open Relay View, complete the challenge, then mark active.`,
      actionUrl: '/admin/relay.html',
      severity: 'critical',
      occurrenceCount: needsHuman.length,
      sampleDetail: sample.slice(0, 500),
    });
  }

  const errored = workers.filter((w) => w.status === 'error');
  if (errored.length) {
    const sample = errored.map((w) => `${w.label}: ${w.lastError || 'unknown error'}`).join('; ');
    tasks.push({
      sourceKey: 'relay|worker_error',
      module: 'relay',
      errorType: 'worker_error',
      title: 'Relay worker needs respawn',
      description: `${errored.length} worker(s) in error state. Check last error and respawn the browser.`,
      actionUrl: '/admin/relay.html',
      severity: 'high',
      occurrenceCount: errored.length,
      sampleDetail: sample.slice(0, 500),
    });
  }

  const staleJobs = getAllJobs().filter((j) => j.status === 'stale');
  if (staleJobs.length) {
    tasks.push({
      sourceKey: 'system|stale_job',
      module: 'system',
      errorType: 'stale_job',
      title: 'Clear stale background jobs',
      description: `${staleJobs.length} job(s) marked stale (process died). Review on System page and clear or restart.`,
      actionUrl: '/admin/processes.html',
      severity: 'high',
      occurrenceCount: staleJobs.length,
      sampleDetail: staleJobs.map((j) => j.label || j.id).join(', ').slice(0, 500),
    });
  }

  const failedJobs = getAllJobs().filter((j) => j.status === 'failed');
  if (failedJobs.length) {
    tasks.push({
      sourceKey: 'system|failed_job',
      module: 'system',
      errorType: 'failed_job',
      title: 'Review failed background jobs',
      description: `${failedJobs.length} job(s) failed recently. Check pipeline logs and restart if needed.`,
      actionUrl: '/admin/processes.html',
      severity: 'medium',
      occurrenceCount: failedJobs.length,
      sampleDetail: failedJobs.map((j) => j.label || j.id).join(', ').slice(0, 500),
    });
  }

  try {
    const unread = await db.query(
      `SELECT COUNT(*)::int AS count FROM contact_messages WHERE read_at IS NULL`,
    );
    const count = unread.rows[0]?.count || 0;
    if (count > 0) {
      tasks.push({
        sourceKey: 'contact|unread_messages',
        module: 'contact',
        errorType: 'unread_messages',
        title: 'Reply to contact form messages',
        description: `${count} unread message(s) from the public Contact page.`,
        actionUrl: '/admin/contact-messages.html',
        severity: count >= 5 ? 'high' : 'medium',
        occurrenceCount: count,
        sampleDetail: null,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const pending = await db.query(
      `SELECT COUNT(*)::int AS count FROM filings WHERE analyzed = 0 OR analyzed IS NULL`,
    );
    const count = pending.rows[0]?.count || 0;
    if (count >= 25) {
      tasks.push({
        sourceKey: 'filings|pending_analysis',
        module: 'filings',
        errorType: 'pending_analysis',
        title: 'Large backlog of unanalyzed filings',
        description: `${count} filing(s) still pending AI analysis. Check pipeline or Run Scraper.`,
        actionUrl: '/admin/filings.html',
        severity: count >= 100 ? 'high' : 'medium',
        occurrenceCount: count,
        sampleDetail: null,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const missing = await db.query(`
      SELECT COUNT(*)::int AS count FROM companies c
      WHERE NOT EXISTS (SELECT 1 FROM company_people p WHERE p.company_id = c.id)
    `);
    const count = missing.rows[0]?.count || 0;
    if (count >= 10) {
      tasks.push({
        sourceKey: 'companies|missing_people',
        module: 'companies',
        errorType: 'missing_people',
        title: 'Companies missing managers/directors',
        description: `${count} companies have no officers listed. Enrich via pipeline or edit manually.`,
        actionUrl: '/admin/companies.html?missing=people',
        severity: 'low',
        occurrenceCount: count,
        sampleDetail: null,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const flagged = await db.query(`
      SELECT id, name, exchange, ticker, symbol_flagged_reason, symbol_flagged_tv_symbol
        FROM companies
       WHERE symbol_flagged_at IS NOT NULL
       ORDER BY symbol_flagged_at DESC NULLS LAST
       LIMIT 20
    `);
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM companies WHERE symbol_flagged_at IS NOT NULL`,
    );
    const count = countRes.rows[0]?.count || 0;
    if (count > 0) {
      const sample = flagged.rows
        .map((row) => {
          const ex = row.exchange || '';
          const tk = row.ticker || '';
          return `${row.name} (${ex}:${tk})`;
        })
        .join('; ');
      tasks.push({
        sourceKey: 'companies|symbol_invalid',
        module: 'companies',
        errorType: 'symbol_invalid',
        title: 'Invalid or stale ticker symbols',
        description: `${count} compan${count === 1 ? 'y has' : 'ies have'} flagged TradingView symbols. Open Companies → Market Symbols to fix.`,
        actionUrl: '/admin/market-symbols.html',
        severity: count >= 50 ? 'high' : 'medium',
        occurrenceCount: count,
        sampleDetail: sample.slice(0, 500) || null,
      });
    }
  } catch {
    /* ignore */
  }

  for (const group of collectPipelineErrors()) {
    if (group.count < 1) continue;
    const modLabel = moduleLabel(group.module);
    const errLabel = errorLabel(group.errorType);
    const actionUrls = {
      relay: '/admin/relay.html',
      'transfer-agents': '/admin/pipeline.html?tab=logs&log=transfer-agents',
      'filing-pipeline': '/admin/pipeline.html',
      'asx-pipeline': '/admin/pipeline.html',
      profiles: '/admin/pipeline.html?tab=logs&log=profiles',
      news: '/admin/pipeline.html',
      seeders: '/admin/import.html',
      scheduler: '/admin/pipeline.html',
      system: '/admin/processes.html',
      scraper: '/admin/scraper.html',
    };
    const severity = group.errorType === 'captcha' || group.errorType === 'rate_limit'
      ? 'high'
      : group.errorType === 'fatal' ? 'critical' : 'medium';

    tasks.push({
      sourceKey: `${group.module}|${group.errorType}`,
      module: group.module,
      errorType: group.errorType,
      title: `${modLabel}: ${errLabel}`,
      description: `${group.count} matching error(s) in the last 6 hours. One task per module — check logs for details.`,
      actionUrl: actionUrls[group.module] || '/admin/pipeline.html',
      severity,
      occurrenceCount: group.count,
      sampleDetail: group.sample?.slice(0, 500) || null,
    });
  }

  return tasks;
}

async function upsertAutoTask(task) {
  await db.query(
    `INSERT INTO va_tasks (
       source_key, module, error_type, title, description, action_url, severity,
       occurrence_count, sample_detail, auto_managed, status, first_seen_at, last_seen_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 'open', NOW(), NOW())
     ON CONFLICT (source_key) DO UPDATE SET
       module = EXCLUDED.module,
       error_type = EXCLUDED.error_type,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       action_url = EXCLUDED.action_url,
       severity = EXCLUDED.severity,
       occurrence_count = EXCLUDED.occurrence_count,
       sample_detail = EXCLUDED.sample_detail,
       last_seen_at = NOW(),
       status = CASE
         WHEN va_tasks.status = 'dismissed' THEN va_tasks.status
         WHEN va_tasks.status IN ('done', 'resolved') AND va_tasks.auto_managed THEN 'open'
         ELSE va_tasks.status
       END,
       resolved_at = CASE
         WHEN va_tasks.status IN ('done', 'resolved') AND va_tasks.auto_managed THEN NULL
         ELSE va_tasks.resolved_at
       END,
       resolved_by = CASE
         WHEN va_tasks.status IN ('done', 'resolved') AND va_tasks.auto_managed THEN NULL
         ELSE va_tasks.resolved_by
       END`,
    [
      task.sourceKey,
      task.module,
      task.errorType,
      task.title,
      task.description,
      task.actionUrl,
      task.severity,
      task.occurrenceCount,
      task.sampleDetail,
    ],
  );
}

async function resolveAutoTask(sourceKey) {
  await db.query(
    `UPDATE va_tasks
     SET status = 'resolved', resolved_at = NOW(), resolved_by = 'system'
     WHERE source_key = $1 AND auto_managed = TRUE AND status IN ('open', 'in_progress')`,
    [sourceKey],
  );
}

async function syncVaTasks() {
  const active = await collectActiveTasks();
  const activeKeys = active.map((t) => t.sourceKey);

  for (const task of active) {
    await upsertAutoTask(task);
  }

  // Resolve auto tasks that are no longer active (includes legacy per-company
  // keys like companies|symbol_invalid|<id> once we only keep the aggregate key).
  if (activeKeys.length) {
    await db.query(
      `UPDATE va_tasks
       SET status = 'resolved', resolved_at = NOW(), resolved_by = 'system'
       WHERE auto_managed = TRUE
         AND status IN ('open', 'in_progress')
         AND NOT (source_key = ANY($1::text[]))`,
      [activeKeys],
    );
  } else {
    await db.query(
      `UPDATE va_tasks
       SET status = 'resolved', resolved_at = NOW(), resolved_by = 'system'
       WHERE auto_managed = TRUE AND status IN ('open', 'in_progress')`,
    );
  }

  // Explicit cleanup of legacy one-row-per-company ticker tasks.
  await db.query(
    `UPDATE va_tasks
     SET status = 'resolved', resolved_at = NOW(), resolved_by = 'system'
     WHERE auto_managed = TRUE
       AND status IN ('open', 'in_progress')
       AND source_key LIKE 'companies|symbol_invalid|%'
       AND source_key <> 'companies|symbol_invalid'`,
  );

  return { synced: active.length, activeKeys };
}

module.exports = {
  syncVaTasks,
  upsertAutoTask,
  resolveAutoTask,
  moduleLabel,
  errorLabel,
  classifyError,
};
