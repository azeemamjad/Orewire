const crypto = require('crypto');
const db = require('../db');
const { fetchCompanyQuote } = require('./market-quote');
const { fetchTvFundamentals, tvSymbolForCompany } = require('./tv-quote');
const { companyCategoryKey } = require('./news-fetch');
const {
  safeParse,
  deriveCommodities,
  deriveCountry,
} = require('./company-enrich');

/** In-flight generation jobs per company_id */
const activeGenerations = new Map();

/** Skip regen retries after LLM failure for same input hash */
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const recentFailures = new Map();

function isFailureCooling(companyId, inputHash) {
  const f = recentFailures.get(companyId);
  if (!f || f.hash !== inputHash) return false;
  return Date.now() - f.at < FAILURE_COOLDOWN_MS;
}

function recordFailure(companyId, inputHash) {
  recentFailures.set(companyId, { hash: inputHash, at: Date.now() });
}

function clearFailure(companyId) {
  recentFailures.delete(companyId);
}

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
  if (status === 401) return `HTTP 401 Unauthorized (check OLLAMA_API_KEY): ${snippet}`;
  if (status === 403) return `HTTP 403 Forbidden: ${snippet}`;
  if (status >= 500) return `HTTP ${status} Server Error: ${snippet}`;
  return `HTTP ${status}: ${snippet}`;
}

const SNAPSHOT_SYSTEM = `You are a senior mining analyst writing a "what's happening now" snapshot for retail investors on TSX-V, CSE, TSX, and ASX junior miners.

Rules:
- Use ONLY facts from the user message. If a field is "null", omit it; do not invent.
- Write exactly 3 short paragraphs of plain English prose, separated by blank lines.
- Paragraph 1: trading context (price, % change, volume vs average if provided) and what drove the move from the most recent news or filing.
- Paragraph 2: balance sheet, financing, cash/burn, and insider activity when provided.
- Paragraph 3: big-picture company/project context, near-term catalysts, and one risk to watch.
- No headings, bullet lists, markdown, or JSON.
- Never use em dashes or en dashes (— or –). Use commas, periods, or parentheses instead.
- Write in direct, natural prose. Avoid AI filler ("it's worth noting", "in conclusion", "overall") and curly quotes; use plain straight quotes.`;

function fmtNull(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return String(value).trim();
}

