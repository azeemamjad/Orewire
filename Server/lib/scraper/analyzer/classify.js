/**
 * Filing-type classification (runs BEFORE the main analysis so we can feed a
 * focused per-type prompt). Hybrid: a free keyword heuristic over the filename /
 * ASX headline / first-page text, with a cheap LLM fallback only when unsure.
 */
const { chatWithSystem } = require('../../ai/client');

// Single source of truth for the canonical filing types (mirrors the analysis
// prompt's canonical list). The classifier will only ever return one of these.
const CANONICAL_TYPES = [
  // Financial & disclosure
  'Financial Statements', 'Quarterly Report', 'Annual Report', 'MD&A', 'AIF',
  'Appendix 4C', 'Appendix 4D', 'Appendix 4E',
  // Technical & exploration
  'Drill Results', 'Exploration Update', 'Technical Report', 'Resource Estimate',
  'PEA', 'PFS', 'FS',
  // Capital markets & financing
  'Private Placement', 'Agency Agreement', 'Short Form Prospectus', 'Shelf Prospectus',
  'NI 43-101', 'Consent of QP', 'Offering Memorandum', 'Rights Offering',
  'Report of Exempt Distribution',
  // Corporate & governance
  'News Release', 'Notice of Meeting', 'Management Information Circular',
  'Business Acquisition Report', 'Normal Course Issuer Bid', 'Change of Auditor',
  'Take-over Bid', 'Certification of Filings', 'Material Change Report',
  'Management Compensation', 'CEO/CFO Appointment',
  // Insider & ownership
  'Insider Report', 'Early Warning Report', 'Substantial Holder Notice',
  "Change of Director's Interest", "Final Director's Interest",
  // Regulatory & compliance
  'Correction', 'Cleansing Notice', 'Appendix 3B',
  'Other',
];
const CANONICAL_SET = new Set(CANONICAL_TYPES);

const HEURISTIC_MIN_CONFIDENCE = Number(process.env.CLASSIFY_MIN_CONFIDENCE || 0.7);

// tier → score weight. Specific / near-deterministic markers score higher.
const TIER_WEIGHT = { strong: 3, medium: 2, weak: 1 };

