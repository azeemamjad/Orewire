const crypto = require('crypto');
const db = require('../db');
const {
  safeParse,
  deriveCommodities,
  deriveCountry,
} = require('./company-enrich');

const CACHE_MS = parseInt(process.env.SNAPSHOT_CACHE_MS || String(24 * 60 * 60 * 1000), 10);

const SNAPSHOT_SYSTEM = `You are a senior mining analyst writing a situational snapshot for retail investors on TSX-V, CSE, TSX, and ASX junior miners.

Rules:
- Use ONLY facts from the user message. If a field is "null", omit it — do not invent.
- Do NOT mention stock price, market cap, or intraday trading.
- Write 2 to 3 short paragraphs of plain English prose.
- After the paragraphs, add a blank line, then the heading "Key points" on its own line, then 3 to 5 bullet lines starting with "- ".
- No other headings, markdown, or JSON.`;

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
    const ccy = row.pp_currency || 'C$';
    parts.push(`${ccy}${Number(row.pp_amount).toLocaleString('en-US')} financing`);
  }
  if (row.pp_price != null) parts.push(`at ${row.pp_price} per unit`);
  if (row.insider_holdings) parts.push(`(${row.insider_holdings})`);
  return parts.join(' ') || null;
}

function computeRunwayMonths(cash, burnQuarterly) {
  if (cash == null || burnQuarterly == null || burnQuarterly <= 0) return null;
  const monthly = burnQuarterly / 3;
  if (monthly <= 0) return null;
  return Math.round(cash / monthly);
}

async function callOllama(prompt) {
  const base = process.env.OLLAMA_HOST || 'https://ollama.com';
  const model = process.env.OLLAMA_MODEL || 'kimi';
  const apiKey = process.env.OLLAMA_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${base}/api/chat`, {
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
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text().slice(0, 200)}`);
  const data = await res.json();
  return (data.message?.content || '').trim();
}

