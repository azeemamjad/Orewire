import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Flame, RefreshCw } from "lucide-react";
import { fetchMovers, type MoverItem } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000; // 30 minutes

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  if (n < 1) return n.toFixed(4);
  if (n < 10) return n.toFixed(2);
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtVolume(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function normExLabel(ex: string): string {
  if (ex === "TSXV") return "TSX-V";
  return ex;
}

const MoverTable = ({ title, rows, up }: { title: string; rows: MoverItem[]; up: boolean }) => (
  <div className="border border-border bg-surface">
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <Flame className={`w-3.5 h-3.5 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`} />
        <h3 className="font-display text-sm font-bold tracking-tight">{title}</h3>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Today · Mining</span>
    </div>
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <th className="text-left px-4 py-2 font-medium">Ticker</th>
          <th className="text-left py-2 font-medium hidden md:table-cell">Name</th>
          <th className="text-right py-2 font-medium">Last</th>
          <th className="text-right py-2 font-medium">Chg</th>
          <th className="text-right px-4 py-2 font-medium hidden sm:table-cell">Vol</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">
              No data yet — try again in a moment.
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={`${r.exchange}-${r.ticker}`} className="hover:bg-background/60 transition-colors">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{r.ticker}</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
                    {normExLabel(r.exchange)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate max-w-[180px] md:hidden">{r.name}</div>
              </td>
              <td className="py-2.5 text-foreground/75 hidden md:table-cell text-[12px]">
                <div className="truncate max-w-[260px]">{r.name}</div>
              </td>
              <td className="py-2.5 text-right font-mono font-semibold">${fmtPrice(r.price)}</td>
              <td className={`py-2.5 text-right font-mono font-bold ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                <span className="inline-flex items-center gap-0.5">
                  {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{fmtPct(r.change_pct)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground hidden sm:table-cell">
                {fmtVolume(r.volume)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const Movers = () => {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["movers", "ALL"],
    queryFn: () => fetchMovers({ exchange: "ALL", limit: 5 }),
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const gainers = data?.gainers ?? [];
  const losers = data?.losers ?? [];
  const updatedLabel = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section className="border-b border-border bg-background">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-10">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-[hsl(var(--up))] animate-pulse-dot" /> Market movers
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-extrabold leading-tight">
              Top gainers &amp; losers — junior mining
            </h2>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-3">
            <span>TSX-V · CSE · ASX · Delayed 15m</span>
            {updatedLabel && <span>Updated {updatedLabel}</span>}
            <button
              onClick={() => refetch()}
              className="hover:text-foreground transition-colors"
              title="Refresh"
              aria-label="Refresh movers"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading movers from TradingView...
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            <MoverTable title="Top Gainers" rows={gainers} up />
            <MoverTable title="Top Losers" rows={losers} up={false} />
          </div>
        )}
      </div>
    </section>
  );
};

export default Movers;
