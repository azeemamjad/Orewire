import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";
import { fetchFilings, type Filing, type Verdict } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const REFETCH_MS = 60_000;

const FILTERS = ["All", "Noteworthy", "Watch", "Routine"] as const;
type FilterValue = (typeof FILTERS)[number];

// Filing types we surface, shown as the "Filings we decode" chip cloud.
const FILING_TYPES = [
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

const verdictStyle: Record<Verdict, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

const placeholderFilings: Filing[] = [
  { id: -1, ticker: "SCZ", company: "Scorpio Gold Resources", exchange: "TSX-V", filingType: "NI 43-101", verdict: "Noteworthy", commodity: "Gold", time: "22 min ago", summary: "Updated MRE: 1.42 Moz Indicated @ 1.8 g/t Au - 31% category upgrade vs prior." },
  { id: -2, ticker: "DEG", company: "De Grey Mining", exchange: "ASX", filingType: "JORC Resource", verdict: "Noteworthy", commodity: "Gold", time: "1 hr ago", summary: "Hemi JORC 2012 update: 11.7 Moz total; Indicated now 6.8 Moz." },
  { id: -3, ticker: "NFG", company: "New Found Gold", exchange: "TSX-V", filingType: "Material Change", verdict: "Noteworthy", commodity: "Gold", time: "2 hrs ago", summary: "AFZ-988 high-grade step-out triggers 25,000m follow-up program." },
  { id: -4, ticker: "GR", company: "Great Atlantic Resources", exchange: "CSE", filingType: "Private Placement", verdict: "Watch", commodity: null, time: "3 hrs ago", summary: "Subscription agreement: C$4.2M flow-through @ $0.18, half-warrant @ $0.28." },
  { id: -5, ticker: "CXO", company: "Core Lithium", exchange: "ASX", filingType: "Appendix 5B", verdict: "Routine", commodity: "Lithium", time: "4 hrs ago", summary: "Cash flow report: A$87M cash; quarterly opex A$22M; 4 quarters runway." },
  { id: -6, ticker: "RMS", company: "Ramelius Resources", exchange: "ASX", filingType: "Quarterly MD&A", verdict: "Routine", commodity: "Gold", time: "5 hrs ago", summary: "AISC A$1,820/oz; FY guidance reaffirmed at 280-310 koz." },
  { id: -7, ticker: "NXE", company: "NexGen Energy", exchange: "TSX-V", filingType: "Annual Information Form", verdict: "Routine", commodity: "Uranium", time: "6 hrs ago", summary: "FY25 AIF filed; no material changes to risk factors or property disclosures." },
  { id: -8, ticker: "FIL", company: "Filo Mining", exchange: "TSX-V", filingType: "Early Warning Report", verdict: "Watch", commodity: "Copper", time: "7 hrs ago", summary: "BHP increases stake to 11.2% via market purchases - first crossing of 10%." },
  { id: -9, ticker: "ABX", company: "Barrick Mining", exchange: "TSX", filingType: "Proxy Circular", verdict: "Routine", commodity: "Gold", time: "9 hrs ago", summary: "2026 AGM circular; board slate unchanged, say-on-pay advisory included." },
  { id: -10, ticker: "AGO", company: "Atlas Iron", exchange: "ASX", filingType: "Substantial Holder Notice", verdict: "Watch", commodity: null, time: "11 hrs ago", summary: "Hancock Prospecting lifts holding to 19.9% - just under takeover threshold." },
];

const FilingCard = ({ item }: { item: Filing }) => (
  <Link
    to={`/filings/${item.id}`}
    className="block border border-border bg-card hover:bg-muted/40 transition-colors px-4 py-3.5"
  >
    <div className="flex items-center gap-2.5 mb-2 flex-wrap">
      <span className="font-mono text-[18px] font-extrabold tracking-tight leading-none">{item.ticker}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
        {item.exchange}
      </span>
      <span className="text-[15px] font-semibold leading-none truncate max-w-[45%]">{item.company}</span>
      {item.verdict && (
        <span className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictStyle[item.verdict]}`}>
          {item.verdict}
        </span>
      )}
      <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
        {item.filingType}
      </span>
      <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
        <Clock className="w-2.5 h-2.5" />
        {item.time}
      </span>
    </div>
    <p className="text-[13px] leading-snug text-foreground/85 pl-0.5">
      <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
      {item.summary}
    </p>
  </Link>
);

const LiveFeed = () => {
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<FilterValue>("All");

  const { data } = useQuery({
    queryKey: ["filings-section"],
    queryFn: () => fetchFilings({ limit: 50 }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data && data.length > 0 ? data : placeholderFilings;

  const filtered = useMemo(
    () => (filter === "All" ? items : items.filter((f) => f.verdict === filter)),
    [items, filter],
  );

  const visible = filtered.slice(0, 5);
  // Logged-out visitors see a blurred teaser of the next filings behind a sign-up gate.
  const locked = isAuthenticated ? [] : filtered.slice(5, 10);

  return (
    <section id="feed" className="border-b border-border bg-surface/40">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
          <div className="lg:col-span-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-accent" /> Filing intelligence
            </div>
            <h2 className="font-display text-3xl lg:text-5xl font-extrabold leading-[1.05] tracking-tight">
              We read every filing.
              <br />
              <span className="text-muted-foreground">So you don't have to.</span>
            </h2>
          </div>
          <div className="lg:col-span-7 space-y-4 text-[15px] leading-relaxed text-foreground/80">
            <p>
              Most retail investors never look at filings. That&apos;s where the real story lives. A 200-page NI 43-101
              buries the grade. A subscription agreement hides the warrant terms. An Early Warning Report signals a stake
              build days before the headlines.
            </p>
            <p>
              Every filing from SEDAR+, ASX Announcements, and the CSE is decoded the moment it is lodged, surfacing the
              numbers and decisions that matter.
            </p>
          </div>
        </div>

        <div className="mb-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Filings we decode
          </div>
          <div className="flex flex-wrap gap-2">
            {FILING_TYPES.map((t) => (
              <span
                key={t}
                className="font-display text-sm font-semibold px-3.5 py-2 bg-card border border-border text-foreground hover:border-accent transition-colors"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-display text-lg font-semibold">10 most recent filings</h3>
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
              <div className="py-12 text-center text-muted-foreground text-sm">No filings match this filter.</div>
            ) : (
              visible.map((item) => <FilingCard key={item.id} item={item} />)
            )}
          </div>

          {locked.length > 0 && (
            <div className="relative mt-2">
              <div className="space-y-2 pointer-events-none select-none blur-sm opacity-70">
                {locked.map((item) => (
                  <FilingCard key={item.id} item={item} />
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
                to="/filings"
                className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-11 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                View all filings <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default LiveFeed;