// Order matters only as a stable tiebreak within a tier; scoring does the real work.
const RULES = [
  { type: 'Appendix 4C', tier: 'strong', re: /\bappendix\s*4c\b|quarterly cash ?flow report/i },
  { type: 'Appendix 4D', tier: 'strong', re: /\bappendix\s*4d\b|half[-\s]?year(ly)? (report|accounts)/i },
  { type: 'Appendix 4E', tier: 'strong', re: /\bappendix\s*4e\b|preliminary final report/i },
  { type: 'Certification of Filings', tier: 'strong', re: /form\s*52-?109|certification of (annual|interim) filings/i },
  { type: 'Technical Report', tier: 'strong', re: /ni\s*43-?101|technical report/i },
  { type: 'Management Information Circular', tier: 'strong', re: /(management )?information circular|proxy circular/i },
  { type: 'Report of Exempt Distribution', tier: 'strong', re: /report of exempt distribution|45-?106f1/i },
  { type: 'Early Warning Report', tier: 'strong', re: /early warning report/i },
  { type: 'Substantial Holder Notice', tier: 'strong', re: /(becoming|ceasing to be) a substantial (holder|shareholder)|substantial (holder|shareholder) notice|form 604/i },
  { type: "Change of Director's Interest", tier: 'strong', re: /change of director'?s interest|appendix\s*3y/i },
  { type: "Final Director's Interest", tier: 'strong', re: /final director'?s interest|appendix\s*3z/i },
  { type: 'Cleansing Notice', tier: 'strong', re: /cleansing notice/i },
  { type: 'Appendix 3B', tier: 'strong', re: /\bappendix\s*3b\b|proposed issue of securities/i },
  { type: 'Business Acquisition Report', tier: 'strong', re: /business acquisition report|51-?102f4/i },
  { type: 'Material Change Report', tier: 'strong', re: /material change report/i },
  { type: 'Normal Course Issuer Bid', tier: 'strong', re: /normal course issuer bid|\bncib\b/i },
  { type: 'Take-over Bid', tier: 'strong', re: /take-?over bid|issuer bid circular/i },
  { type: 'Rights Offering', tier: 'strong', re: /rights offering/i },
  { type: 'Change of Auditor', tier: 'strong', re: /change of auditor/i },
  { type: 'PEA', tier: 'strong', re: /preliminary economic assessment/i },
  { type: 'PFS', tier: 'strong', re: /pre-?feasibility study/i },
  { type: 'FS', tier: 'strong', re: /(definitive )?feasibility study/i },
  { type: 'Consent of QP', tier: 'strong', re: /consent of (the )?qualified person|written consent of .* p\.?geo|consent letter/i },
  { type: 'AIF', tier: 'strong', re: /annual information form/i },
  { type: 'MD&A', tier: 'medium', re: /management'?s discussion (and|&) analysis|\bmd&a\b/i },
  { type: 'Short Form Prospectus', tier: 'medium', re: /short form prospectus/i },
  { type: 'Shelf Prospectus', tier: 'medium', re: /base shelf prospectus|shelf prospectus/i },
  { type: 'NI 43-101', tier: 'medium', re: /ni\s*44-?101|notice of intention to be qualified/i },
  { type: 'Offering Memorandum', tier: 'medium', re: /offering memorandum/i },
  { type: 'Agency Agreement', tier: 'medium', re: /agency agreement|underwriting agreement/i },
  { type: 'Resource Estimate', tier: 'medium', re: /mineral resource estimate|maiden resource|updated resource estimate/i },
  { type: 'Drill Results', tier: 'medium', re: /drill(ing)? results|assay results|drill hole|drill intercept|g\/t (au|gold)|metres? grading/i },
  { type: 'Exploration Update', tier: 'weak', re: /exploration update|geophysic|soil sampl|geochem|mapping program/i },
  { type: 'Private Placement', tier: 'medium', re: /private placement|non-?brokered|brokered financing|bought deal|life financing|listed issuer financing exemption/i },
  { type: 'Notice of Meeting', tier: 'medium', re: /notice of (annual|general|special).{0,20}meeting|notice of agm|annual general (and special )?meeting/i },
  { type: 'CEO/CFO Appointment', tier: 'medium', re: /appoint.{0,30}(ceo|cfo|chief executive|chief financial)|(ceo|cfo|chief executive|chief financial).{0,20}appoint/i },
  { type: 'Management Compensation', tier: 'weak', re: /option grant|rsu grant|dsu grant|grant of (options|awards)|incentive (plan|award)/i },
  { type: 'Insider Report', tier: 'medium', re: /insider report|form 55-?104|system for electronic disclosure by insiders/i },
  { type: 'Quarterly Report', tier: 'medium', re: /quarterly report|(first|second|third|fourth) quarter|q[1-4]\s*20\d{2}/i },
  { type: 'Annual Report', tier: 'medium', re: /annual report/i },
  { type: 'Financial Statements', tier: 'medium', re: /(interim|annual|condensed|consolidated) financial statements|financial statements for/i },
  { type: 'Correction', tier: 'weak', re: /\bcorrection\b|amended and restated|clarif(ies|ication)/i },
  { type: 'News Release', tier: 'weak', re: /news release|press release|\bannounces\b|provides (an )?update/i },
];

/**
 * @returns {{ type: string|null, confidence: number, matched: string[] }}
 */
function classifyHeuristic({ filename = '', headline = '', text = '' } = {}) {
  // Headline + filename carry the strongest signal; a bit of first-page text helps.
  // Normalize filename separators (underscores/dots) to spaces so "Appendix_4C"
  // and "Quarterly_Cashflow" match — but keep hyphens (meaningful in form numbers
  // like 52-109, 45-106F1, NI 43-101).
  const hay = `${headline}\n${filename}\n${String(text).slice(0, 2500)}`.replace(/[_.]+/g, ' ');
  const scores = new Map();
  const matched = [];
  let bestTier = { strong: false, medium: false, weak: false };

  for (const rule of RULES) {
    if (rule.re.test(hay)) {
      const w = TIER_WEIGHT[rule.tier];
      scores.set(rule.type, (scores.get(rule.type) || 0) + w);
      matched.push(rule.type);
      bestTier[rule.tier] = true;
    }
  }

  if (scores.size === 0) return { type: null, confidence: 0, matched };

  let top = null;
  let topScore = -1;
  for (const [type, score] of scores) {
    if (score > topScore) { top = type; topScore = score; }
  }

  // Confidence from the winning score strength + margin over the runner-up.
  const sorted = [...scores.values()].sort((a, b) => b - a);
  const margin = sorted.length > 1 ? sorted[0] - sorted[1] : sorted[0];
  let confidence;
  if (topScore >= TIER_WEIGHT.strong) confidence = margin >= 1 ? 0.92 : 0.85;
  else if (topScore >= TIER_WEIGHT.medium) confidence = margin >= 1 ? 0.75 : 0.68;
  else confidence = 0.5;

  return { type: top, confidence, matched };
}

const CLASSIFY_SYSTEM_PROMPT = `You classify a mining/exploration company's regulatory filing into exactly ONE canonical type. You are given the filing's headline/filename (if any) and the first page of text.

Choose the single best match from this list (respond with the EXACT string):
${CANONICAL_TYPES.join(', ')}

If nothing fits, use "Other". Respond with ONLY valid JSON, no prose:
{"filing_type": "<one of the list>", "confidence": <0.0-1.0>}`;

function stripFences(raw) {
  return String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * Hybrid classify: heuristic first, cheap LLM fallback when confidence is low.
 * @param {object} opts
 * @param {string} opts.text            extracted filing text
 * @param {object} [opts.meta]          { filename, headline, company_name, exchange }
 * @param {string} [opts.model]         model for the fallback (default: cheap)
 * @param {number} [opts.minConfidence]
 * @returns {Promise<{ filing_type, confidence, source }>}
 */
async function classifyFilingType({ text, meta = {}, model, minConfidence = HEURISTIC_MIN_CONFIDENCE } = {}) {
  const h = classifyHeuristic({ filename: meta.filename || meta.pdf_filename, headline: meta.headline, text });
  if (h.type && h.confidence >= minConfidence) {
    return { filing_type: h.type, confidence: h.confidence, source: 'heuristic' };
  }

  // Low confidence → one cheap classify call.
  try {
    const sample = String(text || '').slice(0, 4000);
    const metaLine = [meta.company_name && `Company: ${meta.company_name}`, meta.exchange && `Exchange: ${meta.exchange}`,
      meta.headline && `Headline: ${meta.headline}`, (meta.filename || meta.pdf_filename) && `Filename: ${meta.filename || meta.pdf_filename}`]
      .filter(Boolean).join('\n');
    const { content } = await chatWithSystem({
      feature: 'filing_classify',
      system: CLASSIFY_SYSTEM_PROMPT,
      user: `${metaLine}\n\n[FILING TEXT EXCERPT]\n${sample}`,
      model: model || process.env.CLASSIFY_MODEL || undefined,
      jsonMode: true,
      timeoutMs: 30000,
    });
    const parsed = JSON.parse(stripFences(content));
    const type = CANONICAL_SET.has(parsed.filing_type) ? parsed.filing_type : (h.type || 'Other');
    const conf = typeof parsed.confidence === 'number' ? parsed.confidence : 0.6;
    return { filing_type: type, confidence: conf, source: 'ai' };
  } catch {
    // AI unavailable/paused/error → fall back to the best heuristic guess.
    return {
      filing_type: h.type || 'Other',
      confidence: h.confidence || 0.3,
      source: h.type ? 'heuristic-low' : 'default',
    };
  }
}

// Model tiering: complex filings justify the stronger (reasoner) model. Tiering
// is OFF by default (both tiers use the provider default) so there's no surprise
// cost — enable it by setting ANALYSIS_MODEL_COMPLEX=deepseek-reasoner.
const COMPLEX_TYPES = new Set([
  'Financial Statements', 'Quarterly Report', 'Annual Report', 'MD&A', 'AIF',
  'Appendix 4C', 'Appendix 4D', 'Appendix 4E',
  'Technical Report', 'Resource Estimate', 'PEA', 'PFS', 'FS',
  'Private Placement', 'Agency Agreement', 'Short Form Prospectus', 'Shelf Prospectus',
  'Offering Memorandum', 'Business Acquisition Report', 'Take-over Bid',
  'Management Information Circular',
]);

function modelForFilingType(filingType) {
  if (COMPLEX_TYPES.has(filingType)) return process.env.ANALYSIS_MODEL_COMPLEX || undefined;
  return process.env.ANALYSIS_MODEL_SIMPLE || undefined;
}

module.exports = {
  CANONICAL_TYPES,
  CANONICAL_SET,
  COMPLEX_TYPES,
  HEURISTIC_MIN_CONFIDENCE,
  classifyHeuristic,
  classifyFilingType,
  modelForFilingType,
};
