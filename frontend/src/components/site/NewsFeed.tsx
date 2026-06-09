import { useQuery } from "@tanstack/react-query";
import { Clock, Newspaper } from "lucide-react";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { Link } from "react-router-dom";

const severityStyle: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-noteworthy text-noteworthy-foreground",
  medium: "bg-watch text-watch-foreground",
  low: "bg-routine text-routine-foreground",
};

function getSeverity(sentiment: string | undefined, title: string): { label: string; style: string } {
  const t = (title || "").toLowerCase();
  if (t.includes("drill") && (t.includes("high-grade") || t.includes("2.4×") || /\d+.*g\/t/.test(t))) return { label: "Critical", style: severityStyle.critical };
  if (t.includes("resource") || t.includes("feasibility") || t.includes("assay")) return { label: "High", style: severityStyle.high };
  if (t.includes("placement") || t.includes("financing") || t.includes("acquisition")) return { label: "Medium", style: severityStyle.medium };
  if (sentiment === "bullish") return { label: "High", style: severityStyle.high };
  if (sentiment === "bearish") return { label: "Medium", style: severityStyle.medium };
  return { label: "Low", style: severityStyle.low };
}

function getFilingType(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("drill")) return "Drill Result";
  if (t.includes("resource")) return "Resource Update";
  if (t.includes("feasibility") || t.includes("technical report")) return "Technical Report";
  if (t.includes("placement") || t.includes("financing") || t.includes("bought deal")) return "Private Placement";
  if (t.includes("quarterly") || t.includes("q1") || t.includes("q2") || t.includes("q3") || t.includes("q4")) return "Quarterly";
  if (t.includes("assay")) return "Assay";
  if (t.includes("acquisition") || t.includes("merger")) return "M&A";
  return "News Release";
}

// Decode/strip raw HTML that some RSS summaries carry so long URLs don't overflow.
function cleanSummary(text: string | null | undefined): string {
  if (!text) return "";
  const decoded = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  return decoded.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const placeholderItems: NewsItem[] = [
  { title: "Hole EL-247 returned 12.4m @ 3.2 g/t Au — 2.4× deposit average. Mineralization remains open at depth.", source: "TMX Newsfile", timeAgo: "12 min ago", commodity: "Gold", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Hemi Indicated resource increased 18% to 6.8 Moz Au. Conversion drilling continues ahead of feasibility.", source: "GlobeNewsWire", timeAgo: "1 hr ago", commodity: "Gold", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Step-out hole 4 km north of Keats returned 2.1m @ 24 g/t Au, opening a new exploration corridor.", source: "TMX Newsfile", timeAgo: "2 hrs ago", commodity: "Gold", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "First Indicated category at PCE: 19.2 Mlb U₃O₈ at 3.1% U₃O₈, advancing toward feasibility.", source: "GlobeNewsWire", timeAgo: "3 hrs ago", commodity: "Uranium", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "$4.2M flow-through placement at $0.18 — 0.8× market cap. Insider participation 22%.", source: "TMX Newsfile", timeAgo: "4 hrs ago", commodity: null, sentiment: "neutral", link: "#", pubDate: "", summary: "" },
  { title: "Finniss production 24kt SC6, in line with guidance. Cash $87M. FY26 outlook unchanged.", source: "GlobeNewsWire", timeAgo: "5 hrs ago", commodity: "Lithium", sentiment: "neutral", link: "#", pubDate: "", summary: "" },
  { title: "Mt Magnet extension drilling returned 4.1m @ 8.7 g/t Au below existing pit. Confirms continuity.", source: "TMX Newsfile", timeAgo: "6 hrs ago", commodity: "Gold", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "156m @ 1.4% CuEq from 412m at Filo del Sol — grade and width well above PEA averages.", source: "GlobeNewsWire", timeAgo: "7 hrs ago", commodity: "Copper", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
];

const NewsFeed = () => {
  const { data } = useQuery({
    queryKey: ["news-feed", 20],
    queryFn: () => fetchNewsFeed({ limit: 20 }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  const items = data?.items && data.items.length > 0 ? data.items : placeholderItems;
  const toNewsSlug = (item: NewsItem) => encodeURIComponent(item.link || item.title);

  return (
    <div className="border border-border bg-surface flex flex-col min-h-0 lg:h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5" />
          <h3 className="font-display text-sm font-bold tracking-tight">News releases</h3>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· AI summarized</span>
        </div>
        <Link to="/news" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
          All →
        </Link>
      </div>
      <ul className="divide-y divide-border flex-1 overflow-auto min-h-0">
        {items.slice(0, 20).map((item, i) => {
          const sev = getSeverity(item.sentiment, item.title);
          const filingType = getFilingType(item.title);
          return (
            <li key={i} className="hover:bg-background/60">
              <Link to={`/news/${toNewsSlug(item)}`} className="block px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold ${sev.style}`}>
                    {sev.label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-border px-1 py-0.5">
                    {filingType}
                  </span>
                  {item.ticker && (
                    <span className="font-mono text-[10px] font-bold">{item.ticker}</span>
                  )}
                  <span className="ml-auto font-mono text-[9px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {item.timeAgo}
                  </span>
                </div>
                <p className="text-[13px] leading-snug font-medium line-clamp-2 break-words">
                  {cleanSummary(item.summary) || item.title}
                </p>
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            to="/news"
            className="block px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors text-center"
          >
            See more news →
          </Link>
        </li>
      </ul>
    </div>
  );
};

export default NewsFeed;
