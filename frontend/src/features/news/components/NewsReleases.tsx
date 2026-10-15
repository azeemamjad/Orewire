import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import FeedRow, { type VerdictTone } from "@/components/site/FeedRow";
import FeedGate from "@/components/site/FeedGate";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { newsDisplayTime } from "@/components/site/news-release-utils";
import { newsSlug } from "@/lib/seo";

const REFETCH_MS = 30 * 60 * 1000;

const FILTERS = ["All", "Noteworthy", "Watch", "Routine"] as const;
type FilterValue = (typeof FILTERS)[number];

// Mirror the classification used by the hero NewsFeed and NewsDetail so a release
// gets the same verdict everywhere on the site.
function getVerdict(item: NewsItem): VerdictTone {
  const t = (item.title || "").toLowerCase();
  if (t.includes("drill") && (t.includes("high-grade") || /\d+.*g\/t/.test(t))) return "Noteworthy";
  if (t.includes("resource") || t.includes("feasibility") || t.includes("assay")) return "Noteworthy";
  if (item.sentiment === "bullish") return "Noteworthy";
  if (t.includes("placement") || t.includes("financing") || t.includes("acquisition")) return "Watch";
  if (item.sentiment === "bearish") return "Watch";
  return "Routine";
}

function getFilingType(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("drill")) return "Drill Results";
  if (t.includes("resource")) return "Resource Estimate";
  if (t.includes("feasibility") || t.includes("technical report")) return "Technical Report";
  if (t.includes("placement") || t.includes("financing") || t.includes("bought deal")) return "Private Placement";
  if (t.includes("quarterly") || /\bq[1-4]\b/.test(t)) return "Quarterly Update";
  if (t.includes("assay")) return "Assay Results";
  if (t.includes("acquisition") || t.includes("merger")) return "M&A";
  return "News Release";
}

// Some RSS summaries arrive as raw/escaped HTML (embedded <a href>); decode the
// common entities, strip tags, and collapse whitespace so long URLs don't overflow.
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

const placeholderReleases: NewsItem[] = [
  { title: "Hole HC-247 returns 12.4m @ 3.2 g/t Au - 2.4× deposit average; ends in mineralization.", summary: "Hole HC-247 returns 12.4m @ 3.2 g/t Au - 2.4× deposit average; ends in mineralization.", source: "TMX Newsfile", link: "#scz", pubDate: "", timeAgo: "12 min ago", commodity: "Gold", sentiment: "bullish", ticker: "SCZ", exchange: "TSX-V", company: "Scorpio Gold Resources" },
  { title: "Hemi Indicated resource lifted 18% to 6.8 Moz Au ahead of Q3 feasibility.", summary: "Hemi Indicated resource lifted 18% to 6.8 Moz Au ahead of Q3 feasibility.", source: "GlobeNewsWire", link: "#deg", pubDate: "", timeAgo: "47 min ago", commodity: "Gold", sentiment: "bullish", ticker: "DEG", exchange: "ASX", company: "De Grey Mining" },
  { title: "Step-out 4 km north of Keats returns 2.1m @ 24 g/t Au; opens new corridor.", summary: "Step-out 4 km north of Keats returns 2.1m @ 24 g/t Au; opens new corridor.", source: "TMX Newsfile", link: "#nfg", pubDate: "", timeAgo: "1 hr ago", commodity: "Gold", sentiment: "bullish", ticker: "NFG", exchange: "TSX-V", company: "New Found Gold" },
  { title: "C$4.2M flow-through placement at $0.18; 22% insider participation. Funds Q3 drilling.", summary: "C$4.2M flow-through placement at $0.18; 22% insider participation. Funds Q3 drilling.", source: "TMX Newsfile", link: "#gr", pubDate: "", timeAgo: "2 hrs ago", commodity: null, sentiment: "neutral", ticker: "GR", exchange: "CSE", company: "Great Atlantic Resources" },
  { title: "Mt Magnet extension hole returns 4.1m @ 8.7 g/t Au below pit - continuity confirmed.", summary: "Mt Magnet extension hole returns 4.1m @ 8.7 g/t Au below pit - continuity confirmed.", source: "GlobeNewsWire", link: "#rms", pubDate: "", timeAgo: "3 hrs ago", commodity: "Gold", sentiment: "bullish", ticker: "RMS", exchange: "ASX", company: "Ramelius Resources" },
  { title: "Finniss Q3 produces 24kt SC6, in line with guidance. Cash A$87M; FY26 unchanged.", summary: "Finniss Q3 produces 24kt SC6, in line with guidance. Cash A$87M; FY26 unchanged.", source: "GlobeNewsWire", link: "#cxo", pubDate: "", timeAgo: "4 hrs ago", commodity: "Lithium", sentiment: "neutral", ticker: "CXO", exchange: "ASX", company: "Core Lithium" },
  { title: "First Indicated at Patterson Corridor East: 19.2 Mlb U₃O₈ @ 3.1%.", summary: "First Indicated at Patterson Corridor East: 19.2 Mlb U₃O₈ @ 3.1%.", source: "TMX Newsfile", link: "#nxe", pubDate: "", timeAgo: "5 hrs ago", commodity: "Uranium", sentiment: "bullish", ticker: "NXE", exchange: "TSX-V", company: "NexGen Energy" },
  { title: "Filo del Sol delivers 156m @ 1.4% CuEq from 412m - well above PEA.", summary: "Filo del Sol delivers 156m @ 1.4% CuEq from 412m - well above PEA.", source: "GlobeNewsWire", link: "#fil", pubDate: "", timeAgo: "6 hrs ago", commodity: "Copper", sentiment: "bullish", ticker: "FIL", exchange: "TSX-V", company: "Filo Mining" },
  { title: "Annual shareholder meeting reschedules to Aug 14; agenda items unchanged.", summary: "Annual shareholder meeting reschedules to Aug 14; agenda items unchanged.", source: "GlobeNewsWire", link: "#ago", pubDate: "", timeAgo: "7 hrs ago", commodity: null, sentiment: "neutral", ticker: "AGO", exchange: "ASX", company: "Atlas Iron" },
  { title: "Reggane permit reinstated by Mali tribunal; production restart targeted Q4.", summary: "Reggane permit reinstated by Mali tribunal; production restart targeted Q4.", source: "TMX Newsfile", link: "#abx", pubDate: "", timeAgo: "8 hrs ago", commodity: "Gold", sentiment: "neutral", ticker: "ABX", exchange: "TSX", company: "Barrick Mining" },
];

