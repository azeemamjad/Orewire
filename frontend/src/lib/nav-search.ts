import {
  companySlug,
  type CommoditySpot,
  type Company,
  type CurrencySpot,
  type IndexSpot,
} from "@/lib/api";

export type SearchCategory = "companies" | "commodities" | "indexes" | "currencies";

export const CATEGORY_LIMITS: Record<SearchCategory, number> = {
  companies: 4,
  commodities: 2,
  indexes: 2,
  currencies: 1,
};

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  companies: "Companies",
  commodities: "Commodities",
  indexes: "Indexes",
  currencies: "Currencies",
};

const DEFAULT_ORDER: SearchCategory[] = ["companies", "commodities", "indexes", "currencies"];

const commoditySlugMap: Record<string, string> = {
  gold: "GOLD",
  silver: "SLVR",
  copper: "COPR",
  uranium: "URAN",
  lithium: "LITH",
  iron_ore: "IRON",
  nickel: "NICK",
  zinc: "ZINC",
  brent: "BRENT",
  wti: "WTI",
  tin: "TIN",
  cobalt: "COBALT",
  lead: "LEAD",
  platinum: "PLAT",
  palladium: "PALL",
  natgas: "NATGAS",
};

const COMMODITY_ALIASES: Record<string, string[]> = {
  gold: ["au", "xau"],
  silver: ["ag", "xag", "slvr"],
  copper: ["cu", "copr"],
  uranium: ["u3o8", "ura"],
  lithium: ["lit"],
  platinum: ["plat"],
  palladium: ["pall"],
  wti: ["crude", "oil"],
  brent: ["crude", "oil"],
  natgas: ["gas", "ng"],
};

export type NavSearchHit = {
  id: string;
  category: SearchCategory;
  label: string;
  meta?: string;
  href: string;
  score: number;
  company?: Company;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Higher = better match. 0 = no match. */
export function matchScore(query: string, ...fields: (string | null | undefined)[]): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const qn = norm(q);
  let best = 0;

  for (const raw of fields) {
    if (!raw) continue;
    const t = raw.toLowerCase();
    const tn = norm(raw);

    if (t === q || tn === qn) best = Math.max(best, 100);
    else if (t.startsWith(q) || tn.startsWith(qn)) best = Math.max(best, 85);
    else if (/\b/.test(t) && t.split(/\s+/).some((w) => w.startsWith(q))) best = Math.max(best, 70);
    else if (t.includes(q) || tn.includes(qn)) best = Math.max(best, 55);
  }
  return best;
}

function scoreCompany(query: string, c: Company): number {
  const tk = (c.ticker || "").toUpperCase();
  const sedar = (c.sedar_ticker || "").toUpperCase();
  const exactTicker = query.trim().toUpperCase();
  let s = matchScore(query, c.name, c.ticker, c.sedar_ticker, c.exchange, c.sector);
  if (tk && tk === exactTicker) s = Math.max(s, 100);
  if (sedar && sedar === exactTicker) s = Math.max(s, 98);
  if (tk && tk.startsWith(exactTicker) && exactTicker.length >= 1) s = Math.max(s, 90);
  return s;
}

function commoditySlug(key: string): string {
  return commoditySlugMap[key.toLowerCase()] || key.toUpperCase().replace(/_/g, "");
}

function rankHits<T>(
  query: string,
  items: T[],
  scoreFn: (item: T) => number,
  limit: number,
  mapHit: (item: T, score: number) => NavSearchHit,
): NavSearchHit[] {
  return items
    .map((item) => ({ item, score: scoreFn(item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => mapHit(item, score));
}

export function buildNavSearchSections(
  query: string,
  companies: Company[],
  commodities: CommoditySpot[],
  indexes: IndexSpot[],
  currencies: CurrencySpot[],
): { order: SearchCategory[]; sections: Record<SearchCategory, NavSearchHit[]> } {
  const q = query.trim();
  const sections: Record<SearchCategory, NavSearchHit[]> = {
    companies: rankHits(
      q,
      companies,
      (c) => scoreCompany(q, c),
      CATEGORY_LIMITS.companies,
      (c, score) => ({
        id: `co-${c.id}`,
        category: "companies",
        label: c.name,
        meta: c.ticker ? `${(c.exchange || "").toUpperCase()}:${c.ticker}` : undefined,
        href: `/company/${companySlug(c.exchange, c.ticker)}`,
        score,
        company: c,
      }),
    ),
    commodities: rankHits(
      q,
      commodities,
      (c) => {
        const slug = commoditySlug(c.key);
        const aliases = COMMODITY_ALIASES[c.key.toLowerCase()] || [];
        return matchScore(q, c.label, c.key, slug, ...aliases);
      },
      CATEGORY_LIMITS.commodities,
      (c, score) => {
        const slug = commoditySlug(c.key);
        return {
          id: `cm-${c.key}`,
          category: "commodities",
          label: c.label,
          meta: slug,
          href: `/market/commodity/${slug}`,
          score,
        };
      },
    ),
    indexes: rankHits(
      q,
      indexes,
      (i) => matchScore(q, i.label, i.key, i.about),
      CATEGORY_LIMITS.indexes,
      (i, score) => ({
        id: `ix-${i.key}`,
        category: "indexes",
        label: i.label,
        meta: i.key,
        href: `/market/index/${i.key.toUpperCase()}`,
        score,
      }),
    ),
    currencies: rankHits(
      q,
      currencies,
      (c) => matchScore(q, c.label, c.key, c.subtitle),
      CATEGORY_LIMITS.currencies,
      (c, score) => ({
        id: `fx-${c.key}`,
        category: "currencies",
        label: c.label,
        meta: c.subtitle || c.key,
        href: `/market/currency/${c.key.toUpperCase()}`,
        score,
      }),
    ),
  };

  const order = DEFAULT_ORDER.filter((cat) => sections[cat].length > 0).sort((a, b) => {
    const scoreA = sections[a][0]?.score ?? 0;
    const scoreB = sections[b][0]?.score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b);
  });

  return { order, sections };
}

export function allSuggestionHrefs(sections: Record<SearchCategory, NavSearchHit[]>): Set<string> {
  const hrefs = new Set<string>();
  for (const cat of DEFAULT_ORDER) {
    sections[cat].forEach((h) => hrefs.add(h.href));
  }
  return hrefs;
}
