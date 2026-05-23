import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Flame, TrendingUp } from "lucide-react";
import { fetchCommodities, type CommoditySpot } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000;

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100) return "$" + n.toFixed(1);
  return "$" + n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

const FALLBACK: CommoditySpot[] = [
  { key: "gold", label: "Gold", unit: "oz", price: null, change_pct: null },
  { key: "silver", label: "Silver", unit: "oz", price: null, change_pct: null },
  { key: "copper", label: "Copper", unit: "lb", price: null, change_pct: null },
  { key: "platinum", label: "Platinum", unit: "oz", price: null, change_pct: null },
  { key: "palladium", label: "Palladium", unit: "oz", price: null, change_pct: null },
  { key: "lithium", label: "Lithium", unit: "t", price: null, change_pct: null },
  { key: "nickel", label: "Nickel", unit: "t", price: null, change_pct: null },
  { key: "cobalt", label: "Cobalt", unit: "t", price: null, change_pct: null },
  { key: "uranium", label: "Uranium U₃O₈", unit: "lb", price: null, change_pct: null },
  { key: "iron_ore", label: "Iron Ore", unit: "t", price: null, change_pct: null },
  { key: "zinc", label: "Zinc", unit: "t", price: null, change_pct: null },
  { key: "wti", label: "Crude (WTI)", unit: "bbl", price: null, change_pct: null },
  { key: "brent", label: "Brent", unit: "bbl", price: null, change_pct: null },
  { key: "natgas", label: "Natural Gas", unit: "MMBtu", price: null, change_pct: null },
];

interface IndexItem {
  label: string;
  price: string;
  change: string;
  up: boolean;
}

const placeholderIndexes: IndexItem[] = [
  { label: "S&P/TSX Composite", price: "23,184.20", change: "+0.42%", up: true },
  { label: "S&P/TSX Venture", price: "608.74", change: "+1.18%", up: true },
  { label: "S&P/TSX Global Mining", price: "412.30", change: "+0.86%", up: true },
  { label: "ASX 200", price: "8,142.10", change: "+0.31%", up: true },
  { label: "ASX All Ords Gold", price: "9,418.50", change: "+2.14%", up: true },
  { label: "ASX Resources 300", price: "6,284.40", change: "-0.42%", up: false },
  { label: "NYSE Arca Gold BUGS (HUI)", price: "318.74", change: "+1.62%", up: true },
  { label: "Philadelphia Gold & Silver (XAU)", price: "164.20", change: "+1.41%", up: true },
  { label: "Solactive Junior Gold", price: "284.10", change: "+0.92%", up: true },
  { label: "MVIS Junior Gold Miners", price: "46.18", change: "+1.04%", up: true },
  { label: "Bloomberg Industrial Metals", price: "182.40", change: "-0.18%", up: false },
  { label: "Solactive Global Lithium", price: "72.84", change: "-1.42%", up: false },
];

const CommoditySidebar = () => {
  const { data } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const items = data?.items?.length ? data.items : FALLBACK;

  return (
    <div className="space-y-4">
      {/* Commodities */}
      <div className="border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Flame className="w-3.5 h-3.5 text-accent" />
            <h3 className="font-display text-sm font-bold tracking-tight">Commodities</h3>
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· Spot</span>
          </div>
        </div>
        <div className="max-h-[360px] overflow-auto">
          {items.map((c) => {
            const up = (c.change_pct ?? 0) >= 0;
            return (
              <div key={c.key} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 hover:bg-background/60">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium truncate">{c.label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">/ {c.unit}</div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="font-mono font-bold text-[12.5px]">{fmtPrice(c.price)}</div>
                  {c.change_pct != null && (
                    <div className={`font-mono text-[10.5px] font-semibold inline-flex items-center gap-0.5 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                      {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                      {fmtPct(c.change_pct)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Indexes */}
      <div className="border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            <h3 className="font-display text-sm font-bold tracking-tight">Indexes</h3>
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· Mining &amp; Markets</span>
          </div>
        </div>
        <div className="max-h-[360px] overflow-auto">
          {placeholderIndexes.map((idx) => (
            <div key={idx.label} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 hover:bg-background/60">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium truncate">{idx.label}</div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <div className="font-mono font-bold text-[12.5px]">{idx.price}</div>
                <div className={`font-mono text-[10.5px] font-semibold inline-flex items-center gap-0.5 ${idx.up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                  {idx.up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                  {idx.change}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommoditySidebar;
