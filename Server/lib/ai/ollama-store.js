const db = require('../../db');
const { retentionDays } = require('../usage-log-retention');

const ALLOWED_PROVIDERS = new Set(['ollama', 'deepseek']);

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
    is_default: false,
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
    isDefault: !!row.is_default,
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

async function refreshProviderCache() {
  const { rows } = await db.query(
    `SELECT * FROM ai_providers WHERE enabled = TRUE
     ORDER BY is_default DESC, id ASC LIMIT 1`,
  );
  _cache.provider = rows[0] || null;
  _cache.loadedAt = Date.now();
  return _cache.provider;
}

function invalidateProviderCache() {
  _cache.provider = null;
  _cache.loadedAt = 0;
}

/** @deprecated use invalidateProviderCache */
function invalidateOllamaCache() {
  invalidateProviderCache();
}

async function getActiveProvider() {
  if (!_cache.provider) await refreshProviderCache();
  if (_cache.provider) return _cache.provider;
  return envFallbackProvider();
}

/** @deprecated use getActiveProvider */
async function getActiveOllamaProvider() {
  return getActiveProvider();
}

async function listProviders() {
  const { rows } = await db.query(
    `SELECT * FROM ai_providers ORDER BY is_default DESC, id ASC`,
  );
  await refreshProviderCache();
  return rows;
}

/** @deprecated use listProviders */
async function listOllamaProviders() {
  return listProviders();
}

async function getProviderById(id) {
  const r = await db.query(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

/** @deprecated use getProviderById */
async function getOllamaProviderById(id) {
  return getProviderById(id);
}

async function createProvider(data) {
  const provider = String(data.provider || 'ollama').toLowerCase();
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const isDefault = data.is_default === true;
  if (isDefault) {
    await db.query(`UPDATE ai_providers SET is_default = FALSE WHERE is_default = TRUE`);
  }

  const r = await db.query(
    `INSERT INTO ai_providers (name, provider, host, api_key, default_model, enabled, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.name,
      provider,
      stripTrailingSlash(data.host),
      data.api_key || null,
      data.default_model,
      data.enabled !== false,
      isDefault,
    ],
  );
  await refreshProviderCache();
  return r.rows[0];
}

/** @deprecated use createProvider */
async function createOllamaProvider(data) {
  return createProvider({ ...data, provider: 'ollama' });
}

async function updateProvider(id, data) {
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
  if (data.provider !== undefined) {
    const provider = String(data.provider).toLowerCase();
    if (!ALLOWED_PROVIDERS.has(provider)) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    set('provider', provider);
  }

  if (data.is_default === true) {
    await db.query(`UPDATE ai_providers SET is_default = FALSE WHERE is_default = TRUE AND id <> $1`, [id]);
    set('is_default', true);
  } else if (data.is_default === false) {
    set('is_default', false);
  }

  if (fields.length === 0) return getProviderById(id);

  fields.push('updated_at = NOW()');
  values.push(id);

  const r = await db.query(
    `UPDATE ai_providers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  await refreshProviderCache();
  return r.rows[0] || null;
}

/** @deprecated use updateProvider */
async function updateOllamaProvider(id, data) {
  return updateProvider(id, data);
}

async function setDefaultProvider(id) {
  const existing = await getProviderById(id);
  if (!existing) return null;
  await db.query(`UPDATE ai_providers SET is_default = FALSE WHERE is_default = TRUE`);
  const r = await db.query(
    `UPDATE ai_providers SET is_default = TRUE, enabled = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );
  await refreshProviderCache();
  return r.rows[0] || null;
}

async function upsertProviderByType(data) {
  const provider = String(data.provider || '').toLowerCase();
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  const existing = await db.query(
    `SELECT id FROM ai_providers WHERE provider = $1 ORDER BY id ASC LIMIT 1`,
    [provider],
  );
  if (existing.rows[0]) {
    return updateProvider(existing.rows[0].id, {
      name: data.name,
      host: data.host,
      api_key: data.api_key,
      default_model: data.default_model,
      enabled: data.enabled !== false,
      is_default: data.is_default === true,
    });
  }
  return createProvider(data);
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
  invalidateProviderCache();
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
  ALLOWED_PROVIDERS,
  stripTrailingSlash,
  maskApiKey,
  envFallbackProvider,
  formatProviderRow,
  refreshProviderCache,
  refreshOllamaCache: refreshProviderCache,
  invalidateProviderCache,
  invalidateOllamaCache,
  getActiveProvider,
  getActiveOllamaProvider,
  listProviders,
  listOllamaProviders,
  getProviderById,
  getOllamaProviderById,
  createProvider,
  createOllamaProvider,
  updateProvider,
  updateOllamaProvider,
  setDefaultProvider,
  upsertProviderByType,
  startUsageEvent,
  finishUsageEvent,
  listRecentUsageEvents,
  listAllRecentUsageEvents,
};
