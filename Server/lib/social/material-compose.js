/**
 * AI writer for template-driven material posts.
 *
 * The model writes prose only: a short title and the body lines. Code owns the locked
 * emojis, the link line, the URL and the hashtags (see material-templates.buildText),
 * so the fixed formats from the PDF can never be broken by the model.
 *
 * Safety gates before a post may be published:
 *   1. every required field present  (else "suppressed")
 *   2. every number in the post appears in the source analysis (numeric grounding)
 *   3. total length <= 280 characters
 * Each gate gets one retry, then the post is suppressed with a recorded reason.
 */
const { chatWithSystem } = require('../ai/client');
const { appBase } = require('./select');
const {
  TEMPLATES,
  BODY_GUIDE,
  KNOWN_COMMODITIES,
  missingRequired,
  requiredFields,
  buildText,
  commodityFor,
  normalizeCommodity,
} = require('./material-templates');

const MAX_TWEET = 280;

/** A resource post is only valid if it actually states a resource category. */
const RESOURCE_CATEGORY_RE = /\b(measured|indicated|inferred|proved|probable|m&i|total)\b/i;

/**
 * Permitting posts must describe a COMPLETED milestone. A filing that merely mentions a
 * pending/submitted/anticipated permit is not an approval and must not use the ✅ frame.
 */
const PENDING_RE = /\b(pending|not yet|awaiting|anticipated|expected to|application|applied|submitted|seeking|plans? to|proposed|conditional)\b/i;

const TITLE_GUIDE = {
  drill: 'e.g. "Drill Results Are In" or "Hits 42m at 6.8 g/t Au"',
  financing: 'e.g. "Closes $8M Private Placement" or "Closes Bought Deal"',
  resource: 'e.g. "Files NI 43-101" or "Maiden Resource Estimate"',
  study: 'e.g. "Releases PEA" or "Releases Feasibility Study"',
  permitting: 'e.g. "Receives Environmental Permit"',
  partnership: 'e.g. "Announces Earn-In Agreement" or "Announces Acquisition"',
};

const SYSTEM_PROMPT = `You write ONE X (Twitter) post for OreWire, a mining-filings intelligence account covering TSX, TSX-V, CSE and ASX companies.

You are filling a FIXED template. The system already adds the ticker, the locked emojis, the link line, the URL and the hashtags — you must NOT include any of those.

HARD RULES:
- Respond with ONLY valid JSON. No prose, no markdown fences.
- Never invent a fact, figure, name, or project. Use only values present in the SOURCE DATA.
- Copy numbers EXACTLY as they appear in the source — do not abbreviate ($8,000,000 stays $8,000,000), do not convert units, do not round.
- If a required value is genuinely absent from the source, list it in "missing" rather than guessing.
- Plain, factual, specific. No hype, no adjectives like "exciting", no emojis, no hashtags, no links, no @mentions.
- Be brief: the whole post must fit in 280 characters including the system-added lines. Use 1-3 short body lines.`;

function parseJson(content) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI response contained no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Everything the model is allowed to draw on for this filing. */
function sourceBlob(candidate) {
  const c = candidate || {};
  const parts = [
    c.company_display || c.company_name,
    c.ticker ? `Ticker: ${c.ticker}` : null,
    c.company_exchange || c.exchange ? `Exchange: ${c.company_exchange || c.exchange}` : null,
    c.filing_type ? `Filing type: ${c.filing_type}` : null,
    c.ticker_summary && `Ticker summary: ${c.ticker_summary}`,
    c.summary && `Summary: ${c.summary}`,
    c.verdict_reason && `Verdict reason: ${c.verdict_reason}`,
    Array.isArray(c.key_facts) && c.key_facts.length ? `Key facts: ${c.key_facts.join(' | ')}` : null,
    c.context && `Context: ${c.context}`,
    c.grade_commentary && `Grade commentary: ${c.grade_commentary}`,
    c.what_to_watch && `What to watch: ${c.what_to_watch}`,
    c.resource_estimate ? `Resource estimate: ${JSON.stringify(c.resource_estimate)}` : null,
    c.pp_amount != null ? `Private placement amount: ${c.pp_amount}` : null,
    c.pp_price != null ? `Private placement price: ${c.pp_price}` : null,
  ];
  const parsed = c.raw_response ? safeParseJson(c.raw_response) : null;
  const ext = parsed?.data_extracted;
  if (ext && typeof ext === 'object') parts.push(`Structured data: ${JSON.stringify(ext)}`);
  return parts.filter(Boolean).join('\n');
}

