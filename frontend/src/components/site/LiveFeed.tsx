import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, Clock, Sparkles } from "lucide-react";
import { fetchFilings, fetchStats, type Exchange, type Filing, type Verdict } from "@/lib/api";

const exchanges: ("All" | Exchange)[] = ["All", "TSX-V", "CSE", "ASX", "TSX"];
const importances = ["All", "Critical", "High", "Medium", "Low"] as const;
const types = [
  "All",
  "Drill Result",
  "Resource Update",
  "Private Placement",
  "Technical Report",
  "Quarterly",
  "MD&A",
  "Material Change",
  "Assay",
  "Corporate Update",
] as const;

const severityStyle: Record<"Critical" | "High" | "Medium" | "Low", string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-noteworthy text-noteworthy-foreground",
  Medium: "bg-watch text-watch-foreground",
  Low: "bg-routine text-routine-foreground",
};

function verdictToImportance(v: Verdict | null): "Critical" | "High" | "Medium" | "Low" {
  if (v === "Noteworthy") return "High";
  if (v === "Watch") return "Medium";
  if (v === "Routine") return "Low";
  return "Low";
}

const LiveFeed = () => {
  const [exchange, setExchange] = useState<"All" | Exchange>("All");
  const [importance, setImportance] = useState<(typeof importances)[number]>("All");
  const [type, setType] = useState<(typeof types)[number]>("All");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data: filings = [], isLoading } = useQuery({
    queryKey: ["filings-live-feed", exchange],
    queryFn: () => fetchFilings({ exchange, limit: 50 }),
    refetchInterval: 60_000,
  });
  const { data: stats } = useQuery({
    queryKey: ["filings-stats-live-feed"],
    queryFn: fetchStats,
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    return filings.filter((f) => {
      const itemImportance = verdictToImportance(f.verdict || null);
      const itemType = (types.includes(f.filingType as (typeof types)[number]) ? f.filingType : "Corporate Update") as (typeof types)[number];
      return (
        (importance === "All" || itemImportance === importance) &&
        (type === "All" || itemType === type)
      );
    });
  }, [filings, importance, type]);

  return (
    <section id="feed" className="border-b border-border bg-background">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-12 lg:py-16">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-noteworthy animate-pulse-dot" /> Live filing releases
            </div>
            <h2 className="font-display text-3xl lg:text-4xl font-extrabold leading-tight">
              Filing releases, AI-summarized.
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              Every filing in one or two lines. Click any filing to expand and view more details.
            </p>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {stats?.analyzed || 0} releases translated today · Updated live
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6 pb-6 border-b border-border">
          <Filter label="Exchange" value={exchange} options={exchanges} onChange={(v) => setExchange(v as "All" | Exchange)} />
          <Filter label="Importance" value={importance} options={importances} onChange={(v) => setImportance(v as (typeof importances)[number])} />
          <Filter label="Type" value={type} options={types} onChange={(v) => setType(v as (typeof types)[number])} />
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading filing releases...</div>
        ) : (
          <>
            <ul className="divide-y divide-border border-y border-border">
              {filtered.length === 0 ? (
                <li className="py-12 text-center text-muted-foreground">No releases match your filters.</li>
              ) : (
                filtered.slice(0, 9).map((item: Filing, i) => {
                  const itemImportance = verdictToImportance(item.verdict || null);
                  const itemType = (types.includes(item.filingType as (typeof types)[number]) ? item.filingType : "Corporate Update") as (typeof types)[number];
                  const ticker = item.ticker || "—";
                  const isExpanded = expandedId === item.id;
                  return (
                    <li key={`${item.id}-${i}`} className="bg-surface hover:bg-background/60 transition-colors">
                      <button
                        type="button"
                        onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                        className="w-full text-left block px-4 lg:px-5 py-4"
                      >
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest font-bold ${severityStyle[itemImportance]}`}>
                            {itemImportance}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border">{itemType}</span>
                          <span className="font-mono text-[11px] font-bold">{ticker}</span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">{item.exchange}</span>
                          <span className="text-[12px] text-muted-foreground truncate">· {item.company}</span>
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                            <Clock className="w-2.5 h-2.5" />
                            {item.time}
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                        <p className="text-[14px] leading-snug font-medium text-foreground/90 mb-2">
                          <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
                          {item.summary}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mb-1">
                          {item.commodity && (
                            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-muted/40 border border-border text-muted-foreground">
                              {item.commodity}
                            </span>
                          )}
                          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-muted/40 border border-border text-muted-foreground">
                            Filing
                          </span>
                        </div>
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-border text-sm text-foreground/80 space-y-1">
                            <div><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Company</span>{item.company}</div>
                            <div><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Ticker</span>{ticker}</div>
                            <div><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Exchange</span>{item.exchange}</div>
                            <div><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Type</span>{itemType}</div>
                            <div><span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Importance</span>{itemImportance}</div>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            <div className="flex justify-center pt-8">
              <Link to="/register" className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-6 h-11 text-sm font-semibold hover:opacity-90 transition-opacity">
                Get email alerts on new releases <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          </>
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