import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { fetchMovers, companySlug, type MoverItem } from "@/lib/api";

const REFETCH_MS = 60 * 1000;

function fmtPrice(n: number | null): string {
  if (n == null) return "-";
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtMktCap(n: number | null): string {
  if (n == null) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function normExLabel(ex: string): string {
  if (ex === "TSXV") return "TSX-V";
  return ex;
}

// "ALPHA HPA LIMITED" -> "Alpha Hpa Limited" so long names take less width.
function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const MoverTable = ({ title, rows, up }: { title: string; rows: MoverItem[]; up: boolean }) => {
  const navigate = useNavigate();
  return (
  <div className="card-surface flex flex-col flex-1 min-h-0">
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2">
        {up ? (
          <TrendingUp className="w-3.5 h-3.5 text-[hsl(var(--up))]" />
        ) : (
          <TrendingDown className="w-3.5 h-3.5 text-[hsl(var(--down))]" />
        )}
        <h3 className="font-display text-sm font-bold tracking-tight">{title}</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">· Today</span>
      </div>
      <Link to="/companies" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
        All →
      </Link>
    </div>
    <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
    <table className="w-full table-fixed text-[12px]">
      <colgroup>
        <col />
        <col className="w-[76px]" />
        <col className="w-[84px]" />
        <col className="w-[86px] hidden 2xl:table-column" />
      </colgroup>
      <thead>
        <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <th className="text-left pl-4 pr-2 py-1.5 font-medium">Ticker</th>
          <th className="text-right px-2 py-1.5 font-medium">Last</th>
          <th className="text-right px-2 py-1.5 font-medium">Chg</th>
          <th className="text-right pl-2 pr-4 py-1.5 font-medium hidden 2xl:table-cell">Mkt Cap</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className="pl-4 pr-2 py-6 text-center text-muted-foreground text-xs">
              No data yet - try again in a moment.
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr
              key={`${r.exchange}-${r.ticker}-${i}`}
              className="hover:bg-background/60 transition-colors cursor-pointer"
              onClick={() => navigate(`/company/${companySlug(r.exchange, r.ticker)}`)}
            >
              <td className="pl-4 pr-2 py-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold">{r.ticker}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5 shrink-0">
                    {normExLabel(r.exchange)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate" title={titleCase(r.name)}>
                  {titleCase(r.name)}
                </div>
              </td>
              <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap">${fmtPrice(r.price)}</td>
              <td className={`px-2 py-2 text-right font-mono font-bold tabular-nums whitespace-nowrap ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                <span className="inline-flex items-center justify-end gap-0.5">
                  {up ? <ArrowUpRight className="w-3 h-3 shrink-0" /> : <ArrowDownRight className="w-3 h-3 shrink-0" />}{fmtPct(r.change_pct)}
                </span>
              </td>
              <td className="pl-2 pr-4 py-2 text-right font-mono tabular-nums text-muted-foreground hidden 2xl:table-cell">
                {fmtMktCap(r.market_cap)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
    </div>
  </div>
  );
};

const Movers = ({ className = "" }: { className?: string }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["movers", "ALL"],
    queryFn: () => fetchMovers({ exchange: "ALL", limit: 10 }),
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const gainers = data?.gainers?.slice(0, 10) ?? [];
  const losers = data?.losers?.slice(0, 10) ?? [];

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center card-surface p-8 text-muted-foreground text-sm">
        Loading movers...
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 min-h-0 lg:h-full ${className}`}>
      <MoverTable title="Top Gainers" rows={gainers} up />
      <MoverTable title="Top Losers" rows={losers} up={false} />
    </div>
  );
};

export default Movers;
