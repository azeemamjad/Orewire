import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchMovers, companySlug, type MoverItem } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000;

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtMktCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function normExLabel(ex: string): string {
  if (ex === "TSXV") return "TSX-V";
  return ex;
}

const MoverTable = ({ title, rows, up }: { title: string; rows: MoverItem[]; up: boolean }) => (
  <div className="border border-border bg-surface">
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2">
        {up ? (
          <TrendingUp className="w-3.5 h-3.5 text-[hsl(var(--up))]" />
        ) : (
          <TrendingDown className="w-3.5 h-3.5 text-[hsl(var(--down))]" />
        )}
        <h3 className="font-display text-sm font-bold tracking-tight">{title}</h3>
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· Today · Mining</span>
      </div>
      <Link to="/companies" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
        All →
      </Link>
    </div>
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <th className="text-left px-3 py-1.5 font-medium">Ticker</th>
          <th className="text-right py-1.5 font-medium">Last</th>
          <th className="text-right py-1.5 font-medium">Chg</th>
          <th className="text-right px-3 py-1.5 font-medium hidden sm:table-cell">Mkt Cap</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground text-xs">
              No data yet — try again in a moment.
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={`${r.exchange}-${r.ticker}`} className="hover:bg-background/60 transition-colors">
              <td className="px-3 py-2">
                <Link to={`/company/${companySlug(r.exchange, r.ticker)}`} className="flex items-center gap-2 group">
                  <span className="font-mono font-bold group-hover:underline">{r.ticker}</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
                    {normExLabel(r.exchange)}
                  </span>
                </Link>
                <div className="text-[10.5px] text-muted-foreground truncate max-w-[180px]">{r.name}</div>
              </td>
              <td className="py-2 text-right font-mono font-semibold">${fmtPrice(r.price)}</td>
              <td className={`py-2 text-right font-mono font-bold ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                <span className="inline-flex items-center gap-0.5">
                  {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{fmtPct(r.change_pct)}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground hidden sm:table-cell">
                {fmtMktCap(r.volume)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const Movers = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["movers", "ALL"],
    queryFn: () => fetchMovers({ exchange: "ALL", limit: 8 }),
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const gainers = data?.gainers?.slice(0, 8) ?? [];
  const losers = data?.losers?.slice(0, 8) ?? [];

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center border border-border bg-surface p-8 text-muted-foreground text-sm">
        Loading movers...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex-1 flex flex-col min-h-0">
        <MoverTable title="Top Gainers" rows={gainers} up />
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <MoverTable title="Top Losers" rows={losers} up={false} />
      </div>
    </div>
  );
};

export default Movers;
