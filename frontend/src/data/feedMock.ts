/**
 * Feed mock data — sample filings/news items for the landing-page feed cards.
 *
 * Ported from the Lovable export (src/data/feedMock.ts). This is presentation
 * sample data, NOT a data source: OreWire's real feed comes from the API via
 * @/features/news/api and @/features/home/api.
 *
 * One deliberate change from the export: the `href` values are the real
 * OreWire routes (`/news`, `/filings`) instead of the export's invented
 * `/news/<mock-id>` slugs, which would render NotFound in this app.
 */

export type Verdict = "Noteworthy" | "Watch" | "Routine";
export type Exchange = "TSX" | "TSX-V" | "CSE" | "ASX";

export interface FeedItem {
  id: string;
  ticker: string;
  exchange: Exchange;
  company: string;
  category: string; // News category OR filing type
  verdict: Verdict;
  time: string;
  summary: string;
  href: string;
}

export const verdictPill: Record<Verdict, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

export const NEWS_FEED: FeedItem[] = [
  {
    id: "scz-hercules-1",
    ticker: "SCZ",
    exchange: "TSX-V",
    company: "Scorpio Gold Resources",
    category: "Drill Results",
    verdict: "Noteworthy",
    time: "12 min ago",
    summary: "Hole HC-247 returns 12.4m @ 3.2 g/t Au, 2.4× deposit average; ends in mineralization.",
    href: "/news",
  },
  {
    id: "deg-hemi-mre",
    ticker: "DEG",
    exchange: "ASX",
    company: "De Grey Mining",
    category: "Resource Estimate",
    verdict: "Noteworthy",
    time: "47 min ago",
    summary: "Hemi Indicated resource lifted 18% to 6.8 Moz Au ahead of Q3 feasibility.",
    href: "/news",
  },
  {
    id: "nfg-step",
    ticker: "NFG",
    exchange: "TSX-V",
    company: "New Found Gold",
    category: "Drill Results",
    verdict: "Noteworthy",
    time: "1 hr ago",
    summary: "Step-out 4 km north of Keats returns 2.1m @ 24 g/t Au; opens new corridor.",
    href: "/news",
  },
  {
    id: "gr-keymet-pp",
    ticker: "GR",
    exchange: "CSE",
    company: "Great Atlantic Resources",
    category: "Private Placement",
    verdict: "Watch",
    time: "2 hrs ago",
    summary: "C$4.2M flow-through at $0.18; 22% insider participation. Funds Q3 drilling.",
    href: "/news",
  },
  {
    id: "rms-mtm-ext",
    ticker: "RMS",
    exchange: "ASX",
    company: "Ramelius Resources",
    category: "Drill Results",
    verdict: "Watch",
    time: "3 hrs ago",
    summary: "Mt Magnet extension hole returns 4.1m @ 8.7 g/t Au below pit, continuity confirmed.",
    href: "/news",
  },
  {
    id: "cxo-quarterly",
    ticker: "CXO",
    exchange: "ASX",
    company: "Core Lithium",
    category: "Quarterly Update",
    verdict: "Routine",
    time: "4 hrs ago",
    summary: "Finniss Q3 produces 24kt SC6, in line with guidance. Cash A$87M; FY26 unchanged.",
    href: "/news",
  },
  {
    id: "nxe-pce",
    ticker: "NXE",
    exchange: "TSX-V",
    company: "NexGen Energy",
    category: "Technical Report",
    verdict: "Noteworthy",
    time: "5 hrs ago",
    summary: "First Indicated at Patterson Corridor East: 19.2 Mlb U₃O₈ @ 3.1%.",
    href: "/news",
  },
  {
    id: "fil-fds",
    ticker: "FIL",
    exchange: "TSX-V",
    company: "Filo Mining",
    category: "Assay Results",
    verdict: "Noteworthy",
    time: "6 hrs ago",
    summary: "Filo del Sol delivers 156m @ 1.4% CuEq from 412m, well above PEA.",
    href: "/news",
  },
  {
    id: "ago-mara",
    ticker: "AGO",
    exchange: "ASX",
    company: "Atlas Iron",
    category: "Corporate Update",
    verdict: "Routine",
    time: "7 hrs ago",
    summary: "Annual shareholder meeting reschedules to Aug 14; agenda items unchanged.",
    href: "/news",
  },
  {
    id: "abx-mc",
    ticker: "ABX",
    exchange: "TSX",
    company: "Barrick Mining",
    category: "Material Change",
    verdict: "Watch",
    time: "8 hrs ago",
    summary: "Reggane permit reinstated by Mali tribunal; production restart targeted Q4.",
    href: "/news",
  },
];

