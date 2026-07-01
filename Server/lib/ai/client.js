/**
 * Central Ollama chat client — loads config from DB, logs usage events.
 */
const {
  getActiveOllamaProvider,
  startUsageEvent,
  finishUsageEvent,
  stripTrailingSlash,
} = require('./ollama-store');

async function readHttpBody(res) {
  try {
    const text = await res.text();
    return typeof text === 'string' ? text : String(text);
  } catch (err) {
    return `[response body unreadable: ${err?.message || err}]`;
  }
}

function formatOllamaHttpError(res, body) {
  const snippet = body.slice(0, 500);
  const status = res.status;
  if (status === 429) return `HTTP 429 Too Many Requests (rate limited): ${snippet}`;
  if (status === 401) return `HTTP 401 Unauthorized (check API key): ${snippet}`;
  if (status === 403) return `HTTP 403 Forbidden: ${snippet}`;
  if (status >= 500) return `HTTP ${status} Server Error: ${snippet}`;
  return `HTTP ${status}: ${snippet}`;
}

function extractTokenCounts(data) {
  const promptTokens = data?.prompt_eval_count ?? data?.prompt_tokens ?? null;
  const completionTokens = data?.eval_count ?? data?.completion_tokens ?? null;
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.feature - usage label (e.g. filing_analysis, company_snapshot)
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {string} [opts.model] - override default model
 * @param {number} [opts.timeoutMs] - abort after N ms
 */
async function chat({ feature, messages, model: modelOverride, timeoutMs }) {
  const provider = await getActiveOllamaProvider();
  if (!provider) {
    throw new Error('Ollama not configured — add a provider in Admin → AI or set OLLAMA_* in .env');
  }
  if (!provider.enabled && !provider._fromEnv) {
    throw new Error('Ollama provider is disabled');
  }

  const base = stripTrailingSlash(provider.host || 'https://ollama.com');
  const model = modelOverride || provider.default_model || 'kimi';
  const apiKey = provider.api_key;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const eventId = provider.id
    ? await startUsageEvent(provider.id, feature, model)
    : null;
  const started = Date.now();

  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl
    ? setTimeout(() => ctrl.abort(), timeoutMs)
    : null;

  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      signal: ctrl?.signal,
      body: JSON.stringify({ model, stream: false, messages }),
    });

    const body = await readHttpBody(res);
    if (!res.ok) {
      throw new Error(formatOllamaHttpError(res, body));
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`Ollama response not JSON (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }

    const content = (data.message?.content || '').trim();
    const tokens = extractTokenCounts(data);
    const durationMs = Date.now() - started;

    await finishUsageEvent(eventId, 'success', {
      durationMs,
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
    });

    return {
      content,
      model: data.model || model,
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err.name === 'AbortError'
      ? `Ollama request timed out after ${timeoutMs}ms`
      : (err.message || String(err));

    await finishUsageEvent(eventId, 'error', {
      durationMs,
      errorMessage: message,
    });

    throw new Error(message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Convenience: system + user messages */
async function chatWithSystem({ feature, system, user, model, timeoutMs }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });
  return chat({ feature, messages, model, timeoutMs });
}

module.exports = {
  chat,
  chatWithSystem,
  formatOllamaHttpError,
};
