/**
 * Parse plain-English company search queries into structured filters.
 * e.g. "gold companies in Africa" → { commodity: 'Gold', continent: 'Africa', textSearch: '' }
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'companies', 'company', 'for', 'in', 'junior', 'juniors',
  'listed', 'miner', 'miners', 'mining', 'on', 'or', 'stock', 'stocks', 'the', 'with',
]);

const MARKET_ALIASES = [
  { exchange: 'TSXV', patterns: ['tsx-v', 'tsxv', 'tsxv', 'venture exchange'] },
  { exchange: 'CSE', patterns: ['cse', 'canadian securities exchange'] },
  { exchange: 'ASX', patterns: ['asx', 'australian securities exchange'] },
  { exchange: 'TSX', patterns: ['tsx', 'toronto stock exchange'] },
];

const COMMODITY_ALIASES = [
  { label: 'Rare Earths', patterns: ['rare earths', 'rare earth', 'ree'] },
  { label: 'Gold', patterns: ['gold'] },
  { label: 'Silver', patterns: ['silver'] },
  { label: 'Copper', patterns: ['copper'] },
  { label: 'Lithium', patterns: ['lithium'] },
  { label: 'Nickel', patterns: ['nickel'] },
  { label: 'Uranium', patterns: ['uranium'] },
  { label: 'Zinc', patterns: ['zinc'] },
  { label: 'Cobalt', patterns: ['cobalt'] },
];

const CONTINENT_ALIASES = [
  { label: 'North America', patterns: ['north america', 'north american'] },
  { label: 'South America', patterns: ['south america', 'latin america'] },
  { label: 'Australia', patterns: ['australia', 'australian', 'oceania'] },
  { label: 'Africa', patterns: ['africa', 'african'] },
  { label: 'Asia', patterns: ['asia', 'asian'] },
  { label: 'Europe', patterns: ['europe', 'european'] },
];

// Longer country names first so "south africa" wins over continent "africa".
const COUNTRY_ALIASES = [
  { label: 'Papua New Guinea', patterns: ['papua new guinea', 'png'] },
  { label: 'Burkina Faso', patterns: ['burkina faso'] },
  { label: 'South Africa', patterns: ['south africa'] },
  { label: 'Argentina', patterns: ['argentina'] },
  { label: 'Australia', patterns: [] }, // continent match handles "australia"
  { label: 'Bolivia', patterns: ['bolivia'] },
  { label: 'Brazil', patterns: ['brazil'] },
  { label: 'Canada', patterns: ['canada', 'canadian'] },
  { label: 'Chile', patterns: ['chile'] },
  { label: 'DRC', patterns: ['drc', 'democratic republic of congo', 'dr congo'] },
  { label: 'Guinea', patterns: ['guinea'] },
  { label: 'Mali', patterns: ['mali'] },
  { label: 'Mexico', patterns: ['mexico'] },
  { label: 'Namibia', patterns: ['namibia'] },
  { label: 'Senegal', patterns: ['senegal'] },
  { label: 'Turkey', patterns: ['turkey'] },
  { label: 'USA', patterns: ['usa', 'u.s.a', 'u.s.', 'united states'] },
  { label: 'Zambia', patterns: ['zambia'] },
  { label: 'Zimbabwe', patterns: ['zimbabwe'] },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFirst(remaining, aliases, field) {
  const sorted = [...aliases].sort((a, b) => {
    const al = Math.max(...a.patterns.map((p) => p.length), 0);
    const bl = Math.max(...b.patterns.map((p) => p.length), 0);
    return bl - al;
  });

  for (const entry of sorted) {
    const pats = [...entry.patterns].sort((a, b) => b.length - a.length);
    for (const pat of pats) {
      const re = new RegExp(`\\b${escapeRegex(pat)}\\b`, 'i');
      if (re.test(remaining)) {
        return {
          remaining: remaining.replace(re, ' '),
          value: entry[field],
        };
      }
    }
  }
  return { remaining, value: null };
}

/**
 * @param {string} raw
 * @returns {{
 *   textSearch: string,
 *   commodity: string|null,
 *   continent: string|null,
 *   exchange: string|null,
 *   country: string|null,
 *   parsed: boolean,
 * }}
 */
function parseCompanySearchQuery(raw) {
  const q = String(raw || '').trim();
  if (!q) {
    return {
      textSearch: '',
      commodity: null,
      continent: null,
      exchange: null,
      country: null,
      parsed: false,
    };
  }

  let remaining = ` ${q.toLowerCase()} `;
  const out = {
    textSearch: '',
    commodity: null,
    continent: null,
    exchange: null,
    country: null,
    parsed: false,
  };

  let hit;

  hit = extractFirst(remaining, MARKET_ALIASES, 'exchange');
  remaining = hit.remaining;
  if (hit.value) { out.exchange = hit.value; out.parsed = true; }

  hit = extractFirst(remaining, COMMODITY_ALIASES, 'label');
  remaining = hit.remaining;
  if (hit.value) { out.commodity = hit.value; out.parsed = true; }

  hit = extractFirst(remaining, COUNTRY_ALIASES, 'label');
  remaining = hit.remaining;
  if (hit.value) { out.country = hit.value; out.parsed = true; }

  hit = extractFirst(remaining, CONTINENT_ALIASES, 'label');
  remaining = hit.remaining;
  if (hit.value) { out.continent = hit.value; out.parsed = true; }

  const words = remaining
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));

  out.textSearch = words.join(' ').trim();
  return out;
}

module.exports = { parseCompanySearchQuery };
