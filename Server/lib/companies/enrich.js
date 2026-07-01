// Shared company enrichment helpers — derive commodity / geography tags from a
// companies row + its raw_data JSON. Used by routes/companies.js (listing &
// detail) and routes/watchlist.js (so watchlist rows carry the same tags).

// Commodity keys we surface (label → list of raw_data keys to OR together)
const COMMODITY_KEYS = {
  Gold:        ['Gold'],
  Silver:      ['Silver'],
  Copper:      ['Copper'],
  Lithium:     ['Lithium'],
  Nickel:      ['Nickel'],
  Uranium:     ['Uranium'],
  Zinc:        ['Zinc'],
  Cobalt:      ['Cobalt'],
  'Rare Earths': ['Rare Earths'],
};

// Continent label → raw_data column name
const CONTINENT_KEYS = {
  Africa:          'AFRICA',
  'North America': null,           // OR of CANADA / USA
  'South America': 'LATIN AMERICA',
  Australia:       'AUS/NZ/PNG',
  Asia:            'ASIA',
  Europe:          'UK/EUROPE',
};

function safeParse(json) {
  if (!json) return null;
  try { return typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; }
}

function deriveCommodities(row, raw) {
  const out = [];
  if (row.has_gold)    out.push('Gold');
  if (row.has_silver)  out.push('Silver');
  if (row.has_copper)  out.push('Copper');
  if (raw) {
    for (const [label, keys] of Object.entries(COMMODITY_KEYS)) {
      if (out.includes(label)) continue;
      for (const k of keys) {
        if (raw[k] && String(raw[k]).toUpperCase() === 'Y') { out.push(label); break; }
      }
    }
  }
  return Array.from(new Set(out));
}

function deriveContinents(raw) {
  if (!raw) return [];
  const out = [];
  if (raw['AFRICA'])         out.push('Africa');
  if (raw['ASIA'])           out.push('Asia');
  if (raw['AUS/NZ/PNG'])     out.push('Australia');
  if (raw['LATIN AMERICA'])  out.push('South America');
  if (raw['UK/EUROPE'])      out.push('Europe');
  if (raw['USA'] || raw['CANADA']) out.push('North America');
  return Array.from(new Set(out));
}

function deriveCountry(raw) {
  if (!raw) return null;
  // Specific country columns first
  const pieces = [];
  for (const col of ['AFRICA','ASIA','AUS/NZ/PNG','LATIN AMERICA','UK/EUROPE','OTHER']) {
    if (raw[col]) pieces.push(String(raw[col]));
  }
  if (raw['CANADA']) pieces.push('Canada');
  if (raw['USA'])    pieces.push('USA');
  // De-dupe + truncate
  const set = Array.from(new Set(pieces.flatMap(s => s.split(/[,;]/).map(x => x.trim()).filter(Boolean))));
  return set.length ? set.slice(0, 2).join(', ') : null;
}

module.exports = {
  COMMODITY_KEYS,
  CONTINENT_KEYS,
  safeParse,
  deriveCommodities,
  deriveContinents,
  deriveCountry,
};
