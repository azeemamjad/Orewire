/** Curated mining / markets hashtags for daily threads. */

const CURATED = [
  '#Mining',
  '#Gold',
  '#Silver',
  '#Copper',
  '#TSX',
  '#TSXV',
  '#JuniorMining',
  '#Commodities',
  '#NaturalResources',
  '#CanadaMining',
  '#OreWire',
];

const COMMODITY_HINTS = [
  { re: /\bgold\b/i, tag: '#Gold' },
  { re: /\bsilver\b/i, tag: '#Silver' },
  { re: /\bcopper\b/i, tag: '#Copper' },
  { re: /\blithium\b/i, tag: '#Lithium' },
  { re: /\buranium\b/i, tag: '#Uranium' },
  { re: /\bnickel\b/i, tag: '#Nickel' },
  { re: /\bzinc\b/i, tag: '#Zinc' },
  { re: /\bpg[em]\b|platinum|palladium/i, tag: '#PGM' },
];

function pickFromText(text, limit = 5) {
  const blob = String(text || '');
  const picked = new Set(['#Mining', '#OreWire']);
  for (const { re, tag } of COMMODITY_HINTS) {
    if (re.test(blob)) picked.add(tag);
    if (picked.size >= limit) break;
  }
  if (/\btsx[- ]?v\b|tsxv/i.test(blob)) picked.add('#TSXV');
  else if (/\btsx\b/i.test(blob)) picked.add('#TSX');

  for (const tag of CURATED) {
    if (picked.size >= limit) break;
    picked.add(tag);
  }
  return [...picked].slice(0, limit);
}

async function pickHashtags(items = [], { count = 4 } = {}) {
  const text = items.map((i) => `${i.label || ''} ${i.summary || ''} ${i.ticker || ''}`).join(' ');
  const curated = pickFromText(text, count);
  return curated.length ? curated : CURATED.slice(0, count);
}

module.exports = { pickHashtags, CURATED, pickFromText };
