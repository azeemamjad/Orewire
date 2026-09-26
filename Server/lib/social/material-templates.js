/**
 * Locked X post templates for material filings.
 *
 * Source: "Orewire Twitter Post Template.pdf" — fixed formats with locked emojis so
 * followers recognise the shape instantly. This module is the single source of truth
 * for: category keys, locked emojis, the body skeleton, the fields each template needs,
 * and how a filing maps to a category.
 *
 * Division of labour: the AI writes the *prose* (title + body lines + field values).
 * Code owns the category, the emojis, the link line, the URL and the hashtags — so a
 * model can never break the locked format.
 */

const APP_LINK_LINE = {
  drill: 'Full results + section map 👇',
  financing: 'Details 👇',
  resource: 'Full report 👇',
  study: 'Full study 👇',
  permitting: 'Details 👇',
  partnership: 'Full details 👇',
};

/** Fixed tail hashtags per category (PDF shows #Drilling only on drill results). */
const TAIL_HASHTAGS = {
  drill: ['#Drilling'],
};

/**
 * @typedef {{ name: string, label: string, required: boolean, numeric?: boolean, anchor?: string, hint: string }} FieldSpec
 *   `numeric: true` marks a headline figure that must also surface in the post body.
 *   `anchor` (a case-insensitive regex source) additionally requires that figure to appear
 *   near a matching keyword — e.g. the IRR number must sit next to "IRR", so an unrelated
 *   "20-year mine life" cannot satisfy it.
 */