function parseSnapshotText(text) {
  const cleaned = text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
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

function hashContext(ctx) {
  return crypto.createHash('sha256').update(JSON.stringify(ctx)).digest('hex');
}

async function gatherSnapshotContext(companyId) {
  const companyRes = await db.query('SELECT * FROM companies WHERE id = $1', [companyId]);
  const company = companyRes.rows[0];
  if (!company) return null;

  const raw = safeParse(company.raw_data);
  const commodities = deriveCommodities(company, raw);
  const country = deriveCountry(raw);

  const filingsRes = await db.query(
    `SELECT f.id, f.filing_type, f.created_at, f.commodity,
            a.display_type, a.summary, a.verdict, a.what_to_watch,
            a.cash_position, a.burn_rate_quarterly, a.resource_estimate,
            a.pp_amount, a.pp_price, a.insider_holdings
       FROM filings f
       LEFT JOIN ai_output a ON a.filing_id = f.id
      WHERE f.company_id = $1
         OR TRIM(REPLACE(REPLACE(f.company_name, '.', ''), ',', ''))
          = TRIM(REPLACE(REPLACE($2, '.', ''), ',', ''))
      ORDER BY f.created_at DESC
      LIMIT 20`,
    [companyId, company.name],
  );
  const filings = filingsRes.rows;

  const newsRes = await db.query(
    `SELECT id, title, summary, pub_date
       FROM news
      WHERE company_id = $1 AND relevant = TRUE
      ORDER BY pub_date DESC NULLS LAST
      LIMIT 10`,
    [companyId],
  );

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
    .slice(0, 3);

  const finRow = filings.find((f) => f.cash_position != null || f.burn_rate_quarterly != null || f.pp_amount != null)
    || filings[0];
  const resourceRow = filings.find((f) => f.resource_estimate);

  const catalysts = filings
    .map((f) => f.what_to_watch)
    .filter(Boolean)
    .slice(0, 4);

  const hashPayload = {
    companyId,
    recentIds: recentItems.map((r) => r.id),
    cash: finRow?.cash_position ?? null,
    burn: finRow?.burn_rate_quarterly ?? null,
    resource: resourceRow?.resource_estimate ?? null,
    description: company.description,
    catalysts,
  };

  return {
    company,
    commodities,
    country,
    filings,
    recentItems,
    finRow,
    resourceRow,
    catalysts,
    inputHash: hashContext(hashPayload),
    sourcesMeta: {
      filings: filings.filter((f) => f.summary).length,
      news: newsRes.rows.length,
      recentItems: recentItems.length,
    },
  };
}

function buildSnapshotPrompt(ctx) {
  const { company, commodities, country, recentItems, finRow, resourceRow, catalysts, filings } = ctx;
  const runway = finRow
    ? computeRunwayMonths(finRow.cash_position, finRow.burn_rate_quarterly)
    : null;
  const ppSummary = finRow ? formatFinancing(finRow) : null;

  const padItem = (idx) => {
    const item = recentItems[idx];
    if (!item) {
      return {
        type: 'null',
        date: 'null',
        summary: 'null',
      };
    }
    return {
      type: item.type,
      date: formatSnapshotDate(item.date),
      summary: item.summary,
    };
  };

  const i1 = padItem(0);
  const i2 = padItem(1);
  const i3 = padItem(2);

  const location = company.headquarters || country || company.region || null;
  const stage = inferProjectStage(filings);

  return `Write a company snapshot for the following company using the data provided. Only reference data that is included below. Skip anything marked null. Do not repeat stock price or market cap.

Company: ${company.name}
Ticker: ${fmtNull(company.ticker)}
Exchange: ${fmtNull(company.exchange)}
Commodity: ${fmtNull(commodities[0] || company.sector)}
Project location: ${fmtNull(location)}
Project stage: ${fmtNull(stage)}
Company description: ${fmtNull(company.description)}

Financial position:
- Cash: ${fmtNull(finRow?.cash_position)}
- Quarterly burn rate: ${fmtNull(finRow?.burn_rate_quarterly)}
- Runway: ${runway != null ? `${runway} months` : 'null'}
- Last financing: ${fmtNull(ppSummary)}

Resource estimate:
${fmtNull(resourceRow?.resource_estimate)}

Recent activity (most recent 3 items from our summaries):
1. ${i1.type} (${i1.date}): ${i1.summary}
2. ${i2.type} (${i2.date}): ${i2.summary}
3. ${i3.type} (${i3.date}): ${i3.summary}

Upcoming catalysts:
${catalysts.length ? catalysts.join('; ') : 'null'}

Write 2 to 3 paragraphs followed by bullet points under "Key points". No other formatting.`;
}

function buildFallbackSnapshot(ctx) {
  const { company, recentItems, finRow, resourceRow, commodities } = ctx;
  const paragraphs = [];
  const keyPoints = [];

  if (recentItems[0]?.summary) {
    paragraphs.push(
      `${company.name}${company.ticker ? ` (${company.ticker})` : ''}: ${recentItems[0].summary}`,
    );
  } else if (company.description) {
    paragraphs.push(company.description.slice(0, 400));
  }

  const finBits = [];
  if (finRow?.cash_position != null) finBits.push(`cash of ${finRow.cash_position}`);
  if (finRow?.burn_rate_quarterly != null) finBits.push(`quarterly burn of ${finRow.burn_rate_quarterly}`);
  if (finBits.length) paragraphs.push(`Financial position: ${finBits.join(', ')}.`);

  if (resourceRow?.resource_estimate) {
    paragraphs.push(`Resource estimate: ${resourceRow.resource_estimate}`);
  } else if (commodities.length) {
    paragraphs.push(`${company.name} is active in ${commodities.join(', ')}.`);
  }

  for (const item of recentItems.slice(0, 3)) {
    keyPoints.push(`${item.type}: ${item.summary}`);
  }
  if (!keyPoints.length && company.ticker) {
    keyPoints.push(`Follow ${company.ticker} filings and news releases on Orewire for updates.`);
  }

  const body = [...paragraphs, '', 'Key points', ...keyPoints.map((k) => `- ${k}`)].join('\n');
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
  return {
    paragraphs: row.paragraphs || [],
    keyPoints: row.key_points || [],
    body: row.body,
    generatedAt: row.generated_at,
    sourcesMeta: row.sources_meta || {},
    stale,
    model: row.model || null,
  };
}

async function getCompanySnapshot(companyId, { force = false } = {}) {
  const ctx = await gatherSnapshotContext(companyId);
  if (!ctx) return null;

  const cached = await getCachedSnapshot(companyId);
  const freshEnough =
    cached &&
    cached.generated_at &&
    Date.now() - new Date(cached.generated_at).getTime() < CACHE_MS;
  const hashMatch = cached && cached.input_hash === ctx.inputHash;

  if (!force && cached && freshEnough && hashMatch) {
    return formatResponse(cached, false);
  }

  let parsed;
  let model = process.env.OLLAMA_MODEL || 'kimi';
  try {
    const prompt = buildSnapshotPrompt(ctx);
    const raw = await callOllama(prompt);
    parsed = parseSnapshotText(raw);
    if (!parsed.paragraphs.length) throw new Error('Empty snapshot from model');
  } catch (err) {
    console.error(`[Snapshot] LLM failed for company ${companyId}:`, err.message);
    if (cached) return formatResponse(cached, true);
    parsed = buildFallbackSnapshot(ctx);
    model = 'fallback';
  }

  await saveSnapshot(companyId, parsed, ctx.inputHash, model, ctx.sourcesMeta);
  const saved = await getCachedSnapshot(companyId);
  return formatResponse(saved, false);
}

module.exports = {
  gatherSnapshotContext,
  getCompanySnapshot,
  buildSnapshotPrompt,
  parseSnapshotText,
};
