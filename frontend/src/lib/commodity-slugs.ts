/** API key → canonical URL slug */
export const COMMODITY_SLUGS: Record<string, string> = {
  gold: "GOLD",
  silver: "SILVER",
  copper: "COPPER",
  lithium: "LITHIUM",
  iron_ore: "IRON",
  nickel: "NICKEL",
  zinc: "ZINC",
  brent: "BRENT",
  wti: "WTI",
  tin: "TIN",
  cobalt: "COBALT",
  lead: "LEAD",
  platinum: "PLATINUM",
  palladium: "PALLADIUM",
  natgas: "NATGAS",
};

/** Legacy abbreviated slugs → API key */
export const LEGACY_SLUG_TO_KEY: Record<string, string> = {
  SLVR: "silver",
  COPR: "copper",
  LITH: "lithium",
  NICK: "nickel",
  PLAT: "platinum",
  PALL: "palladium",
};

/** Canonical slug → API key */
const SLUG_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(COMMODITY_SLUGS).map(([key, slug]) => [slug, key]),
);

/** Canonical slug → display label */
export const COMMODITY_SLUG_LABELS: Record<string, string> = {
  GOLD: "Gold",
  SILVER: "Silver",
  COPPER: "Copper",
  LITHIUM: "Lithium",
  IRON: "Iron Ore",
  NICKEL: "Nickel",
  ZINC: "Zinc",
  BRENT: "Brent",
  WTI: "Crude (WTI)",
  TIN: "Tin",
  COBALT: "Cobalt",
  LEAD: "Lead",
  PLATINUM: "Platinum",
  PALLADIUM: "Palladium",
  NATGAS: "Natural Gas",
};

export function commoditySlugFromKey(key: string): string {
  return COMMODITY_SLUGS[key.toLowerCase()] || key.toUpperCase().replace(/_/g, "");
}

export function commodityApiKeyFromSlug(slug: string): string {
  const upper = slug.toUpperCase();
  if (LEGACY_SLUG_TO_KEY[upper]) return LEGACY_SLUG_TO_KEY[upper];
  if (SLUG_TO_KEY[upper]) return SLUG_TO_KEY[upper];
  return slug.toLowerCase();
}

export function canonicalCommoditySlug(slug: string): string {
  const upper = slug.toUpperCase();
  const apiKey = commodityApiKeyFromSlug(upper);
  return commoditySlugFromKey(apiKey);
}

export function isLegacyCommoditySlug(slug: string): boolean {
  const upper = slug.toUpperCase();
  return upper in LEGACY_SLUG_TO_KEY && canonicalCommoditySlug(upper) !== upper;
}