/** Canonical numeric tokens in a blob: "8,000,000" -> "8000000", "42.0" -> "42". */
function numberSet(text) {
  const out = new Set();
  const re = /\d+(?:[.,]\d+)*/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.add(String(n));
  }
  return out;
}

/**
 * Numbers in the post that do not appear in the source.
 * Accepts a magnitude shift (M / k / B abbreviations) to avoid false positives.
 */
function ungroundedNumbers(postText, source) {
  const src = numberSet(source);
  const bad = [];
  for (const token of numberSet(postText)) {
    if (src.has(token)) continue;
    const n = Number(token);
    let ok = false;
    for (const mag of [1e3, 1e6, 1e9]) {
      if (src.has(String(n * mag)) || src.has(String(n / mag))) { ok = true; break; }
    }
    if (!ok) bad.push(token);
  }
  return bad;
}

/**
 * Does one of `nums` appear in `text` (magnitude-tolerant), optionally near a keyword?
 * The anchor window stops an unrelated figure from satisfying the check — without it an
 * IRR of "20" would be "found" inside "20-year mine life".
 */
function numberAppearsInText(text, nums, anchor, window = 32) {
  const wanted = new Set(nums);
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0].replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;

    let hit = false;
    for (const want of wanted) {
      if (want === raw || want === String(n)) { hit = true; break; }
      const w = Number(want);
      if (Number.isFinite(w)
        && [1e3, 1e6, 1e9].some((k) => String(w * k) === String(n) || String(w / k) === String(n))) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    if (!anchor) return true;

    const from = Math.max(0, m.index - window);
    const to = Math.min(text.length, m.index + m[0].length + window);
    if (anchor.test(text.slice(from, to))) return true;
  }
  return false;
}

/**
 * Required fields that carry a number must actually surface that number in the post —
 * otherwise the model filled the slot but wrote a body that omits the headline figure
 * (e.g. a financing post with no amount, or a study post with no IRR).
 */
function valuesMissingFromText(fields, text, templateKey) {
  const spec = TEMPLATES[templateKey];
  if (!spec) return [];
  const out = [];
  for (const f of spec.fields) {
    if (!f.required || !f.numeric) continue; // only headline figures are verified
    const value = fields?.[f.name];
    if (value == null) continue;
    const nums = [...numberSet(typeof value === 'string' ? value : JSON.stringify(value))];
    if (!nums.length) continue; // purely textual field — nothing to verify
    const anchor = f.anchor ? new RegExp(f.anchor, 'i') : null;
    if (!numberAppearsInText(text, nums, anchor)) out.push(f.name);
  }
  return out;
}