const TEMPLATES = {
  drill: {
    key: 'drill',
    label: 'Drill Results / Assay Results',
    short: 'Drill / Assay Results',
    emojis: { header: '🎯', hook: '⛏' },
    defaultTitle: 'Drill Results Are In',
    linkLine: APP_LINK_LINE.drill,
    tailHashtags: TAIL_HASHTAGS.drill,
    filingTypes: ['Drill Results'],
    fields: [
      { name: 'project', label: 'Project name', required: false, hint: 'e.g. "Red Fox Project"' },
      { name: 'holeId', label: 'Hole ID', required: false, hint: 'e.g. "RF-24-018"' },
      { name: 'interval', label: 'Intercept length', required: true, numeric: true, hint: 'e.g. "42.0m"' },
      { name: 'grade', label: 'Grade', required: true, numeric: true, hint: 'e.g. "6.8 g/t Au" or "1.2% Cu"' },
      { name: 'width', label: 'True or downhole width', required: false, hint: 'e.g. "est. 35m true width"' },
      { name: 'takeaway', label: 'One-line takeaway', required: true, hint: 'Why this hole matters — extension, new zone, high-grade core' },
    ],
  },

  financing: {
    key: 'financing',
    label: 'Financings / Capital Raises',
    short: 'Financings',
    emojis: { header: '💰', hook: '📈' },
    defaultTitle: 'Closes Financing',
    linkLine: APP_LINK_LINE.financing,
    filingTypes: ['Private Placement', 'Agency Agreement', 'Rights Offering', 'Short Form Prospectus', 'Shelf Prospectus', 'Offering Memorandum'],
    fields: [
      { name: 'financingType', label: 'Financing type', required: true, hint: '"Private Placement", "Bought Deal", "Strategic Investment"' },
      { name: 'amount', label: 'Amount raised', required: true, numeric: true, hint: 'e.g. "$8,000,000"' },
      { name: 'pricePerShare', label: 'Price per share', required: true, numeric: true, hint: 'e.g. "$0.45"' },
      { name: 'useOfProceeds', label: 'Use of proceeds', required: false, hint: 'e.g. "fully funds Phase 2 drilling"' },
      { name: 'participant', label: 'Notable participant', required: false, hint: 'Only if it adds credibility; omit otherwise' },
    ],
  },

  resource: {
    key: 'resource',
    label: 'NI 43-101 Resource Estimate',
    short: 'Resource Estimate',
    emojis: { header: '🚨', hook: '👀' },
    defaultTitle: 'Files NI 43-101',
    linkLine: APP_LINK_LINE.resource,
    filingTypes: ['NI 43-101', 'Resource Estimate', 'Technical Report'],
    fields: [
      { name: 'project', label: 'Project name', required: true, hint: 'Name of the mining project' },
      { name: 'categories', label: 'Resource categories', required: true, numeric: true, hint: 'Array of 1-2 { category, tonnage, grade } e.g. Indicated: 2.1 Moz Au at 1.8 g/t' },
      { name: 'takeaway', label: 'One-line takeaway', required: true, hint: 'Why it matters — one sentence' },
    ],
  },

  study: {
    key: 'study',
    label: 'PEA / PFS / Feasibility Study',
    short: 'PEA / PFS / FS',
    emojis: { header: '📊', hook: '💡' },
    defaultTitle: 'Releases Study',
    linkLine: APP_LINK_LINE.study,
    filingTypes: ['PEA', 'PFS', 'FS'],
    fields: [
      { name: 'studyType', label: 'Study type', required: true, hint: '"PEA", "Pre-Feasibility Study (PFS)" or "Feasibility Study (FS)"' },
      { name: 'project', label: 'Project name', required: true, hint: 'Name of the project' },
      { name: 'npv', label: 'After-tax NPV', required: true, numeric: true, anchor: 'npv', hint: 'e.g. "$410M"' },
      { name: 'discountPct', label: 'Discount rate', required: false, hint: 'e.g. "5%"' },
      { name: 'irr', label: 'After-tax IRR', required: true, numeric: true, anchor: 'irr|internal rate', hint: 'e.g. "38"' },
      { name: 'payback', label: 'Payback years', required: false, hint: 'e.g. "2.1"' },
      { name: 'capex', label: 'Initial capex', required: false, hint: 'e.g. "$185M"' },
      { name: 'takeaway', label: 'One-line takeaway', required: true, hint: 'How this re-rates the project' },
    ],
  },

  permitting: {
    key: 'permitting',
    label: 'Permitting Milestones',
    short: 'Permitting',
    emojis: { header: '✅', hook: '🏗' },
    defaultTitle: 'Receives Permit',
    linkLine: APP_LINK_LINE.permitting,
    filingTypes: [], // keyword-detected only
    fields: [
      { name: 'permitType', label: 'Permit type', required: true, hint: '"Environmental Permit", "Construction Permit", "Mining License"' },
      { name: 'project', label: 'Project name', required: true, hint: 'Name of the project' },
      { name: 'approved', label: 'What was approved', required: true, hint: 'Plain-language approval + issuing body' },
      { name: 'takeaway', label: 'One-line takeaway', required: true, hint: 'What this unlocks next — construction, financing, timeline' },
    ],
  },

  partnership: {
    key: 'partnership',
    label: 'Strategic Partnerships / JV / M&A',
    short: 'Partnerships / M&A',
    emojis: { header: '🤝', hook: '🌍' },
    defaultTitle: 'Announces Agreement',
    linkLine: APP_LINK_LINE.partnership,
    filingTypes: ['Business Acquisition Report', 'Take-over Bid'],
    fields: [
      { name: 'dealType', label: 'Deal type', required: true, hint: '"Earn-In Agreement", "Joint Venture", "Offtake Agreement", "Acquisition"' },
      { name: 'counterparty', label: 'Counterparty', required: true, hint: 'Partner, acquirer or target name' },
      { name: 'project', label: 'Project name', required: true, hint: 'Project involved' },
      { name: 'dealTerms', label: 'Deal terms', required: true, hint: 'Key economics in one line, e.g. "70% earn-in over 4 years for $20M spend"' },
      { name: 'takeaway', label: 'One-line takeaway', required: true, hint: 'Why this partner/deal matters strategically' },
    ],
  },
};

const CATEGORY_KEYS = Object.keys(TEMPLATES);

const TEMPLATE_LABELS = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, TEMPLATES[k].label]));

