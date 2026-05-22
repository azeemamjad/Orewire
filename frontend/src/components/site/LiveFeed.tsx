import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, RefreshCw } from "lucide-react";
import { fetchFilings, fetchStats, type Verdict, type Exchange, type Commodity } from "@/lib/api";

const exchanges: ("All" | Exchange)[] = ["All", "TSX", "TSX-V", "CSE", "ASX"];
const verdicts: ("All" | Verdict)[] = ["All", "Noteworthy", "Watch", "Routine"];
const commodities: ("All" | Commodity)[] = ["All", "Gold", "Copper", "Silver", "Lithium", "Uranium"];

const verdictPill: Record<Verdict, string> = {
  Noteworthy: "bg-noteworthy text-noteworthy-foreground",
  Watch: "bg-watch text-watch-foreground",
  Routine: "bg-routine text-routine-foreground",
};

const exchangePill: Record<Exchange, string> = {
  TSX: "border-foreground/30 text-foreground",
  "TSX-V": "border-foreground/30 text-foreground",
  CSE: "border-foreground/30 text-foreground",
  ASX: "border-foreground/30 text-foreground",
};

const LiveFeed = () => {
  const [exchange, setExchange] = useState<"All" | Exchange>("All");
  const [verdict, setVerdict] = useState<"All" | Verdict>("All");
  const [commodity, setCommodity] = useState<"All" | Commodity>("All");

  const { data: filings = [], isLoading, error, refetch } = useQuery({
    queryKey: ["filings", exchange, verdict, commodity],
    queryFn: () => fetchFilings({ exchange, verdict, commodity, limit: 9 }),
    refetchInterval: 60000,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 60000,
  });

  const filtered = useMemo(
    () =>
      filings.filter(
        (f) =>
          (exchange === "All" || f.exchange === exchange) &&
          (verdict === "All" || f.verdict === verdict) &&
          (commodity === "All" || f.commodity === commodity),
      ),
    [filings, exchange, verdict, commodity],
  );

  const todayCount = stats ? stats.analyzed : 0;

  return (
    <section id="feed" className="border-b border-border bg-background">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-12 lg:py-16">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-noteworthy animate-pulse-dot" /> Live filing feed
            </div>
            <h2 className="font-display text-3xl lg:text-4xl font-extrabold leading-tight">
              The latest filings, decoded.
            </h2>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-3">
            <span>{todayCount} filings translated today · Updated live</span>
            <button
              onClick={() => refetch()}
              className="hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded">
            Failed to load filings. Backend may be offline.
          </div>
        )}

        <div className="flex flex-wrap gap-3 mb-6 pb-6 border-b border-border">
          <Filter label="Exchange" value={exchange} options={exchanges} onChange={(v) => setExchange(v as never)} />
          <Filter label="Verdict" value={verdict} options={verdicts} onChange={(v) => setVerdict(v as never)} />
          <Filter label="Commodity" value={commodity} options={commodities} onChange={(v) => setCommodity(v as never)} />
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading filings...
          </div>
        ) : (
          <div className="relative">
            <ul className="divide-y divide-border border-y border-border">
              {filtered.length === 0 ? (
                <li className="py-12 text-center text-muted-foreground">
                  No filings match your filters. Try adjusting or run the scraper pipeline.
                </li>
              ) : (
                filtered.map((f, i) => (
                  <li
                    key={f.id}
                    className={`group bg-surface ${i >= 5 ? "pointer-events-none select-none" : ""}`}
                    style={i >= 5 ? { filter: `blur(${Math.min(2 + (i - 5) * 1.2, 6)}px)`, opacity: 0.7 - (i - 5) * 0.08 } : undefined}
                  >
                    <div className="px-4 lg:px-5 py-4 flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5">
                      <div className="flex items-center gap-3 lg:w-56 shrink-0">
                        <span className="font-mono text-base font-bold tracking-tight">{f.ticker}</span>
                        <span className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ${exchangePill[f.exchange as Exchange] || "border-foreground/30 text-foreground"}`}>
                          {f.exchange}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="font-display text-[15px] font-semibold">{f.company}</span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">· {f.filingType}</span>
                        </div>
                        <p className="text-[13.5px] leading-snug text-foreground/75 line-clamp-2">{f.summary}</p>
                      </div>
                      <div className="flex lg:flex-col items-center lg:items-end gap-3 lg:gap-2 lg:w-32 shrink-0">
                        {f.verdict && (
                          <span className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest font-bold rounded-full ${verdictPill[f.verdict]}`}>
                            {f.verdict}
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {f.time}
                        </span>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>

            {filtered.length > 5 && (
              <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-background via-background/90 to-transparent flex items-end justify-center pb-8">
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-6 h-11 text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg"
                >
                  Sign up free to see the full feed <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

const Filter = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) => (
  <label className="flex items-center gap-2 text-xs">
    <span className="font-mono uppercase tracking-widest text-muted-foreground text-[10px]">{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-surface border border-border px-2.5 h-9 text-xs font-medium outline-none focus:border-accent cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  </label>
);

export default LiveFeed;