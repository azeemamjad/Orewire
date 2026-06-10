import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";
import { fetchNewsFeed, type NewsItem, type Verdict } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const REFETCH_MS = 30 * 60 * 1000;

const FILTERS = ["All", "Noteworthy", "Watch", "Routine"] as const;
type FilterValue = (typeof FILTERS)[number];

const verdictStyle: Record<Verdict, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

// Mirror the classification used by the hero NewsFeed and NewsDetail so a release
// gets the same verdict everywhere on the site.
function getVerdict(item: NewsItem): Verdict {
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

function newsSlug(item: NewsItem): string {
  return encodeURIComponent(item.link || item.title);
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
  { title: "Hole HC-247 returns 12.4m @ 3.2 g/t Au — 2.4× deposit average; ends in mineralization.", summary: "Hole HC-247 returns 12.4m @ 3.2 g/t Au — 2.4× deposit average; ends in mineralization.", source: "TMX Newsfile", link: "#scz", pubDate: "", timeAgo: "12 min ago", commodity: "Gold", sentiment: "bullish", ticker: "SCZ" },
  { title: "Hemi Indicated resource lifted 18% to 6.8 Moz Au ahead of Q3 feasibility.", summary: "Hemi Indicated resource lifted 18% to 6.8 Moz Au ahead of Q3 feasibility.", source: "GlobeNewsWire", link: "#deg", pubDate: "", timeAgo: "47 min ago", commodity: "Gold", sentiment: "bullish", ticker: "DEG" },
  { title: "Step-out 4 km north of Keats returns 2.1m @ 24 g/t Au; opens new corridor.", summary: "Step-out 4 km north of Keats returns 2.1m @ 24 g/t Au; opens new corridor.", source: "TMX Newsfile", link: "#nfg", pubDate: "", timeAgo: "1 hr ago", commodity: "Gold", sentiment: "bullish", ticker: "NFG" },
  { title: "C$4.2M flow-through placement at $0.18; 22% insider participation. Funds Q3 drilling.", summary: "C$4.2M flow-through placement at $0.18; 22% insider participation. Funds Q3 drilling.", source: "TMX Newsfile", link: "#gr", pubDate: "", timeAgo: "2 hrs ago", commodity: null, sentiment: "neutral", ticker: "GR" },
  { title: "Mt Magnet extension hole returns 4.1m @ 8.7 g/t Au below pit — continuity confirmed.", summary: "Mt Magnet extension hole returns 4.1m @ 8.7 g/t Au below pit — continuity confirmed.", source: "GlobeNewsWire", link: "#rms", pubDate: "", timeAgo: "3 hrs ago", commodity: "Gold", sentiment: "bullish", ticker: "RMS" },
  { title: "Finniss Q3 produces 24kt SC6, in line with guidance. Cash A$87M; FY26 unchanged.", summary: "Finniss Q3 produces 24kt SC6, in line with guidance. Cash A$87M; FY26 unchanged.", source: "GlobeNewsWire", link: "#cxo", pubDate: "", timeAgo: "4 hrs ago", commodity: "Lithium", sentiment: "neutral", ticker: "CXO" },
  { title: "First Indicated at Patterson Corridor East: 19.2 Mlb U₃O₈ @ 3.1%.", summary: "First Indicated at Patterson Corridor East: 19.2 Mlb U₃O₈ @ 3.1%.", source: "TMX Newsfile", link: "#nxe", pubDate: "", timeAgo: "5 hrs ago", commodity: "Uranium", sentiment: "bullish", ticker: "NXE" },
  { title: "Filo del Sol delivers 156m @ 1.4% CuEq from 412m — well above PEA.", summary: "Filo del Sol delivers 156m @ 1.4% CuEq from 412m — well above PEA.", source: "GlobeNewsWire", link: "#fil", pubDate: "", timeAgo: "6 hrs ago", commodity: "Copper", sentiment: "bullish", ticker: "FIL" },
  { title: "Annual shareholder meeting reschedules to Aug 14; agenda items unchanged.", summary: "Annual shareholder meeting reschedules to Aug 14; agenda items unchanged.", source: "GlobeNewsWire", link: "#ago", pubDate: "", timeAgo: "7 hrs ago", commodity: null, sentiment: "neutral", ticker: "AGO" },
  { title: "Reggane permit reinstated by Mali tribunal; production restart targeted Q4.", summary: "Reggane permit reinstated by Mali tribunal; production restart targeted Q4.", source: "TMX Newsfile", link: "#abx", pubDate: "", timeAgo: "8 hrs ago", commodity: "Gold", sentiment: "neutral", ticker: "ABX" },
];

const ReleaseCard = ({ item }: { item: NewsItem }) => {
  const verdict = getVerdict(item);
  const filingType = getFilingType(item.title);
  return (
    <Link
      to={`/news/${newsSlug(item)}`}
      className="block border border-border bg-card hover:bg-muted/40 transition-colors px-4 py-3.5"
    >
      <div className="flex items-center gap-2.5 mb-2 flex-wrap">
        {item.ticker && (
          <span className="font-mono text-[18px] font-extrabold tracking-tight leading-none">{item.ticker}</span>
        )}
        <span className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictStyle[verdict]}`}>
          {verdict}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
          {filingType}
        </span>
        {item.commodity && (
          <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
            {item.commodity}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {item.timeAgo}
        </span>
      </div>
      <p className="text-[13px] leading-snug text-foreground/85 pl-0.5 break-words line-clamp-2">
        <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
        {cleanSummary(item.summary) || item.title}
      </p>
    </Link>
  );
};

const NewsReleases = () => {
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<FilterValue>("All");

  const { data } = useQuery({
    queryKey: ["news-releases-section"],
    queryFn: () => fetchNewsFeed({ page: 1, limit: 50, origin: "rss" }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data?.items && data.items.length > 0 ? data.items : placeholderReleases;

  const filtered = useMemo(
    () => (filter === "All" ? items : items.filter((item) => getVerdict(item) === filter)),
    [items, filter],
  );

  const visible = filtered.slice(0, 5);
  // Logged-out visitors see a blurred teaser of the next releases behind a sign-up gate.
  const locked = isAuthenticated ? [] : filtered.slice(5, 10);

  return (
    <section className="border-b border-border bg-background">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
          <div className="lg:col-span-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
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
              Hundreds of news releases hit the wire every trading day from TSX-V, CSE, TSX and ASX miners. Drill
              results, financings, resource updates, corporate changes — each one buried in jargon, footnotes and 8-page
              PDFs.
            </p>
            <p>
              We read every single release the moment it's published and distill it into{" "}
              <strong className="text-foreground">one plain-English line</strong> with a verdict —{" "}
              <span className="font-semibold text-foreground">Noteworthy</span> if it moves the thesis,{" "}
              <span className="font-semibold text-foreground">Watch</span> if it's worth tracking,{" "}
              <span className="font-semibold text-foreground">Routine</span> if you can skip it. Click any release for the
              full announcement, context and related coverage on the company page.
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
          <div className="space-y-2">
            {visible.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">No releases match this filter.</div>
            ) : (
              visible.map((item) => <ReleaseCard key={newsSlug(item)} item={item} />)
            )}
          </div>

          {locked.length > 0 && (
            <div className="relative mt-2">
              <div className="space-y-2 pointer-events-none select-none blur-sm opacity-70">
                {locked.map((item) => (
                  <ReleaseCard key={newsSlug(item)} item={item} />
                ))}
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-background/30 via-background/70 to-background">
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-11 text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  Sign up free to see more <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
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