/** Direct filing_type -> category. */
const TYPE_TO_CATEGORY = {};
for (const key of CATEGORY_KEYS) {
  for (const t of TEMPLATES[key].filingTypes) TYPE_TO_CATEGORY[t] = key;
}

/** Filing types whose category has to be inferred from prose keywords. */
const KEYWORD_ELIGIBLE_TYPES = new Set(['News Release', 'Material Change Report', 'Other', 'Exploration Update', '']);

/** Strongest-news-first when a filing could match several categories. */
const CATEGORY_PRIORITY = ['partnership', 'study', 'resource', 'financing', 'permitting', 'drill'];

/** A Technical Report that reports economics is a study, not a bare resource. */
const ECONOMICS_RE = /\bNPV\b|\bIRR\b|internal rate of return|after-?tax|payback|pre-?feasibility|preliminary economic assessment|feasibility study|\bcapex\b|discount rate/i;

/** Keyword rules, evaluated in CATEGORY_PRIORITY order. */
const KEYWORD_RULES = [
  {
    category: 'partnership',
    re: /\bearn-?in\b|\bjoint venture\b|\bJV\b|\bofftake\b|\bmerger\b|\bacquisi|\bdefinitive agreement\b|strategic investment|\boption agreement\b|\bfarm-?in\b|\bamalgamat|\btake-?over\b/i,
  },
  {
    category: 'permitting',
    // Requires a real permit/licence/regulatory milestone. A bare "approval" or
    // "application" is too weak — it matches funding and administrative news.
    re: /\bpermit(?:s|ted|ting)?\b|\blicen[cs]e\b|\bEIA\b|environmental assessment|environmental approval|\bconstruction (?:decision|permit)\b|\bmining (?:lease|licen[cs]e)\b|\bregulatory approval\b|\bministerial approval\b|\bdevelopment permit\b/i,
  },
];

/**
 * The body lines (between the fixed header line and the fixed link line) per category,
 * taken from the PDF. Used as the instruction skeleton for the AI writer. Lines in
 * [BRACKETS] are placeholders; a line whose values are unavailable must be omitted.
 */
const BODY_GUIDE = {
  drill: [
    '[PROJECT NAME] — [HOLE ID]',
    '[INTERVAL] at [GRADE] ([WIDTH TRUE/DOWNHOLE])',
    '[ONE-LINE TAKEAWAY — why this hole matters]',
  ],
  financing: [
    '[AMOUNT RAISED] at [PRICE PER SHARE]/share',
    '[USE OF PROCEEDS, e.g. "fully funds Phase 2 drilling"]',
    '[NOTABLE PARTICIPANT — only if any]',
  ],
  resource: [
    '[PROJECT NAME] resource is in:',
    '• [RESOURCE CATEGORY]: [OUNCES/TONNAGE] at [GRADE]',
    '• [RESOURCE CATEGORY 2]: [OUNCES/TONNAGE] at [GRADE]',
    '[ONE-LINE TAKEAWAY]',
  ],
  study: [
    '[PROJECT NAME] economics:',
    '• After-tax NPV[DISCOUNT %]: [NPV]',
    '• IRR: [IRR]%',
    '• Payback: [PAYBACK] yrs | Capex: [CAPEX]',
    '[ONE-LINE TAKEAWAY — how this re-rates the project]',
  ],
  permitting: [
    '[PROJECT NAME] just cleared a major milestone:',
    '[WHAT WAS APPROVED, in plain language]',
    '[ONE-LINE TAKEAWAY — what this unlocks next]',
  ],
  partnership: [
    '[COUNTERPARTY NAME] — [PROJECT NAME]',
    '[DEAL TERMS in one line]',
    '[ONE-LINE TAKEAWAY — why this partner/deal matters]',
  ],
};

/**
 * Commodity -> hashtag token (mirrors lib/social/hashtags.js hints).
 * Order matters only for the regex fallback; the AI reports the PRIMARY commodity and
 * `normalizeCommodity` validates it, which avoids picking an incidental by-product
 * (e.g. an "Au" credit inside a CuEq calculation) over the actual commodity.
 */