function buildUserPrompt(candidate, { shorten = false, extra = '' } = {}) {
  const cat = candidate.category;
  const spec = TEMPLATES[cat];
  const guide = BODY_GUIDE[cat] || [];
  const req = requiredFields(cat);
  const source = sourceBlob(candidate);

  return `CATEGORY: ${spec.label}

1) "title" — a SHORT completion of the fixed opener. The system prints:
   "<emoji> $${candidate.ticker} <your title> <emoji>"
   So do NOT repeat the ticker and do NOT add emojis. ${TITLE_GUIDE[cat] || ''}

2) "body" — an array of 1-${Math.max(1, guide.length)} short lines following this shape exactly
   (omit any line whose values are unavailable rather than guessing):
${guide.map((g) => `   - ${g}`).join('\n')}

3) "commodity" — the PRIMARY commodity of the project or news, exactly one of:
${KNOWN_COMMODITIES.map((c) => `   - ${c}`).join('\n')}
   Use the main commodity, NOT an incidental by-product credit. Use null if genuinely unclear.
   The system turns this into a hashtag — do not write a hashtag yourself.

4) "fields" — an object with these REQUIRED values copied from the source:
${req.map((f) => `   - ${f}`).join('\n')}

5) "missing" — array of required field names you could not find in the source (usually empty).

RESPOND WITH EXACTLY THIS JSON SHAPE:
{"title": "<string>", "commodity": "<one of the list or null>", "body": ["<line>", "..."], "fields": { ${req.map((f) => `"${f}": "<value>"`).join(', ')} }, "missing": []}
${shorten ? '\nIMPORTANT: the previous attempt was too long. Make the body shorter — at most 2 lines, no line over 90 characters.\n' : ''}${extra}
SOURCE DATA (the only facts you may use):
${source}`;
}

/** One AI call. */
async function generateOnce(candidate, opts = {}) {
  const res = await chatWithSystem({
    feature: 'social_post_generate',
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(candidate, opts),
    model: process.env.SOCIAL_POST_MODEL || undefined,
    jsonMode: true,
    timeoutMs: Number(process.env.SOCIAL_POST_TIMEOUT_MS) || 60000,
  });
  return { parsed: parseJson(res.content), model: res.model || null, content: res.content };
}

function siteUrl(candidate) {
  return `${appBase()}/filings/${candidate.filing_id}`;
}

function render(candidate, parsed, { bodyOverride } = {}) {
  const templateKey = candidate.category;
  const body = bodyOverride || (Array.isArray(parsed.body) ? parsed.body : []);
  // Prefer the model's PRIMARY commodity; fall back to a regex over the source text.
  const commodity = normalizeCommodity(parsed.commodity)
    || commodityFor(
      candidate.summary,
      candidate.ticker_summary,
      candidate.grade_commentary,
      JSON.stringify(parsed.fields || {}),
    );
  const text = buildText({
    templateKey,
    ticker: candidate.ticker,
    title: parsed.title,
    body,
    commodity,
    url: siteUrl(candidate),
  });
  return { text, commodity };
}

/**
 * Deterministically shorten an over-long post by dropping one body line at a time,
 * keeping the last line (the takeaway). Returns null if it still will not fit.
 */
function shrinkToFit(candidate, parsed) {
  const body = Array.isArray(parsed.body) ? [...parsed.body] : [];
  while (body.length > 1) {
    body.splice(body.length - 2, 1);
    const { text } = render(candidate, parsed, { bodyOverride: body });
    if (text.length <= MAX_TWEET) return { text, body };
  }
  return null;
}

/**
 * Full generation + validation for one candidate.
 * @returns {Promise<{ok:boolean, status:string, reason?:string, text?:string, fields?:object,
 *                    missing?:string[], model?:string|null, raw?:object, attempts:number}>}
 */
