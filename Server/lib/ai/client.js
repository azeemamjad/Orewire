/**
 * Central AI chat client — loads active provider from DB, logs usage events.
 * Supports Ollama (/api/chat) and DeepSeek (OpenAI-compatible /chat/completions).
 */
const {
  getActiveProvider,
  startUsageEvent,
  finishUsageEvent,
  stripTrailingSlash,
} = require('./ollama-store');
const { isAiPaused, AiPausedError } = require('./ai-settings');

async function readHttpBody(res) {
  try {
    const text = await res.text();
    return typeof text === 'string' ? text : String(text);
  } catch (err) {
    return `[response body unreadable: ${err?.message || err}]`;
  }
}

function formatHttpError(res, body, label = 'AI') {
  const snippet = body.slice(0, 500);
  const status = res.status;
  if (status === 429) return `HTTP 429 Too Many Requests (rate limited): ${snippet}`;
  if (status === 401) return `HTTP 401 Unauthorized (check API key): ${snippet}`;
  if (status === 403) return `HTTP 403 Forbidden: ${snippet}`;
  if (status >= 500) return `HTTP ${status} Server Error: ${snippet}`;
  return `${label} HTTP ${status}: ${snippet}`;
}

/** @deprecated use formatHttpError */
function formatOllamaHttpError(res, body) {
  return formatHttpError(res, body, 'Ollama');
}

function extractTokenCounts(data, providerType) {
  if (providerType === 'deepseek' || data?.usage) {
    const promptTokens = data?.usage?.prompt_tokens ?? null;
    const completionTokens = data?.usage?.completion_tokens ?? null;
    return {
      promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
      completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
    };
  }
  const promptTokens = data?.prompt_eval_count ?? data?.prompt_tokens ?? null;
  const completionTokens = data?.eval_count ?? data?.completion_tokens ?? null;
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
  };
}

function buildRequest(provider, messages, model) {
  const type = provider.provider || 'ollama';
  const base = stripTrailingSlash(provider.host || (type === 'deepseek' ? 'https://api.deepseek.com' : 'https://ollama.com'));
  const headers = { 'Content-Type': 'application/json' };
  if (provider.api_key) headers.Authorization = `Bearer ${provider.api_key}`;

  if (type === 'deepseek') {
    return {
      url: `${base}/chat/completions`,
      headers,
      body: {
        model,
        stream: false,
        messages,
        // Faster JSON analysis — disable thinking mode on V4 Flash.
        thinking: { type: 'disabled' },
      },
      parseContent: (data) => (data.choices?.[0]?.message?.content || '').trim(),
      parseModel: (data) => data.model || model,
    };
  }

  return {
    url: `${base}/api/chat`,
    headers,
    body: { model, stream: false, messages },
    parseContent: (data) => (data.message?.content || '').trim(),
    parseModel: (data) => data.model || model,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.feature - usage label (e.g. filing_analysis, company_snapshot)
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {string} [opts.model] - override default model
 * @param {number} [opts.timeoutMs] - abort after N ms
 * @param {object} [opts.provider] - force a specific provider row (admin test)
 * @param {boolean} [opts.bypassPause] - run even when AI is globally paused (manual admin actions)
 */
async function chat({ feature, messages, model: modelOverride, timeoutMs, provider: providerOverride, bypassPause = false }) {
  if (!bypassPause && await isAiPaused()) {
    throw new AiPausedError();
  }

  const provider = providerOverride || await getActiveProvider();
  if (!provider) {
    throw new Error('AI not configured — add a provider in Admin → AI');
  }
  if (!provider.enabled && !provider._fromEnv) {
    throw new Error('AI provider is disabled');
  }

  const type = provider.provider || 'ollama';
  const model = modelOverride
    || provider.default_model
    || (type === 'deepseek' ? 'deepseek-v4-flash' : 'kimi');

  const req = buildRequest(provider, messages, model);

  const eventId = provider.id
    ? await startUsageEvent(provider.id, feature, model)
    : null;
  const started = Date.now();

  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl
    ? setTimeout(() => ctrl.abort(), timeoutMs)
    : null;

  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      signal: ctrl?.signal,
      body: JSON.stringify(req.body),
    });

    const body = await readHttpBody(res);
    if (!res.ok) {
      throw new Error(formatHttpError(res, body, type === 'deepseek' ? 'DeepSeek' : 'Ollama'));
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`AI response not JSON (HTTP ${res.status}): ${body.slice(0, 300)}`);
    }

    const content = req.parseContent(data);
    const tokens = extractTokenCounts(data, type);
    const durationMs = Date.now() - started;

    await finishUsageEvent(eventId, 'success', {
      durationMs,
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
    });

    return {
      content,
      model: req.parseModel(data),
      provider: type,
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err.name === 'AbortError'
      ? `AI request timed out after ${timeoutMs}ms`
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
async function chatWithSystem({ feature, system, user, model, timeoutMs, provider, bypassPause }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });
  return chat({ feature, messages, model, timeoutMs, provider, bypassPause });
}

module.exports = {
  chat,
  chatWithSystem,
  formatOllamaHttpError,
  formatHttpError,
};