const ReleaseCard = ({ item }: { item: NewsItem }) => (
  <FeedRow
    href={`/news/${newsSlug(item)}`}
    ticker={item.ticker}
    exchange={item.exchange}
    verdict={getVerdict(item)}
    typeLabel={getFilingType(item.title)}
    time={newsDisplayTime(item)}
    company={item.company}
    category={item.commodity}
    summary={cleanSummary(item.summary) || item.title}
  />
);

const NewsReleases = () => {
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<FilterValue>("All");

  const { data } = useQuery({
    queryKey: ["news-releases-section", "company-linked"],
    queryFn: () => fetchNewsFeed({ page: 1, limit: 50, origin: "rss", companyLinked: true }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items =
    data?.items && data.items.length > 0
      ? data.items.filter((item) => item.companyId != null || item.ticker)
      : placeholderReleases;

  const filtered = useMemo(
    () => (filter === "All" ? items : items.filter((item) => getVerdict(item) === filter)),
    [items, filter],
  );

  const visible = filtered.slice(0, 5);
  // Logged-out visitors see a blurred teaser of the next releases behind the
  // shared sign-up gate (5 visible, 5 teased - unchanged).
  const locked = isAuthenticated ? [] : filtered.slice(5, 10);

  return (
    <section className="border-b border-border bg-background">
      <div className="container-page section-y">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
          <div className="lg:col-span-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-noteworthy animate-pulse-dot" /> Live news releases
            </div>
            <h2 className="font-display text-3xl lg:text-5xl font-extrabold leading-[1.05] tracking-tight">
              Every release.
              <br />
              <span className="text-muted-foreground">One line. One verdict.</span>
            </h2>
          </div>
          <div className="lg:col-span-7 space-y-4 text-[15px] leading-relaxed text-foreground/80">
            <p>
              Hundreds of releases hit the wire every trading day. Drill results, financings, resource updates,
              corporate changes, each one buried in jargon, footnotes and 8-page PDFs.
            </p>
            <p>
              Every release is summarized into one plain-English line with a significance verdict the moment it is
              published. Noteworthy if it moves the thesis, Watch if it is worth tracking, Routine if you can skip it.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-display text-lg font-semibold">Latest releases</h3>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-full border transition-colors ${
                  filter === f
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          {visible.length === 0 ? (
            <div className="border border-dashed border-border p-12 text-center text-muted-foreground text-sm">
              No releases match this filter.
              <button
                type="button"
                onClick={() => setFilter("All")}
                className="mt-3 block mx-auto text-sm text-foreground underline"
              >
                Reset
              </button>
            </div>
          ) : (
            <ul className="card-surface divide-y divide-border">
              {visible.map((item) => (
                <ReleaseCard key={newsSlug(item)} item={item} />
              ))}
            </ul>
          )}

          {locked.length > 0 && (
            <FeedGate>
              <ul className="card-surface divide-y divide-border">
                {locked.map((item) => (
                  <ReleaseCard key={newsSlug(item)} item={item} />
                ))}
              </ul>
            </FeedGate>
          )}

          {isAuthenticated && (
            <div className="flex justify-center mt-6">
              <Link
                to="/news"
                className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-11 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                View all news <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default NewsReleases;
