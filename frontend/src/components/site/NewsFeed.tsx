import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import NewsReleaseItem from "@/components/site/NewsReleaseItem";
import {
  cleanNewsSummary,
  getNewsFilingType,
  getNewsSeverity,
  isCompanyLinkedNews,
  newsDisplayTime,
  newsItemHref,
} from "@/components/site/news-release-utils";

type HeroNewsItem = NewsItem & {
  exchange?: string | null;
  company?: string | null;
  slug?: string;
  severity?: string;
  filingType?: string;
};

const placeholderItems: HeroNewsItem[] = [
  {
    title: "Hole EL-247 returned 12.4m @ 3.2 g/t Au, 2.4× deposit average. Mineralization remains open at depth.",
    summary: "Hole EL-247 returned 12.4m @ 3.2 g/t Au, 2.4× deposit average. Mineralization remains open at depth.",
    source: "TMX Newsfile",
    pubDate: "2026-04-24T07:31:00-04:00",
    timeAgo: "Apr 24 · 7:31 AM",
    commodity: "Gold",
    sentiment: "bullish",
    link: "scz-eagle-lake-el247",
    pubDate: "",
    ticker: "SCZ",
    exchange: "TSX-V",
    company: "Santa Cruz Resources",
    companyId: 1,
    severity: "Critical",
    filingType: "Drill Result",
  },
  {
    title: "Hemi Indicated resource increased 18% to 6.8 Moz Au. Conversion drilling continues ahead of feasibility.",
    summary: "Hemi Indicated resource increased 18% to 6.8 Moz Au. Conversion drilling continues ahead of feasibility.",
    source: "GlobeNewsWire",
    pubDate: "2026-04-24T06:42:00-04:00",
    timeAgo: "Apr 24 · 6:42 AM",
    commodity: "Gold",
    sentiment: "bullish",
    link: "deg-hemi-resource",
    pubDate: "",
    ticker: "DEG",
    exchange: "ASX",
    company: "De Grey Mining",
    companyId: 2,
    severity: "High",
    filingType: "Resource Update",
  },
  {
    title: "Step-out hole 4 km north of Keats returned 2.1m @ 24 g/t Au, opening a new exploration corridor.",
    summary: "Step-out hole 4 km north of Keats returned 2.1m @ 24 g/t Au, opening a new exploration corridor.",
    source: "TMX Newsfile",
    pubDate: "2026-04-24T05:22:00-04:00",
    timeAgo: "Apr 24 · 5:22 AM",
    commodity: "Gold",
    sentiment: "bullish",
    link: "nfg-stepout-appleton",
    pubDate: "",
    ticker: "NFG",
    exchange: "TSX-V",
    company: "New Found Gold",
    companyId: 3,
    severity: "High",
    filingType: "Drill Result",
  },
  {
    title: "First Indicated category at PCE: 19.2 Mlb U₃O₈ at 3.1% U₃O₈, advancing toward feasibility.",
    summary: "First Indicated category at PCE: 19.2 Mlb U₃O₈ at 3.1% U₃O₈, advancing toward feasibility.",
    source: "GlobeNewsWire",
    pubDate: "2026-04-24T04:04:00-04:00",
    timeAgo: "Apr 24 · 4:04 AM",
    commodity: "Uranium",
    sentiment: "bullish",
    link: "nxe-patterson-east",
    pubDate: "",
    ticker: "NXE",
    exchange: "TSX-V",
    company: "NexGen Energy",
    companyId: 4,
    severity: "High",
    filingType: "Technical Report",
  },
  {
    title: "$4.2M flow-through placement at $0.18, 0.8× market cap. Insider participation 22%. Funds for Q3 drilling at Keymet.",
    summary: "$4.2M flow-through placement at $0.18, 0.8× market cap. Insider participation 22%. Funds for Q3 drilling at Keymet.",
    source: "TMX Newsfile",
    pubDate: "2026-04-24T02:58:00-04:00",
    timeAgo: "Apr 24 · 2:58 AM",
    commodity: null,
    sentiment: "neutral",
    link: "gr-keymet-placement",
    pubDate: "",
    ticker: "GR",
    exchange: "CSE",
    company: "Great Atlantic Resources",
    companyId: 5,
    severity: "Medium",
    filingType: "Private Placement",
  },
  {
    title: "Finniss production 24kt SC6, in line with guidance. Cash $87M. FY26 outlook unchanged.",
    summary: "Finniss production 24kt SC6, in line with guidance. Cash $87M. FY26 outlook unchanged.",
    source: "GlobeNewsWire",
    pubDate: "2026-04-24T09:00:00-04:00",
    timeAgo: "Apr 24 · 9:00 AM",
    commodity: "Lithium",
    sentiment: "neutral",
    link: "cxo-finniss-quarterly",
    pubDate: "",
    ticker: "CXO",
    exchange: "ASX",
    company: "Core Lithium",
    companyId: 6,
    severity: "Low",
    filingType: "Quarterly",
  },
  {
    title: "Mt Magnet extension drilling returned 4.1m @ 8.7 g/t Au below existing pit. Confirms continuity.",
    summary: "Mt Magnet extension drilling returned 4.1m @ 8.7 g/t Au below existing pit. Confirms continuity.",
    source: "TMX Newsfile",
    pubDate: "2026-04-24T07:44:00-04:00",
    timeAgo: "Apr 24 · 7:44 AM",
    commodity: "Gold",
    sentiment: "bullish",
    link: "rms-mt-magnet-extension",
    pubDate: "",
    ticker: "RMS",
    exchange: "ASX",
    company: "Ramelius Resources",
    companyId: 7,
    severity: "Medium",
    filingType: "Drill Result",
  },
  {
    title: "156m @ 1.4% CuEq from 412m at Filo del Sol, grade and width well above PEA averages.",
    summary: "156m @ 1.4% CuEq from 412m at Filo del Sol, grade and width well above PEA averages.",
    source: "GlobeNewsWire",
    pubDate: "2026-04-24T00:31:00-04:00",
    timeAgo: "Apr 24 · 12:31 AM",
    commodity: "Copper",
    sentiment: "bullish",
    link: "fil-filo-del-sol",
    pubDate: "",
    ticker: "FIL",
    exchange: "TSX-V",
    company: "Filo Mining",
    companyId: 8,
    severity: "Critical",
    filingType: "Assay",
  },
];

