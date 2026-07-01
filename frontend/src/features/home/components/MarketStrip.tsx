import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { fetchMovers, type MoverItem } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000; // 30 minutes

function exPrefix(ex: string): string {
  if (ex === "TSXV") return "TSXV";
  return ex;
}

function fmtPx(n: number | null): string {
  if (n == null) return "-";
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

interface StripItem {
  sym: string;
  px: string;
  chg: string;
  up: boolean;
}

const MarketStrip = () => {
  const { data } = useQuery({
    queryKey: ["movers", "strip", "ALL"],
    queryFn: () => fetchMovers({ exchange: "ALL", limit: 10 }),
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const items = useMemo<StripItem[]>(() => {
    const fromMover = (m: MoverItem, up: boolean): StripItem => ({
      sym: `${exPrefix(m.exchange)}:${m.ticker}`,
      px: fmtPx(m.price),
      chg: fmtPct(m.change_pct),
      up,
    });
    if (!data) return [];
    const gainers = data.gainers.slice(0, 6).map((m) => fromMover(m, true));
    const losers = data.losers.slice(0, 4).map((m) => fromMover(m, false));
    return [...gainers, ...losers];
  }, [data]);

  // Fall back to a static placeholder while loading so the bar height is preserved
  const display = items.length > 0 ? items : [
    { sym: "TSX-V: -", px: "-", chg: "-", up: true },
    { sym: "ASX: -", px: "-", chg: "-", up: true },
    { sym: "CSE: -", px: "-", chg: "-", up: false },
  ];

  return (
    <div className="bg-[hsl(220_45%_10%)] text-[hsl(36_30%_94%)] border-b border-[hsl(36_30%_94%/0.1)] overflow-hidden">
      <div className="ticker flex items-center gap-8 py-2 whitespace-nowrap w-max">
        {[...display, ...display].map((t, i) => (
          <div key={i} className="flex items-center gap-2 font-mono text-[11px] shrink-0">
            <span className="text-[hsl(36_30%_94%/0.7)]">{t.sym}</span>
            <span className="font-bold">${t.px}</span>
            <span className={`flex items-center gap-0.5 font-semibold ${t.up ? "text-[hsl(174_62%_52%)]" : "text-[hsl(0_70%_60%)]"}`}>
              {t.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{t.chg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarketStrip;
