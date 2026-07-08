/** API key → canonical URL slug */
const COMMODITY_SLUGS = {
  gold: 'GOLD',
  silver: 'SILVER',
  copper: 'COPPER',
  lithium: 'LITHIUM',
  iron_ore: 'IRON',
  nickel: 'NICKEL',
  zinc: 'ZINC',
  brent: 'BRENT',
  wti: 'WTI',
  tin: 'TIN',
  cobalt: 'COBALT',
  lead: 'LEAD',
  platinum: 'PLATINUM',
  palladium: 'PALLADIUM',
  natgas: 'NATGAS',
};

/** Legacy abbreviated slugs → API key */
const LEGACY_SLUG_TO_KEY = {
  SLVR: 'silver',
  COPR: 'copper',
  LITH: 'lithium',
  NICK: 'nickel',
  PLAT: 'platinum',
  PALL: 'palladium',
};

const SLUG_TO_KEY = Object.fromEntries(
  Object.entries(COMMODITY_SLUGS).map(([key, slug]) => [slug, key]),
);

function commoditySlugFromKey(key) {
  return COMMODITY_SLUGS[String(key || '').toLowerCase()] || String(key || '').toUpperCase().replace(/_/g, '');
}

function commodityApiKeyFromSlug(slug) {
  const upper = String(slug || '').toUpperCase();
  if (LEGACY_SLUG_TO_KEY[upper]) return LEGACY_SLUG_TO_KEY[upper];
  if (SLUG_TO_KEY[upper]) return SLUG_TO_KEY[upper];
  return String(slug || '').toLowerCase();
}

module.exports = {
  COMMODITY_SLUGS,
  LEGACY_SLUG_TO_KEY,
  commoditySlugFromKey,
  commodityApiKeyFromSlug,
};