function formatSnapshotDate(dateStr) {
  if (!dateStr) return 'unknown date';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleDateString('en-US', {
    timeZone: process.env.TIMEZONE || 'America/Toronto',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtExLabel(ex) {
  if (!ex) return '';
  const u = String(ex).toUpperCase().replace('-', '');
  return u === 'TSXV' ? 'TSX-V' : ex;
}

function inferProjectStage(filings) {
  const blob = filings
    .map((f) => `${f.filing_type || ''} ${f.display_type || ''}`.toLowerCase())
    .join(' ');
  if (/feasibility|pre-feasibility|dfs|pfs/.test(blob)) return 'Feasibility';
  if (/ni 43-101|jorc|technical report|resource update|mineral resource/.test(blob)) return 'Resource definition';
  if (/drill|assay|exploration/.test(blob)) return 'Exploration';
  if (/production|quarterly report|annual report|md&a/.test(blob)) return 'Producer';
  return null;
}

function formatFinancing(row) {
  if (!row?.pp_amount && !row?.pp_price) return null;
  const parts = [];
  if (row.pp_amount != null) {
    parts.push(`C$${Number(row.pp_amount).toLocaleString('en-US')} financing`);
  }
  if (row.pp_price != null) parts.push(`at C$${row.pp_price} per unit`);
  if (row.insider_holdings) parts.push(`(${row.insider_holdings})`);
  return parts.join(' ') || null;
}

function computeRunwayMonths(cash, burnQuarterly) {
  if (cash == null || burnQuarterly == null || burnQuarterly <= 0) return null;
  const monthly = burnQuarterly / 3;
  if (monthly <= 0) return null;
  return Math.round(cash / monthly);
}

function formatMarketBlock(quote, exchange) {
  if (!quote || quote.close == null) return null;
  const ccy = quote.fundamental_currency_code === 'USD' ? 'US$' : exchange?.toUpperCase().includes('ASX') ? 'A$' : 'C$';
  const price = `${ccy}${Number(quote.close).toFixed(Math.abs(quote.close) < 1 ? 4 : 3)}`;
  const chg =
    quote.change != null
      ? `${quote.change >= 0 ? '+' : ''}${Number(quote.change).toFixed(2)}% today`
      : null;
  const vol = quote.volume != null ? Number(quote.volume).toLocaleString('en-US') : null;
  const avgVol = quote.avg_volume_30d != null ? Number(quote.avg_volume_30d).toLocaleString('en-US') : null;
  const volRatio =
    quote.volume != null && quote.avg_volume_30d != null && quote.avg_volume_30d > 0
      ? `${(quote.volume / quote.avg_volume_30d).toFixed(1)}× its 30-day average`
      : null;
  const parts = [`Trading at ${price}`];
  if (chg) parts.push(chg);
  if (vol) parts.push(`volume ${vol}`);
  if (volRatio) parts.push(volRatio);
  return parts.join(', ');
}

async function callOllama(prompt) {
  const base = process.env.OLLAMA_HOST || 'https://ollama.com';
  const model = process.env.OLLAMA_MODEL || 'kimi';
  const apiKey = process.env.OLLAMA_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const url = `${base}/api/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: SNAPSHOT_SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const body = await readHttpBody(res);
  if (!res.ok) {
    const errMsg = formatOllamaHttpError(res, body);
    console.error(`[Snapshot] Ollama request failed (${url}, model=${model}): ${errMsg}`);
    throw new Error(errMsg);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    const errMsg = `Ollama response not JSON (HTTP ${res.status}): ${body.slice(0, 300)}`;
    console.error(`[Snapshot] ${errMsg}`);
    throw new Error(errMsg);
  }

  const content = (data.message?.content || '').trim();
  if (!content) {
    throw new Error('Ollama returned empty message content');
  }
  return content;
}

// Strip AI-tell punctuation from generated prose: em/en dashes, smart quotes,
// ellipsis characters and stray markdown emphasis. Em dashes used as a
// parenthetical separator become commas; numeric ranges become hyphens.
// Whitespace around dashes is limited to spaces/tabs so paragraph breaks survive.
function sanitizeProse(text) {
  if (text == null) return text;
  let s = String(text);
  // Smart quotes -> straight quotes
  s = s.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"');
  // Ellipsis -> three dots
  s = s.replace(/…/g, '...');
  // Numeric ranges joined by a dash -> hyphen (e.g. "12–15" -> "12-15")
  s = s.replace(/(\d)[ \t]*[‒–—―−][ \t]*(\d)/g, '$1-$2');
  // Remaining em/en/figure/horizontal-bar/minus dashes used as separators -> comma
  s = s.replace(/[ \t]*[‒–—―−][ \t]*/g, ', ');
  // Strip markdown emphasis the model may emit despite instructions
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  // Tidy artifacts left by the replacements
  s = s
    .replace(/[ \t]+,/g, ',')          // " ," -> ","
    .replace(/,[ \t]*,/g, ',')         // ",," -> ","
    .replace(/,[ \t]*([.!?;:])/g, '$1') // ", ." -> "."
    .replace(/[ \t]{2,}/g, ' ');       // collapse runs of spaces
  return s.trim();
}

function parseSnapshotText(text) {
  const cleaned = sanitizeProse(text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim());
  const split = cleaned.split(/\n\s*Key points\s*\n/i);
  const bodyPart = (split[0] || '').trim();
  const keyPart = (split[1] || '').trim();
  const paragraphs = bodyPart.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const keyPoints = keyPart
    .split(/\n/)
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
  return { body: cleaned, paragraphs, keyPoints };
}

function hashContext(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function gatherSnapshotContext(companyId) {
  const companyRes = await db.query('SELECT * FROM companies WHERE id = $1', [companyId]);
  const company = companyRes.rows[0];
  if (!company) return null;

  const raw = safeParse(company.raw_data);
  const commodities = deriveCommodities(company, raw);
  const country = deriveCountry(raw);
  const newsCategory = companyCategoryKey(company.name);

  const filingsRes = await db.query(
    `SELECT f.id, f.filing_type, f.created_at, f.commodity,
            a.display_type, a.summary, a.verdict, a.verdict_reason, a.what_to_watch,
            a.key_facts, a.context,
            a.cash_position, a.burn_rate_quarterly, a.resource_estimate,
            a.pp_amount, a.pp_price, a.insider_holdings
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
      WHERE f.company_id = $1
         OR TRIM(REPLACE(REPLACE(f.company_name, '.', ''), ',', ''))
          = TRIM(REPLACE(REPLACE($2, '.', ''), ',', ''))
      ORDER BY f.created_at DESC
      LIMIT 15`,
    [companyId, company.name],
  );
  const filings = filingsRes.rows;

  const newsRes = await db.query(
    `SELECT id, title, summary, pub_date
       FROM news
      WHERE relevant = TRUE
        AND (company_id = $1 OR category = $2)
      ORDER BY pub_date DESC NULLS LAST
      LIMIT 10`,
    [companyId, newsCategory],
  );

  const ownershipRes = await db.query(
    `SELECT insider_name, title, percent_ownership, last_transaction, last_transaction_date
       FROM insider_ownership
      WHERE company_id = $1
      ORDER BY COALESCE(percent_ownership, 0) DESC
      LIMIT 5`,
    [companyId],
  );

  const txRes = await db.query(
    `SELECT insider_name, title, transaction_type, shares, price, transaction_date
       FROM insider_transactions
      WHERE company_id = $1
      ORDER BY transaction_date DESC NULLS LAST
      LIMIT 5`,
    [companyId],
  );

  let marketQuote = null;
  try {
    marketQuote = await fetchCompanyQuote(company.exchange, company.ticker, { history: false });
    const tvSym = tvSymbolForCompany(company.exchange, company.ticker);
    if (tvSym) {
      const fund = await fetchTvFundamentals(tvSym);
      if (fund?.avg_volume_30d != null) {
        marketQuote = marketQuote || {};
        marketQuote.avg_volume_30d = fund.avg_volume_30d;
      }
    }
  } catch {
    /* optional */
  }

  const recentItems = [
    ...filings
      .filter((f) => f.summary)
      .map((f) => ({
        type: f.display_type || f.filing_type || 'Filing',
        date: f.created_at,
        summary: f.summary,
        source: 'filing',
        id: `f-${f.id}`,
      })),
    ...newsRes.rows
      .filter((n) => n.summary || n.title)
      .map((n) => ({
        type: 'News Release',
        date: n.pub_date,
        summary: n.summary || n.title,
        source: 'news',
        id: `n-${n.id}`,
      })),
  ]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 5);

  const finRow =
    filings.find((f) => f.cash_position != null || f.burn_rate_quarterly != null || f.pp_amount != null) ||
    filings[0];
  const resourceRow = filings.find((f) => f.resource_estimate);

  const catalysts = filings
    .map((f) => f.what_to_watch)
    .filter(Boolean)
    .slice(0, 4);

  const latestFiling = filings[0];
  const latestNews = newsRes.rows[0];

  const hashPayload = {
    companyId,
    latestFilingId: latestFiling?.id ?? null,
    latestNewsId: latestNews?.id ?? null,
    latestFilingAt: latestFiling?.created_at ?? null,
    latestNewsAt: latestNews?.pub_date ?? null,
    description: company.description,
    marketPrice: marketQuote?.close ?? null,
  };

  const insiderLines = ownershipRes.rows.map((o) => {
    const pct = o.percent_ownership != null ? `${o.percent_ownership}%` : '';
    const last = o.last_transaction ? `${o.last_transaction}` : '';
    return `${o.insider_name}${o.title ? ` (${o.title})` : ''}${pct ? ` - ${pct}` : ''}${last ? ` - ${last}` : ''}`;
  });

  const txLines = txRes.rows.map((t) => {
    const shares = t.shares != null ? `${Number(t.shares).toLocaleString()} shares` : '';
    return `${t.insider_name}: ${t.transaction_type || 'transaction'} ${shares} on ${formatSnapshotDate(t.transaction_date)}`;
  });

  return {
    company,
    commodities,
    country,
    filings,
    recentItems,
    finRow,
    resourceRow,
    catalysts,
    marketQuote,
    insiderLines,
    txLines,
    inputHash: hashContext(hashPayload),
    sourcesMeta: {
      filings: filings.filter((f) => f.summary).length,
      news: newsRes.rows.length,
      recentItems: recentItems.length,
      insiders: ownershipRes.rows.length,
    },
  };
}

function buildSnapshotPrompt(ctx) {
  const {
    company,
    commodities,
    country,
    recentItems,
    finRow,
    resourceRow,
    catalysts,
    filings,
    marketQuote,
    insiderLines,
    txLines,
  } = ctx;

  const runway = finRow ? computeRunwayMonths(finRow.cash_position, finRow.burn_rate_quarterly) : null;
  const ppSummary = finRow ? formatFinancing(finRow) : null;
  const marketBlock = formatMarketBlock(marketQuote, company.exchange);
  const exLabel = fmtExLabel(company.exchange);
  const tickerLine = company.ticker ? `${exLabel}:${company.ticker}` : company.name;

  const recentBlock = recentItems.length
    ? recentItems
        .map((item, i) => `${i + 1}. ${item.type} (${formatSnapshotDate(item.date)}): ${item.summary}`)
        .join('\n')
    : 'null';

  const filingDetails = filings
    .filter((f) => f.summary || f.key_facts || f.context)
    .slice(0, 6)
    .map((f) => {
      const bits = [`${f.display_type || f.filing_type || 'Filing'} (${formatSnapshotDate(f.created_at)})`];
      if (f.summary) bits.push(`Summary: ${f.summary}`);
      if (f.verdict) bits.push(`Verdict: ${f.verdict}`);
      if (f.key_facts) bits.push(`Key facts: ${f.key_facts}`);
      if (f.context) bits.push(`Context: ${f.context}`);
      return bits.join(' | ');
    })
    .join('\n');

  const location = company.headquarters || country || company.region || null;
  const stage = inferProjectStage(filings);

  return `Write a situational snapshot for this company using ONLY the data below. Skip null fields.

Company: ${company.name} (${tickerLine})
Commodity focus: ${fmtNull(commodities[0] || company.sector)}
Project location: ${fmtNull(location)}
Project stage: ${fmtNull(stage)}

About / company description:
${fmtNull(company.description)}

Market data (delayed):
${fmtNull(marketBlock)}

Financial position:
- Cash / working capital: ${fmtNull(finRow?.cash_position)}
- Quarterly burn rate: ${fmtNull(finRow?.burn_rate_quarterly)}
- Runway: ${runway != null ? `${runway} months` : 'null'}
- Last financing: ${fmtNull(ppSummary)}

Resource estimate:
${fmtNull(resourceRow?.resource_estimate)}

Recent filings & news (summaries):
${recentBlock || 'null'}

Additional filing detail:
${filingDetails || 'null'}

Insider ownership (top holders):
${insiderLines.length ? insiderLines.join('\n') : 'null'}

Recent insider transactions:
${txLines.length ? txLines.join('\n') : 'null'}

Upcoming catalysts / what to watch:
${catalysts.length ? catalysts.join('; ') : 'null'}

Write 3 paragraphs as specified in your instructions. No other formatting.`;
}

function buildFallbackSnapshot(ctx) {
  const { company, recentItems, finRow, resourceRow, commodities, marketQuote } = ctx;
  const paragraphs = [];
  const exLabel = fmtExLabel(company.exchange);
  const tickerLine = company.ticker ? `${exLabel}:${company.ticker}` : company.name;
  const marketBlock = formatMarketBlock(marketQuote, company.exchange);

  if (marketBlock || recentItems[0]?.summary) {
    paragraphs.push(
      `${company.name} (${tickerLine})${marketBlock ? `: ${marketBlock}.` : ''} ${recentItems[0]?.summary || ''}`.trim(),
    );
  } else if (company.description) {
    paragraphs.push(company.description.slice(0, 500));
  }

  const finBits = [];
  if (finRow?.cash_position != null) finBits.push(`cash of ${finRow.cash_position}`);
  if (finRow?.burn_rate_quarterly != null) finBits.push(`quarterly burn of ${finRow.burn_rate_quarterly}`);
  if (finRow && formatFinancing(finRow)) finBits.push(formatFinancing(finRow));
  if (finBits.length) paragraphs.push(`On the balance sheet: ${finBits.join(', ')}.`);

  if (resourceRow?.resource_estimate) {
    paragraphs.push(`Resource estimate: ${resourceRow.resource_estimate}`);
  } else if (commodities.length) {
    paragraphs.push(`${company.name} is active in ${commodities.join(', ')}.`);
  }

  const body = paragraphs.join('\n\n');
  return parseSnapshotText(body);
}

async function getCachedSnapshot(companyId) {
  const r = await db.query(
    `SELECT company_id, body, paragraphs, key_points, sources_meta, input_hash, model, generated_at
       FROM company_snapshots WHERE company_id = $1`,
    [companyId],
  );
  return r.rows[0] || null;
}

async function saveSnapshot(companyId, parsed, inputHash, model, sourcesMeta) {
  await db.query(
    `INSERT INTO company_snapshots
       (company_id, body, paragraphs, key_points, sources_meta, input_hash, model, generated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       body = EXCLUDED.body,
       paragraphs = EXCLUDED.paragraphs,
       key_points = EXCLUDED.key_points,
       sources_meta = EXCLUDED.sources_meta,
       input_hash = EXCLUDED.input_hash,
       model = EXCLUDED.model,
       generated_at = NOW()`,
    [
      companyId,
      parsed.body,
      JSON.stringify(parsed.paragraphs),
      JSON.stringify(parsed.keyPoints),
      JSON.stringify(sourcesMeta),
      inputHash,
      model,
    ],
  );
}

function formatResponse(row, stale = false) {
  // Sanitize on read too, so snapshots cached before this rule shipped are
  // cleaned without waiting for a regeneration.
  return {
    paragraphs: (row.paragraphs || []).map(sanitizeProse),
    keyPoints: (row.key_points || []).map(sanitizeProse),
    body: sanitizeProse(row.body),
    generatedAt: row.generated_at,
    sourcesMeta: row.sources_meta || {},
    stale,
    model: row.model || null,
  };
}

async function regenerateCompanySnapshot(companyId) {
  const ctx = await gatherSnapshotContext(companyId);
  if (!ctx) return null;

  let parsed;
  let model = process.env.OLLAMA_MODEL || 'kimi';
  try {
    const prompt = buildSnapshotPrompt(ctx);
    const raw = await callOllama(prompt);
    parsed = parseSnapshotText(raw);
    if (!parsed.paragraphs.length) throw new Error('Empty snapshot from model');
  } catch (err) {
    recordFailure(companyId, ctx.inputHash);
    console.error(
      `[Snapshot] LLM failed for company ${companyId}:`,
      err?.message || err,
    );
    const cached = await getCachedSnapshot(companyId);
    if (cached) {
      console.warn(
        `[Snapshot] Using cached snapshot for company ${companyId}; regen paused for ${FAILURE_COOLDOWN_MS / 60000} min`,
      );
      return formatResponse(cached, true);
    }
    parsed = buildFallbackSnapshot(ctx);
    model = 'fallback';
  }

  await saveSnapshot(companyId, parsed, ctx.inputHash, model, ctx.sourcesMeta);
  clearFailure(companyId);
  const saved = await getCachedSnapshot(companyId);
  return formatResponse(saved, false);
}

function scheduleSnapshotRegeneration(companyId, reason = 'data-changed') {
  const id = parseInt(companyId, 10);
  if (!id) return;
  if (activeGenerations.has(id)) return;

  const job = regenerateCompanySnapshot(id)
    .then((snap) => {
      if (snap) console.log(`[Snapshot] Regenerated company ${id} (${reason})`);
    })
    .catch((err) => {
      console.error(`[Snapshot] Regeneration failed for company ${id}:`, err?.message || err);
    })
    .finally(() => {
      activeGenerations.delete(id);
    });

  activeGenerations.set(id, job);
}

/**
 * Fast read for API: returns cached snapshot immediately and enqueues regen when inputs changed.
 */
async function getCompanySnapshotView(companyId, { force = false } = {}) {
  const ctx = await gatherSnapshotContext(companyId);
  if (!ctx) return { status: 'empty', snapshot: null, needsRegen: false };

  const cached = await getCachedSnapshot(companyId);
  const hashMatch = cached && cached.input_hash === ctx.inputHash;
  const needsRegen = force || !cached || !hashMatch;
  const isGenerating = activeGenerations.has(companyId);

  if (needsRegen && !isGenerating && !isFailureCooling(companyId, ctx.inputHash)) {
    scheduleSnapshotRegeneration(companyId, force ? 'forced' : 'stale-inputs');
  }

  const snapshot = cached ? formatResponse(cached, needsRegen && !isGenerating) : null;
  const status =
    isGenerating || (needsRegen && !cached) ? 'generating' : 'ready';

  return { status, snapshot, needsRegen };
}

/** Legacy sync API — prefer getCompanySnapshotView for routes */
async function getCompanySnapshot(companyId, { force = false } = {}) {
  const view = await getCompanySnapshotView(companyId, { force });
  if (view.status === 'generating' && !view.snapshot) {
    await activeGenerations.get(companyId);
    const cached = await getCachedSnapshot(companyId);
    return cached ? formatResponse(cached, false) : null;
  }
  return view.snapshot;
}

module.exports = {
  gatherSnapshotContext,
  getCompanySnapshot,
  getCompanySnapshotView,
  scheduleSnapshotRegeneration,
  buildSnapshotPrompt,
  parseSnapshotText,
};
