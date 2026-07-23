/**
 * Ticker-change research: for a company we can no longer price, search the web
 * (DuckDuckGo) for its current listing, ask the LLM to interpret the results,
 * verify the suggested symbol against live quotes, and file a suggestion for a
 * VA to approve. Approval is applied by routes/admin/admin-va-tasks.js.
 */
const db = require('../../db');
const { searchWeb } = require('../websearch');
const { chatWithSystem } = require('../ai/client');
const { fetchCompanyQuote } = require('../market/market-quote');

const MIN_CONFIDENCE = Number(process.env.TICKER_SUGGEST_MIN_CONFIDENCE || 0.6);

// Failure cooldown so a company that errors (search/LLM) isn't retried every run.
const FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h
const recentFailures = new Map();

function isCooling(companyId) {
  const t = recentFailures.get(companyId);
  return t && Date.now() - t < FAILURE_COOLDOWN_MS;
}
function recordFailure(companyId) { recentFailures.set(companyId, Date.now()); }
function clearFailure(companyId) { recentFailures.delete(companyId); }

function parseJson(raw) {
  const cleaned = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

const SYSTEM_PROMPT = `You are a financial data analyst who tracks stock ticker and listing changes for junior mining companies on the TSX, TSX Venture, Canadian Securities Exchange (CSE), and Australian Securities Exchange (ASX).

You are given ONE company that our system can no longer fetch a live price for under its currently-stored exchange + ticker, plus web search results. Determine whether the company's stock LISTING has changed and, if so, what the current exchange + ticker are.

Possible reasons a listing changes: ticker symbol change, company name change/rebrand, moving to another exchange or up-listing, acquisition/merger (now trades under the acquirer), or delisting.

Rules:
- Ground every claim in the provided search results. Do NOT invent a ticker. If the results don't clearly establish a current listing, set changed=false and confidence low.
- suggested_exchange must be one of: TSX, TSXV, CSE, ASX, NASDAQ, NYSE, OTC, or another real exchange code stated in the results — never guess.
- suggested_tv_symbol is "EXCHANGE:TICKER" (uppercase), matching suggested_exchange/suggested_ticker.
- confidence (0.0-1.0) reflects how strongly the results support the suggestion. A single passing mention = low; an official issuer/exchange page stating the new symbol = high.
- source_url must be the single most authoritative result URL supporting the suggestion.
- Respond with ONLY valid JSON, no markdown fences, matching this schema:

{
  "changed": boolean,
  "status": "reticker" | "renamed" | "moved_exchange" | "acquired" | "delisted" | "unchanged" | "unknown",
  "suggested_exchange": string | null,
  "suggested_ticker": string | null,
  "suggested_tv_symbol": string | null,
  "new_company_name": string | null,
  "confidence": number,
  "reasoning": string,
  "source_url": string | null
}`;

function buildUserPrompt(company, results) {
  const lines = results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`)
    .join('\n');
  return `COMPANY (our stored record — the ticker may be stale):
  Name: ${company.name}
  Current exchange: ${company.exchange || 'unknown'}
  Current ticker: ${company.ticker || 'unknown'}

WEB SEARCH RESULTS:
${lines || '(no results)'}

Based only on these results, has this company's stock listing changed, and what is its current exchange + ticker? Respond with JSON only.`;
}

/** Run web searches and dedupe results by URL. */
async function gatherResults(company) {
  const name = company.name || '';
  const queries = [
    `"${name}" stock ticker symbol exchange`,
    `${name} ticker change new symbol ${company.exchange || ''}`.trim(),
  ];
  const seen = new Set();
  const merged = [];
  for (const q of queries) {
    let rows = [];
    try {
      rows = await searchWeb(q, { limit: 6 });
    } catch (err) {
      // Surface search failure to the caller so it can cool down / skip.
      throw new Error(`web search failed: ${err.message}`);
    }
    for (const r of rows) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
    }
  }
  return merged.slice(0, 10);
}

/** Verify a suggested listing by trying to fetch a live quote for it. */
async function verifySuggestion(suggestion) {
  if (!suggestion?.suggested_exchange || !suggestion?.suggested_ticker) {
    return { verified: false, confidence: suggestion?.confidence ?? 0 };
  }
  try {
    const q = await fetchCompanyQuote(suggestion.suggested_exchange, suggestion.suggested_ticker);
    if (q && q.close != null) {
      return { verified: true, confidence: Math.min(1, (suggestion.confidence ?? 0.5) + 0.25) };
    }
  } catch { /* couldn't confirm — leave confidence as-is (slightly reduced) */ }
  return { verified: false, confidence: (suggestion.confidence ?? 0.5) * 0.85 };
}