const COMMODITY_TAGS = [
  { re: /\bgold\b|\bg\/t\s*au\b|\bau\b/i, tag: 'Gold' },
  { re: /\bsilver\b|\bag\b/i, tag: 'Silver' },
  { re: /\bcopper\b|\bcu\b|cueq/i, tag: 'Copper' },
  { re: /\blithium\b|spodumene/i, tag: 'Lithium' },
  { re: /\buranium\b|u3o8|u₃o₈/i, tag: 'Uranium' },
  { re: /\bnickel\b/i, tag: 'Nickel' },
  { re: /\bzinc\b/i, tag: 'Zinc' },
  { re: /\bpgm\b|platinum|palladium/i, tag: 'PGM' },
  { re: /\biron\b|hematite|magnetite/i, tag: 'Iron' },
  { re: /\brare[\s-]?earth/i, tag: 'RareEarths' },
  { re: /\bgraphite\b/i, tag: 'Graphite' },
  { re: /\bcobalt\b/i, tag: 'Cobalt' },
  { re: /\bmolybden/i, tag: 'Molybdenum' },
  { re: /\bpotash\b/i, tag: 'Potash' },
  { re: /\bantimony\b/i, tag: 'Antimony' },
  { re: /\btin\b/i, tag: 'Tin' },
  { re: /\btungsten\b|\bwo3\b|wolfram/i, tag: 'Tungsten' },
  { re: /\bmanganese\b/i, tag: 'Manganese' },
  { re: /\bvanadium\b/i, tag: 'Vanadium' },
  { re: /\bchromium\b|chromite/i, tag: 'Chromium' },
  { re: /\bdiamond/i, tag: 'Diamonds' },
  { re: /\bphosphate\b|apatite/i, tag: 'Phosphate' },
];

/** Canonical commodity names the model may return. */
const KNOWN_COMMODITIES = COMMODITY_TAGS.map((c) => c.tag);

const COMMODITY_SYNONYMS = {
  au: 'Gold',
  gold: 'Gold',
  ag: 'Silver',
  silver: 'Silver',
  cu: 'Copper',
  copper: 'Copper',
  li: 'Lithium',
  lithium: 'Lithium',
  u: 'Uranium',
  uranium: 'Uranium',
  ni: 'Nickel',
  nickel: 'Nickel',
  zn: 'Zinc',
  zinc: 'Zinc',
  pgm: 'PGM',
  platinum: 'PGM',
  palladium: 'PGM',
  fe: 'Iron',
  iron: 'Iron',
  ree: 'RareEarths',
  rareearths: 'RareEarths',
  'rare earths': 'RareEarths',
  'rare-earth': 'RareEarths',
  graphite: 'Graphite',
  cobalt: 'Cobalt',
  molybdenum: 'Molybdenum',
  moly: 'Molybdenum',
  potash: 'Potash',
  antimony: 'Antimony',
  tin: 'Tin',
  tungsten: 'Tungsten',
  wo3: 'Tungsten',
  wolfram: 'Tungsten',
  manganese: 'Manganese',
  vanadium: 'Vanadium',
  chromium: 'Chromium',
  chromite: 'Chromium',
  diamonds: 'Diamonds',
  diamond: 'Diamonds',
  phosphate: 'Phosphate',
  apatite: 'Phosphate',
};

