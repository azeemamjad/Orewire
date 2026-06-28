/**
 * Parse plain-English company search queries into structured filters.
 * Mirrors Server/lib/company-search-parse.js
 */

export type ParsedCompanySearch = {
  textSearch: string;
  commodity: string | null;
  continent: string | null;
  exchange: string | null;
  country: string | null;
  parsed: boolean;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "companies", "company", "for", "in", "junior", "juniors",
  "listed", "miner", "miners", "mining", "on", "or", "stock", "stocks", "the", "with",
]);

type AliasEntry = { patterns: string[]; label?: string; exchange?: string };

const MARKET_ALIASES: AliasEntry[] = [
  { exchange: "TSXV", patterns: ["tsx-v", "tsxv", "tsxv", "venture exchange"] },
  { exchange: "CSE", patterns: ["cse", "canadian securities exchange"] },
  { exchange: "ASX", patterns: ["asx", "australian securities exchange"] },
  { exchange: "TSX", patterns: ["tsx", "toronto stock exchange"] },
];

const COMMODITY_ALIASES: AliasEntry[] = [
  { label: "Rare Earths", patterns: ["rare earths", "rare earth", "ree"] },
  { label: "Gold", patterns: ["gold"] },
  { label: "Silver", patterns: ["silver"] },
  { label: "Copper", patterns: ["copper"] },
  { label: "Lithium", patterns: ["lithium"] },
  { label: "Nickel", patterns: ["nickel"] },
  { label: "Uranium", patterns: ["uranium"] },
  { label: "Zinc", patterns: ["zinc"] },
  { label: "Cobalt", patterns: ["cobalt"] },
];

const CONTINENT_ALIASES: AliasEntry[] = [
  { label: "North America", patterns: ["north america", "north american"] },
  { label: "South America", patterns: ["south america", "latin america"] },
  { label: "Australia", patterns: ["australia", "australian", "oceania"] },
  { label: "Africa", patterns: ["africa", "african"] },
  { label: "Asia", patterns: ["asia", "asian"] },
  { label: "Europe", patterns: ["europe", "european"] },
];

const COUNTRY_ALIASES: AliasEntry[] = [
  { label: "Papua New Guinea", patterns: ["papua new guinea", "png"] },
  { label: "Burkina Faso", patterns: ["burkina faso"] },
  { label: "South Africa", patterns: ["south africa"] },
  { label: "Argentina", patterns: ["argentina"] },
  { label: "Bolivia", patterns: ["bolivia"] },
  { label: "Brazil", patterns: ["brazil"] },
  { label: "Canada", patterns: ["canada", "canadian"] },
  { label: "Chile", patterns: ["chile"] },
  { label: "DRC", patterns: ["drc", "democratic republic of congo", "dr congo"] },
  { label: "Guinea", patterns: ["guinea"] },
  { label: "Mali", patterns: ["mali"] },
  { label: "Mexico", patterns: ["mexico"] },
  { label: "Namibia", patterns: ["namibia"] },
  { label: "Senegal", patterns: ["senegal"] },
  { label: "Turkey", patterns: ["turkey"] },
  { label: "USA", patterns: ["usa", "u.s.a", "u.s.", "united states"] },
  { label: "Zambia", patterns: ["zambia"] },
  { label: "Zimbabwe", patterns: ["zimbabwe"] },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFirst(
  remaining: string,
  aliases: AliasEntry[],
  field: "label" | "exchange",
): { remaining: string; value: string | null } {
  const sorted = [...aliases].sort((a, b) => {
    const al = Math.max(...a.patterns.map((p) => p.length), 0);
    const bl = Math.max(...b.patterns.map((p) => p.length), 0);
    return bl - al;
  });

  for (const entry of sorted) {
    const pats = [...entry.patterns].sort((a, b) => b.length - a.length);
    for (const pat of pats) {
      const re = new RegExp(`\\b${escapeRegex(pat)}\\b`, "i");
      if (re.test(remaining)) {
        return {
          remaining: remaining.replace(re, " "),
          value: (entry[field] as string | undefined) ?? null,
        };
      }
    }
  }
  return { remaining, value: null };
}

export function parseCompanySearchQuery(raw: string): ParsedCompanySearch {
  const q = (raw || "").trim();
  if (!q) {
    return {
      textSearch: "",
      commodity: null,
      continent: null,
      exchange: null,
      country: null,
      parsed: false,
    };
  }

  let remaining = ` ${q.toLowerCase()} `;
  const out: ParsedCompanySearch = {
    textSearch: "",
    commodity: null,
    continent: null,
    exchange: null,
    country: null,
    parsed: false,
  };

  for (const [aliases, field, assign] of [
    [MARKET_ALIASES, "exchange", (v: string) => { out.exchange = v; }] as const,
    [COMMODITY_ALIASES, "label", (v: string) => { out.commodity = v; }] as const,
    [COUNTRY_ALIASES, "label", (v: string) => { out.country = v; }] as const,
    [CONTINENT_ALIASES, "label", (v: string) => { out.continent = v; }] as const,
  ]) {
    const hit = extractFirst(remaining, aliases, field);
    remaining = hit.remaining;
    if (hit.value) {
      assign(hit.value);
      out.parsed = true;
    }
  }

  out.textSearch = remaining
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .trim();

  return out;
}

/** Map parsed TV exchange code to sidebar market label. */
export function parsedExchangeToMarket(exchange: string | null): string | null {
  if (!exchange) return null;
  if (exchange === "TSXV") return "TSX-V";
  return exchange;
}
