import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { fetchCommodities, type CommoditySpot } from "@/lib/api";
import { commoditySlugFromKey } from "@/lib/commodity-slugs";

const REFETCH_MS = 30 * 60 * 1000;

function fmtPrice(n: number | null): string {
  if (n == null) return "-";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

const FALLBACK: CommoditySpot[] = [
  { key: "gold",    label: "Gold",     unit: "oz", price: null, change_pct: null },
  { key: "silver",  label: "Silver",   unit: "oz", price: null, change_pct: null },
  { key: "copper",  label: "Copper",   unit: "lb", price: null, change_pct: null },
  { key: "lithium", label: "Lithium",  unit: "t",  price: null, change_pct: null },
  { key: "nickel",  label: "Nickel",   unit: "t",  price: null, change_pct: null },
];

const CommodityBar = () => {
  const { data } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const items = data?.items ?? FALLBACK;

  return (
    <div className="bg-surface border-b border-border">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-2.5 flex items-center gap-6 overflow-x-auto">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">Spot</span>
        {items.map((c) => {
          const up = (c.change_pct ?? 0) >= 0;
          const slug = commoditySlugFromKey(c.key);
          return (
            <a key={c.key} href={`/market/commodity/${slug}`} className="flex items-center gap-2 shrink-0 font-mono text-[11px] hover:opacity-80 transition-opacity">
              <span className="text-muted-foreground">{c.label}</span>
              <span className="font-bold text-foreground">${fmtPrice(c.price)}</span>
              <span className="text-muted-foreground">/{c.unit}</span>
              {c.change_pct != null && (
                <span className={`flex items-center gap-0.5 font-semibold ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                  {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {fmtPct(c.change_pct)}
                </span>
              )}
            </a>
          );
        })}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0 hidden lg:inline">Spot · metals.live / TradingView</span>
      </div>
    </div>
  );
};

export default CommodityBar;
