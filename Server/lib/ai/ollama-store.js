const db = require('../../db');
const { retentionDays } = require('../usage-log-retention');

let _cache = { provider: null, loadedAt: 0 };

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function maskApiKey(key) {
  if (!key) return null;
  const s = String(key);
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function envFallbackProvider() {
  const host = process.env.OLLAMA_HOST;
  const apiKey = process.env.OLLAMA_API_KEY;
  const model = process.env.OLLAMA_MODEL;
  if (!host && !apiKey && !model) return null;
  return {
    id: null,
    name: 'Ollama (env fallback)',
    provider: 'ollama',
    host: stripTrailingSlash(host || 'https://ollama.com'),
    api_key: apiKey || null,
    default_model: model || 'kimi',
    enabled: true,
    request_count: 0,
    error_count: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    _fromEnv: true,
  };
}

function formatProviderRow(row, { includeApiKey = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    host: row.host,
    apiKey: includeApiKey ? row.api_key : maskApiKey(row.api_key),
    apiKeySet: !!row.api_key,
    defaultModel: row.default_model,
    enabled: row.enabled,
    requestCount: row.request_count,
    errorCount: row.error_count,
    promptTokens: Number(row.prompt_tokens) || 0,
    completionTokens: Number(row.completion_tokens) || 0,
    lastUsedAt: row.last_used_at,
    lastErrorAt: row.last_error_at,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row._fromEnv ? 'env' : 'database',
  };
}

async function refreshOllamaCache() {
  const { rows } = await db.query(
    `SELECT * FROM ai_providers WHERE provider = 'ollama' AND enabled = TRUE
     ORDER BY id ASC LIMIT 1`,
  );
  _cache.provider = rows[0] || null;
  _cache.loadedAt = Date.now();
  return _cache.provider;
}

function invalidateOllamaCache() {
  _cache.provider = null;
  _cache.loadedAt = 0;
}

async function getActiveOllamaProvider() {
  if (!_cache.provider) await refreshOllamaCache();
  if (_cache.provider) return _cache.provider;
  return envFallbackProvider();
}

async function listOllamaProviders() {
  const { rows } = await db.query(
    `SELECT * FROM ai_providers WHERE provider = 'ollama' ORDER BY id ASC`,
  );
  await refreshOllamaCache();
  return rows;
}

async function getOllamaProviderById(id) {
  const r = await db.query(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function createOllamaProvider(data) {
  const r = await db.query(
    `INSERT INTO ai_providers (name, provider, host, api_key, default_model, enabled)
     VALUES ($1, 'ollama', $2, $3, $4, $5)
     RETURNING *`,
    [
      data.name,
      stripTrailingSlash(data.host),
      data.api_key || null,
      data.default_model,
      data.enabled !== false,
    ],
  );
  await refreshOllamaCache();
  return r.rows[0];
}

async function updateOllamaProvider(id, data) {
  const fields = [];
  const values = [];
  let i = 1;

  const set = (col, val) => {
    fields.push(`${col} = $${i++}`);
    values.push(val);
  };

  if (data.name !== undefined) set('name', data.name);
  if (data.host !== undefined) set('host', stripTrailingSlash(data.host));
  if (data.api_key !== undefined && data.api_key !== '') set('api_key', data.api_key);
  if (data.default_model !== undefined) set('default_model', data.default_model);
  if (data.enabled !== undefined) set('enabled', !!data.enabled);

  if (fields.length === 0) return getOllamaProviderById(id);

  fields.push('updated_at = NOW()');
  values.push(id);

  const r = await db.query(
    `UPDATE ai_providers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  await refreshOllamaCache();
  return r.rows[0] || null;
}

async function startUsageEvent(providerId, feature, model) {
  const r = await db.query(
    `INSERT INTO ai_usage_events (provider_id, feature, model, started_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [providerId, feature, model || null],
  );
  return r.rows[0]?.id;
}

async function finishUsageEvent(eventId, status, {
  errorMessage = null,
  durationMs = null,
  promptTokens = null,
  completionTokens = null,
} = {}) {
  if (!eventId) return;

  const totalTokens =
    (Number(promptTokens) || 0) + (Number(completionTokens) || 0) || null;

  const r = await db.query(
    `UPDATE ai_usage_events SET
       ended_at = NOW(),
       status = $2,
       duration_ms = $3,
       prompt_tokens = $4,
       completion_tokens = $5,
       total_tokens = $6,
       error_message = $7
     WHERE id = $1
     RETURNING provider_id, prompt_tokens, completion_tokens`,
    [eventId, status, durationMs, promptTokens, completionTokens, totalTokens, errorMessage],
  );

  const row = r.rows[0];
  if (!row?.provider_id) return;

  const isError = status === 'error';
  const pt = Number(row.prompt_tokens) || 0;
  const ct = Number(row.completion_tokens) || 0;

  await db.query(
    `UPDATE ai_providers SET
       request_count = request_count + 1,
       error_count = error_count + $2,
       prompt_tokens = prompt_tokens + $3,
       completion_tokens = completion_tokens + $4,
       last_used_at = NOW(),
       last_error_at = CASE WHEN $2 > 0 THEN NOW() ELSE last_error_at END,
       last_error_message = CASE WHEN $2 > 0 THEN $5 ELSE last_error_message END,
       updated_at = NOW()
     WHERE id = $1`,
    [row.provider_id, isError ? 1 : 0, pt, ct, errorMessage],
  );
  invalidateOllamaCache();
}

async function listRecentUsageEvents(providerId, limit = 50) {
  const days = retentionDays();
  const r = await db.query(
    `SELECT * FROM ai_usage_events
     WHERE provider_id = $1
       AND started_at >= NOW() - make_interval(days => $2::int)
     ORDER BY started_at DESC
     LIMIT $3`,
    [providerId, days, limit],
  );
  return r.rows;
}

async function listAllRecentUsageEvents(limit = 100) {
  const days = retentionDays();
  const r = await db.query(
    `SELECT e.*, p.name AS provider_name
     FROM ai_usage_events e
     LEFT JOIN ai_providers p ON p.id = e.provider_id
     WHERE e.started_at >= NOW() - make_interval(days => $1::int)
     ORDER BY e.started_at DESC
     LIMIT $2`,
    [days, limit],
  );
  return r.rows;
}

module.exports = {
  stripTrailingSlash,
  maskApiKey,
  envFallbackProvider,
  formatProviderRow,
  refreshOllamaCache,
  invalidateOllamaCache,
  getActiveOllamaProvider,
  listOllamaProviders,
  getOllamaProviderById,
  createOllamaProvider,
  updateOllamaProvider,
  startUsageEvent,
  finishUsageEvent,
  listRecentUsageEvents,
  listAllRecentUsageEvents,
};