/**
 * Research a ticker change for one company.
 * @returns {Promise<{ ok, suggestion, verified }>} suggestion is null when nothing found.
 */
async function suggestTickerForCompany(company, { skipCooldown = false, bypassPause = false } = {}) {
  if (!skipCooldown && isCooling(company.id)) {
    return { ok: false, reason: 'cooling_down', suggestion: null };
  }
  try {
    const results = await gatherResults(company);
    if (!results.length) {
      recordFailure(company.id);
      return { ok: true, suggestion: null, reason: 'no_search_results' };
    }

    const { content } = await chatWithSystem({
      feature: 'ticker_recheck',
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(company, results),
      timeoutMs: 60000,
      // Manual "Find new ticker" is a deliberate one-off admin action, so it may
      // bypass the global AI pause (which only exists to stop automatic/bulk work).
      bypassPause,
    });

    let parsed;
    try {
      parsed = parseJson(content);
    } catch {
      recordFailure(company.id);
      return { ok: false, reason: 'invalid_json', suggestion: null };
    }

    const { verified, confidence } = await verifySuggestion(parsed);
    clearFailure(company.id);
    const suggestion = {
      ...parsed,
      confidence,
      verified,
      current_exchange: company.exchange || null,
      current_ticker: company.ticker || null,
    };
    return { ok: true, suggestion, verified };
  } catch (err) {
    recordFailure(company.id);
    return { ok: false, reason: err.message, suggestion: null };
  }
}

/**
 * Upsert a VA suggestion task. auto_managed=FALSE so the 60s reconciler never
 * force-resolves it. Only creates when the suggestion is confident enough.
 * @returns {Promise<{ created: boolean, reason?: string, taskId?: number }>}
 */
async function createTickerSuggestionTask(company, suggestion) {
  if (!suggestion || !suggestion.changed) {
    return { created: false, reason: 'no_change' };
  }
  if (!suggestion.suggested_ticker || !suggestion.suggested_exchange) {
    return { created: false, reason: 'incomplete_suggestion' };
  }
  if ((suggestion.confidence ?? 0) < MIN_CONFIDENCE) {
    return { created: false, reason: 'low_confidence' };
  }

  const sourceKey = `companies|ticker_suggestion|${company.id}`;
  const current = `${company.exchange || '?'}:${company.ticker || '?'}`;
  const proposed = suggestion.suggested_tv_symbol
    || `${suggestion.suggested_exchange}:${suggestion.suggested_ticker}`;
  const title = `Ticker change? ${company.name} (${current} → ${proposed})`;
  const description = `${suggestion.reasoning || 'Possible ticker/listing change detected.'}`
    + `\n\nSuggested: ${proposed}${suggestion.new_company_name ? ` — ${suggestion.new_company_name}` : ''}`
    + ` (confidence ${(suggestion.confidence * 100).toFixed(0)}%${suggestion.verified ? ', price-verified' : ''}).`;

  const searchQ = encodeURIComponent(company.name || company.ticker || '');
  const actionUrl = `/admin/companies.html?search=${searchQ}&highlight=${company.id}&flagged=1`;

  const r = await db.query(
    `INSERT INTO va_tasks
       (source_key, module, error_type, title, description, action_url, severity,
        occurrence_count, sample_detail, auto_managed, status,
        payload, source_url, company_id, first_seen_at, last_seen_at)
     VALUES ($1, 'companies', 'ticker_suggestion', $2, $3, $4, 'high',
        1, $5, FALSE, 'open',
        $6::jsonb, $7, $8, NOW(), NOW())
     ON CONFLICT (source_key) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       action_url = EXCLUDED.action_url,
       payload = EXCLUDED.payload,
       source_url = EXCLUDED.source_url,
       sample_detail = EXCLUDED.sample_detail,
       last_seen_at = NOW(),
       -- refresh content but never resurrect a task a VA already closed
       status = CASE WHEN va_tasks.status IN ('done','resolved','dismissed','do_later','in_progress')
                     THEN va_tasks.status ELSE 'open' END
     RETURNING id`,
    [
      sourceKey,
      title,
      description,
      actionUrl,
      proposed,
      JSON.stringify(suggestion),
      suggestion.source_url || null,
      company.id,
    ],
  );
  return { created: true, taskId: r.rows[0]?.id };
}

module.exports = {
  MIN_CONFIDENCE,
  suggestTickerForCompany,
  createTickerSuggestionTask,
  // exported for tests
  buildUserPrompt,
  verifySuggestion,
  parseJson,
};