/** Validate a model-reported commodity into a safe hashtag token, else null. */
function normalizeCommodity(value) {
  const v = String(value || '').trim().replace(/^#/, '').toLowerCase();
  if (!v) return null;
  const exact = KNOWN_COMMODITIES.find((tag) => tag.toLowerCase() === v);
  if (exact) return exact;
  return COMMODITY_SYNONYMS[v] || null;
}

function commodityFor(...texts) {
  const blob = texts.filter(Boolean).join(' ');
  for (const { re, tag } of COMMODITY_TAGS) {
    if (re.test(blob)) return tag;
  }
  return null;
}

/**
 * Resolve a filing to a material category.
 * @param {{ filing_type?: string, blob?: string }} opts  blob = lowercase filename + summaries
 * @returns {string|null} category key
 */
function categoryFor({ filing_type, blob = '' } = {}) {
  const type = String(filing_type || '').trim();
  const hay = String(blob || '');

  // Technical Report splits between resource and study depending on economics.
  if (type === 'Technical Report') {
    return ECONOMICS_RE.test(hay) ? 'study' : 'resource';
  }

  const direct = TYPE_TO_CATEGORY[type];
  if (direct) return direct;

  if (KEYWORD_ELIGIBLE_TYPES.has(type)) {
    for (const cat of CATEGORY_PRIORITY) {
      const rule = KEYWORD_RULES.find((r) => r.category === cat);
      if (rule && rule.re.test(hay)) return cat;
    }
  }
  return null;
}

/** Fields the AI must supply before a post may be published. */
function requiredFields(templateKey) {
  return (TEMPLATES[templateKey]?.fields || []).filter((f) => f.required).map((f) => f.name);
}

/**
 * Which required fields are absent/blank. `fields` is the AI's structured output.
 * @returns {string[]} missing field names
 */
function missingRequired(templateKey, fields = {}) {
  const out = [];
  for (const name of requiredFields(templateKey)) {
    const v = fields?.[name];
    if (v == null) { out.push(name); continue; }
    if (typeof v === 'string' && !v.trim()) out.push(name);
    if (Array.isArray(v) && v.length === 0) out.push(name);
  }
  return out;
}

/** Fixed reference block handed to the AI so it fills the locked shape. */
function promptSpec(templateKey) {
  const t = TEMPLATES[templateKey];
  if (!t) throw new Error(`Unknown template: ${templateKey}`);
  return {
    key: t.key,
    label: t.label,
    titleExample: t.defaultTitle,
    fields: t.fields,
    required: requiredFields(templateKey),
  };
}

/**
 * Assemble the final tweet. Code owns emojis, link line, URL and hashtags.
 * @returns {string}
 */
function buildText({ templateKey, ticker, title, body = [], commodity, url }) {
  const t = TEMPLATES[templateKey];
  if (!t) throw new Error(`Unknown template: ${templateKey}`);

  const sym = ticker ? `$${String(ticker).toUpperCase().replace(/^\$/, '')}` : '';
  const head = [t.emojis.header, sym, String(title || t.defaultTitle).trim(), t.emojis.hook]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // X rejects any post carrying more than one cashtag (`$SYMBOL`). The headline
  // above already carries it, so strip a repeat from the body if one appears.
  const stripSym = (line) => {
    if (!sym) return line;
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return line
      .replace(new RegExp(`${escaped}(?![A-Za-z0-9])`, 'gi'), '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const lines = [head];
  for (const raw of body) {
    const line = stripSym(String(raw ?? '').trim());
    if (line) lines.push(line);
  }
  lines.push(t.linkLine);
  lines.push(url);

  // Hashtags only — the cashtag must not be repeated here (one cashtag per post).
  const tagLine = ['#Mining', commodity ? `#${commodity}` : null, ...(t.tailHashtags || [])]
    .filter(Boolean)
    .join(' ');
  lines.push(tagLine);

  return lines.join('\n');
}

module.exports = {
  CATEGORY_KEYS,
  CATEGORY_PRIORITY,
  TEMPLATES,
  TEMPLATE_LABELS,
  TYPE_TO_CATEGORY,
  KEYWORD_ELIGIBLE_TYPES,
  KEYWORD_RULES,
  ECONOMICS_RE,
  APP_LINK_LINE,
  BODY_GUIDE,
  COMMODITY_TAGS,
  KNOWN_COMMODITIES,
  categoryFor,
  requiredFields,
  missingRequired,
  promptSpec,
  buildText,
  commodityFor,
  normalizeCommodity,
};