async function composeMaterialPost(candidate) {
  let attempts = 0;
  let last = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    const shorten = attempt > 1 && last?.reason === 'too_long';
    let extra = '';
    if (attempt > 1) {
      if (last?.reason === 'ungrounded_number') {
        extra = `\nIMPORTANT: the previous attempt used numbers that are NOT in the source (${last.detail}). Use ONLY numbers that appear verbatim in the SOURCE DATA.\n`;
      } else if (last?.reason === 'value_not_in_text') {
        extra = `\nIMPORTANT: the previous body omitted these required values (${last.detail}). Every required value MUST appear inside the body lines.\n`;
      }
    }

    let generated;
    try {
      generated = await generateOnce(candidate, { shorten, extra });
    } catch (err) {
      return { ok: false, status: 'failed', reason: 'ai_error', detail: err?.message || String(err), attempts };
    }

    const parsed = generated.parsed || {};
    const fields = parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {};

    // Gate 1 — required fields
    const missing = [
      ...new Set([
        ...missingRequired(candidate.category, fields),
        ...(Array.isArray(parsed.missing) ? parsed.missing.map(String) : []),
      ]),
    ];

    // Gate 1b — a "resource" post must actually state a resource category, otherwise
    // the model is forcing drill/prose content into the NI 43-101 shape.
    if (
      candidate.category === 'resource'
      && !RESOURCE_CATEGORY_RE.test(JSON.stringify(fields.categories || ''))
      && !missing.includes('categories')
    ) {
      missing.push('categories');
    }

    // Gate 1c — a "permitting" post must describe a completed approval, not a pending
    // one. Check the title too: the model may move "pending" out of the `approved` field.
    if (
      candidate.category === 'permitting'
      && PENDING_RE.test(`${parsed.title || ''} ${fields.approved || ''}`)
      && !missing.includes('approved')
    ) {
      missing.push('approved');
    }

    if (missing.length) {
      return {
        ok: false, status: 'suppressed', reason: 'missing_fields', missing,
        fields, model: generated.model, raw: parsed, attempts,
      };
    }

    const { text: fullText, commodity } = render(candidate, parsed);
    if (commodity) fields.commodity = commodity;

    // The URL is excluded from the text checks: it contains the filing id, which is not
    // in the source analysis and would otherwise look like an invented number.
    const stripUrl = (t) => t.split('\n').filter((l) => l.trim() !== siteUrl(candidate)).join('\n');

    // Gate 2 — numeric grounding
    const bad = ungroundedNumbers(stripUrl(fullText), sourceBlob(candidate));
    if (bad.length) {
      last = { reason: 'ungrounded_number', detail: bad.join(', ') };
      if (attempt === 2) {
        return {
          ok: false, status: 'suppressed', reason: 'ungrounded_number', detail: bad.join(', '),
          text: fullText, fields, model: generated.model, raw: parsed, attempts,
        };
      }
      continue;
    }

    // Gate 3 — length. Shrink BEFORE the value check so that check sees exactly the text
    // that would be published: shrinking drops body lines, and dropping a line after
    // validation is how a post could previously go out missing its IRR/NPV.
    let text = fullText;
    if (text.length > MAX_TWEET) {
      const shrunk = shrinkToFit(candidate, parsed);
      if (!shrunk) {
        last = { reason: 'too_long', detail: `${fullText.length} chars` };
        if (attempt === 2) {
          return {
            ok: false, status: 'suppressed', reason: 'too_long', detail: `${fullText.length} chars`,
            text: fullText, fields, model: generated.model, raw: parsed, attempts,
          };
        }
        continue;
      }
      text = shrunk.text;
    }

    // Gate 4 — the headline required values must actually appear in the FINAL text
    const notInText = valuesMissingFromText(fields, stripUrl(text), candidate.category);
    if (notInText.length) {
      last = { reason: 'value_not_in_text', detail: notInText.join(', ') };
      if (attempt === 2) {
        return {
          ok: false, status: 'suppressed', reason: 'value_not_in_text',
          detail: notInText.join(', '), missing: notInText,
          text, fields, model: generated.model, raw: parsed, attempts,
        };
      }
      continue;
    }

    return { ok: true, status: 'generated', text, fields, model: generated.model, raw: parsed, attempts };
  }

  return { ok: false, status: 'failed', reason: 'exhausted', attempts };
}

module.exports = {
  MAX_TWEET,
  SYSTEM_PROMPT,
  TITLE_GUIDE,
  sourceBlob,
  numberSet,
  ungroundedNumbers,
  buildUserPrompt,
  generateOnce,
  render,
  shrinkToFit,
  numberAppearsInText,
  valuesMissingFromText,
  composeMaterialPost,
  siteUrl,
  parseJson,
};