/** Hero column: company-linked news releases only. */
const NewsFeed = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["news-feed", 20, "rss", "company-linked"],
    queryFn: () => fetchNewsFeed({ limit: 20, origin: "rss", companyLinked: true }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  const items = useMemo(() => {
    const live = (data?.items || []).filter(isCompanyLinkedNews).filter((item) => item.ticker);
    if (live.length > 0) return live.slice(0, 8);
    if (!isLoading) return placeholderItems;
    return [];
  }, [data?.items, isLoading]);

  return (
    <div className="border border-border bg-surface flex flex-col min-h-0 lg:h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5" />
          <h3 className="font-display text-sm font-bold tracking-tight">News releases</h3>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· Summarized</span>
        </div>
        <Link
          to="/news"
          className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          All →
        </Link>
      </div>
      <ul className="divide-y divide-border flex-1 overflow-auto min-h-0">
        {items.map((item, i) => {
          const hero = item as HeroNewsItem;
          const severity = hero.severity || getNewsSeverity(item.sentiment, item.title);
          const filingType = hero.filingType || getNewsFilingType(item.title);
          const summary = cleanNewsSummary(item.summary) || item.title;
          return (
            <NewsReleaseItem
              key={item.link || item.id || i}
              href={newsItemHref(item)}
              ticker={item.ticker!}
              exchange={item.exchange}
              company={item.company}
              timeAgo={newsDisplayTime(item)}
              severity={severity}
              filingType={filingType}
              summary={summary}
            />
          );
        })}
        <li className="p-3 bg-muted/20">
          <Link
            to="/news"
            className="flex items-center justify-center gap-1.5 w-full h-9 bg-foreground text-background font-mono text-[11px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
          >
            View all releases <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </li>
      </ul>
    </div>
  );
};

export default NewsFeed;