export const FILING_TYPES = [
  "NI 43-101 Technical Reports",
  "JORC Resource Reports",
  "Drill Results",
  "Private Placements",
  "Quarterly Financials",
  "Material Change Reports",
  "Early Warning Reports",
  "Insider Reports",
  "Annual Information Forms",
  "Proxy Circulars",
  "ASX Quarterly Activity Reports",
  "Substantial Holder Notices",
];

export const FILINGS_FEED: FeedItem[] = [
  {
    id: "f-scz-43101",
    ticker: "SCZ",
    exchange: "TSX-V",
    company: "Scorpio Gold Resources",
    category: "NI 43-101",
    verdict: "Noteworthy",
    time: "22 min ago",
    summary: "Updated MRE: 1.42 Moz Indicated @ 1.8 g/t Au, 31% category upgrade vs prior.",
    href: "/filings",
  },
  {
    id: "f-deg-jorc",
    ticker: "DEG",
    exchange: "ASX",
    company: "De Grey Mining",
    category: "JORC Resource",
    verdict: "Noteworthy",
    time: "1 hr ago",
    summary: "Hemi JORC 2012 update: 11.7 Moz total; Indicated now 6.8 Moz.",
    href: "/filings",
  },
  {
    id: "f-nfg-mc",
    ticker: "NFG",
    exchange: "TSX-V",
    company: "New Found Gold",
    category: "Material Change",
    verdict: "Noteworthy",
    time: "2 hrs ago",
    summary: "AFZ-988 high-grade step-out triggers 25,000m follow-up program.",
    href: "/filings",
  },
  {
    id: "f-gr-pp",
    ticker: "GR",
    exchange: "CSE",
    company: "Great Atlantic Resources",
    category: "Private Placement",
    verdict: "Watch",
    time: "3 hrs ago",
    summary: "Subscription agreement: C$4.2M flow-through @ $0.18, half-warrant @ $0.28.",
    href: "/filings",
  },
  {
    id: "f-cxo-5b",
    ticker: "CXO",
    exchange: "ASX",
    company: "Core Lithium",
    category: "Appendix 5B",
    verdict: "Routine",
    time: "4 hrs ago",
    summary: "Cash flow report: A$87M cash; quarterly opex A$22M; 4 quarters runway.",
    href: "/filings",
  },
  {
    id: "f-rms-mdna",
    ticker: "RMS",
    exchange: "ASX",
    company: "Ramelius Resources",
    category: "Quarterly MD&A",
    verdict: "Routine",
    time: "5 hrs ago",
    summary: "AISC A$1,820/oz; FY guidance reaffirmed at 280-310 koz.",
    href: "/filings",
  },
  {
    id: "f-nxe-aif",
    ticker: "NXE",
    exchange: "TSX-V",
    company: "NexGen Energy",
    category: "Annual Information Form",
    verdict: "Routine",
    time: "6 hrs ago",
    summary: "FY25 AIF filed; no material changes to risk factors or property disclosures.",
    href: "/filings",
  },
  {
    id: "f-fil-ewr",
    ticker: "FIL",
    exchange: "TSX-V",
    company: "Filo Mining",
    category: "Early Warning Report",
    verdict: "Watch",
    time: "7 hrs ago",
    summary: "BHP increases stake to 11.2% via market purchases, first crossing of 10%.",
    href: "/filings",
  },
  {
    id: "f-abx-proxy",
    ticker: "ABX",
    exchange: "TSX",
    company: "Barrick Mining",
    category: "Proxy Circular",
    verdict: "Routine",
    time: "9 hrs ago",
    summary: "2026 AGM circular; board slate unchanged, say-on-pay advisory included.",
    href: "/filings",
  },
  {
    id: "f-ago-shn",
    ticker: "AGO",
    exchange: "ASX",
    company: "Atlas Iron",
    category: "Substantial Holder Notice",
    verdict: "Watch",
    time: "11 hrs ago",
    summary: "Hancock Prospecting lifts holding to 19.9%, just under takeover threshold.",
    href: "/filings",
  },
];
