/**
 * Market news mock data — sample global market headlines.
 *
 * Ported from the Lovable export (src/data/marketNews.ts). This is presentation
 * sample data, NOT a data source: OreWire's real market news comes from the API
 * via @/features/news/api. Used only by the anonymous landing section
 * <MarketNewsSection />.
 */

export interface MarketNewsItem {
  id: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: string; // short label e.g. "2h ago"
  category?: string;
}

export const MARKET_NEWS: MarketNewsItem[] = [
  {
    id: "mn-1",
    headline: "Gold tops $2,420/oz as Fed signals slower rate path; miners rally",
    source: "Reuters",
    url: "https://www.reuters.com/markets/commodities/",
    publishedAt: "18m ago",
    category: "Gold",
  },
  {
    id: "mn-2",
    headline: "Copper hits 10-week high on China stimulus, LME stocks slide",
    source: "Bloomberg",
    url: "https://www.bloomberg.com/markets/commodities",
    publishedAt: "42m ago",
    category: "Copper",
  },
  {
    id: "mn-3",
    headline: "Uranium spot prices climb back above $92/lb as utilities return to market",
    source: "Kitco",
    url: "https://www.kitco.com/news/",
    publishedAt: "1h ago",
    category: "Uranium",
  },
  {
    id: "mn-4",
    headline: "Lithium glut deepens, Pilbara Minerals warns of further price weakness",
    source: "Mining.com",
    url: "https://www.mining.com/",
    publishedAt: "2h ago",
    category: "Lithium",
  },
  {
    id: "mn-5",
    headline: "Newmont raises 2026 guidance after record Q1 free cash flow",
    source: "Northern Miner",
    url: "https://www.northernminer.com/",
    publishedAt: "3h ago",
    category: "Gold",
  },
  {
    id: "mn-6",
    headline: "BHP, Rio Tinto pause exploration in Pilbara on heritage review",
    source: "AFR",
    url: "https://www.afr.com/companies/mining",
    publishedAt: "4h ago",
    category: "Iron Ore",
  },
  {
    id: "mn-7",
    headline: "Silver outperforms gold YTD as industrial demand from solar surges",
    source: "Reuters",
    url: "https://www.reuters.com/markets/commodities/",
    publishedAt: "5h ago",
    category: "Silver",
  },
  {
    id: "mn-8",
    headline: "Canada's critical minerals strategy adds $1.5B for processing facilities",
    source: "Globe and Mail",
    url: "https://www.theglobeandmail.com/business/industry-news/energy-and-resources/",
    publishedAt: "6h ago",
    category: "Policy",
  },
  {
    id: "mn-9",
    headline: "Indonesia tightens nickel export licenses; LME nickel jumps 4%",
    source: "Financial Times",
    url: "https://www.ft.com/commodities",
    publishedAt: "7h ago",
    category: "Nickel",
  },
  {
    id: "mn-10",
    headline: "Junior gold ETF GDXJ posts best monthly gain since 2020",
    source: "Bloomberg",
    url: "https://www.bloomberg.com/markets/commodities",
    publishedAt: "8h ago",
    category: "Gold",
  },
  {
    id: "mn-11",
    headline: "Tesla signs five-year offtake with Vulcan Energy for European lithium",
    source: "Reuters",
    url: "https://www.reuters.com/business/energy/",
    publishedAt: "9h ago",
    category: "Lithium",
  },
  {
    id: "mn-12",
    headline: "Cameco beats Q1 estimates as long-term uranium contracts re-price higher",
    source: "Kitco",
    url: "https://www.kitco.com/news/",
    publishedAt: "10h ago",
    category: "Uranium",
  },
  {
    id: "mn-13",
    headline: "Chile's Codelco copper output falls to 25-year low in Q1",
    source: "Mining Weekly",
    url: "https://www.miningweekly.com/",
    publishedAt: "11h ago",
    category: "Copper",
  },
  {
    id: "mn-14",
    headline: "ASX-listed De Grey Mining acquired by Northern Star in A$5B all-share deal",
    source: "AFR",
    url: "https://www.afr.com/companies/mining",
    publishedAt: "12h ago",
    category: "M&A",
  },
  {
    id: "mn-15",
    headline: "Platinum, palladium diverge as EV transition hits autocatalyst demand",
    source: "Reuters",
    url: "https://www.reuters.com/markets/commodities/",
    publishedAt: "14h ago",
    category: "PGM",
  },
  {
    id: "mn-16",
    headline: "First Quantum eyes Cobre Panama restart after government talks resume",
    source: "Northern Miner",
    url: "https://www.northernminer.com/",
    publishedAt: "16h ago",
    category: "Copper",
  },
  {
    id: "mn-17",
    headline: "Gold streaming royalties hit record $4.8B in 2025, Wheaton leads",
    source: "Mining.com",
    url: "https://www.mining.com/",
    publishedAt: "18h ago",
    category: "Gold",
  },
  {
    id: "mn-18",
    headline: "ASX 200 Materials index gains 2.1% as iron ore rebounds above $108/t",
    source: "AFR",
    url: "https://www.afr.com/companies/mining",
    publishedAt: "20h ago",
    category: "Iron Ore",
  },
  {
    id: "mn-19",
    headline: "Glencore reports record Q1 zinc production from Mount Isa restart",
    source: "Bloomberg",
    url: "https://www.bloomberg.com/markets/commodities",
    publishedAt: "1d ago",
    category: "Zinc",
  },
  {
    id: "mn-20",
    headline: "US to stockpile cobalt, graphite under new Defense Production Act order",
    source: "Reuters",
    url: "https://www.reuters.com/business/energy/",
    publishedAt: "1d ago",
    category: "Critical Minerals",
  },
  {
    id: "mn-21",
    headline: "Barrick CEO says copper now equal priority to gold; eyes Zambia expansion",
    source: "Financial Times",
    url: "https://www.ft.com/commodities",
    publishedAt: "1d ago",
    category: "Copper",
  },
  {
    id: "mn-22",
    headline: "TSX Venture Composite up 12% YTD, led by junior gold and uranium plays",
    source: "Globe and Mail",
    url: "https://www.theglobeandmail.com/business/industry-news/energy-and-resources/",
    publishedAt: "1d ago",
    category: "Markets",
  },
  {
    id: "mn-23",
    headline: "Tin prices spike on Myanmar Wa State mining permit delays",
    source: "Mining Weekly",
    url: "https://www.miningweekly.com/",
    publishedAt: "2d ago",
    category: "Tin",
  },
  {
    id: "mn-24",
    headline: "Agnico Eagle declares special dividend after Detour Lake beats guidance",
    source: "Kitco",
    url: "https://www.kitco.com/news/",
    publishedAt: "2d ago",
    category: "Gold",
  },
  {
    id: "mn-25",
    headline: "Rare earth prices firm as China consolidates state producers further",
    source: "Reuters",
    url: "https://www.reuters.com/markets/commodities/",
    publishedAt: "2d ago",
    category: "Rare Earths",
  },
];
