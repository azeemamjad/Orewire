import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, DollarSign, Flame, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchCommodities, fetchCurrencies, fetchIndexes, type CommoditySpot } from "@/lib/api";

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

const commoditySlugMap: Record<string, string> = {
  gold: "GOLD", silver: "SLVR", copper: "COPR", platinum: "PLAT", palladium: "PALL",
  lithium: "LITH", nickel: "NICK", cobalt: "COBALT", uranium: "URAN", iron_ore: "IRON",
  zinc: "ZINC", wti: "WTI", brent: "BRENT", natgas: "NATGAS",
};

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
  key: string;
  label: string;
  price: number | null;
  change_pct: number | null;
}

const placeholderIndexes: IndexItem[] = [
  { key: "TSX",     label: "S&P/TSX Composite",          price: null, change_pct: null },
  { key: "TSXV",    label: "TSX Venture Composite",      price: null, change_pct: null },
  { key: "TSXMINE", label: "S&P/TSX Global Mining",      price: null, change_pct: null },
  { key: "XAU",     label: "Philadelphia Gold & Silver", price: null, change_pct: null },
  { key: "HUI",     label: "NYSE Arca Gold BUGS",        price: null, change_pct: null },
  { key: "GDX",     label: "VanEck Gold Miners ETF",     price: null, change_pct: null },
  { key: "GDXJ",    label: "VanEck Junior Gold Miners",  price: null, change_pct: null },
  { key: "COPX",    label: "Global X Copper Miners",     price: null, change_pct: null },
  { key: "URA",     label: "Global X Uranium ETF",       price: null, change_pct: null },
  { key: "LIT",     label: "Global X Lithium ETF",       price: null, change_pct: null },
];

const CommoditySidebar = () => {
  const { data } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const { data: indexData } = useQuery({
    queryKey: ["indexes"],
    queryFn: fetchIndexes,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const { data: currencyData } = useQuery({
    queryKey: ["currencies"],
    queryFn: fetchCurrencies,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS,
  });

  const items = data?.items?.length ? data.items : FALLBACK;
  const currencies = currencyData?.items ?? [];

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
        <div className="max-h-[238px] overflow-auto">
          {items.map((c) => {
            const up = (c.change_pct ?? 0) >= 0;
            const slug = commoditySlugMap[c.key] || c.key.toUpperCase();
            return (
              <Link key={c.key} to={`/market/commodity/${slug}`} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 hover:bg-background/60 transition-colors cursor-pointer">
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
              </Link>
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
        <div className="max-h-[295px] overflow-auto">
          {(indexData?.items?.length ? indexData.items : placeholderIndexes).map((idx) => {
            const up = (idx.change_pct ?? 0) >= 0;
            const priceStr = idx.price != null ? idx.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
            const changeStr = idx.change_pct != null ? `${idx.change_pct >= 0 ? "+" : ""}${idx.change_pct.toFixed(2)}%` : "—";
            return (
              <a key={idx.key} href={`/market/index/${idx.key}`} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 hover:bg-background/60 transition-colors cursor-pointer">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium truncate">{idx.label}</div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="font-mono font-bold text-[12.5px]">{priceStr}</div>
                  {idx.change_pct != null && (
                    <div className={`font-mono text-[10.5px] font-semibold inline-flex items-center gap-0.5 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                      {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                      {changeStr}
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* Currencies */}
      <div className="border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-accent" />
            <h3 className="font-display text-sm font-bold tracking-tight">Currencies</h3>
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· FX · Spot</span>
          </div>
        </div>
        <div>
          {currencies.length === 0 ? (
            [
              { key: "USDCAD", label: "USD / CAD", subtitle: null, price: null, change_pct: null },
              { key: "AUDUSD", label: "AUD / USD", subtitle: null, price: null, change_pct: null },
              { key: "CADAUD", label: "CAD / AUD", subtitle: null, price: null, change_pct: null },
              { key: "DXY", label: "DXY", subtitle: "US Dollar Index", price: null, change_pct: null },
            ].map((c) => (
              <div key={c.key} className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 hover:bg-background/60 transition-colors cursor-pointer">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium truncate">{c.label}</div>
                  {c.subtitle && <div className="font-mono text-[10px] text-muted-foreground">{c.subtitle}</div>}
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="font-mono font-bold text-[12.5px]">—</div>
                </div>
              </div>
            ))
          ) : (
            currencies.map((c) => {
              const up = (c.change_pct ?? 0) >= 0;
              const slug = c.key;
              return (
                <a key={c.key} className="block" href={`/market/currency/${slug}`}>
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border last:border-0 hover:bg-background/60 transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium truncate">{c.label}</div>
                      {c.subtitle && <div className="font-mono text-[10px] text-muted-foreground">{c.subtitle}</div>}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="font-mono font-bold text-[12.5px]">{c.price != null ? c.price.toFixed(4) : "—"}</div>
                      {c.change_pct != null && (
                        <div className={`font-mono text-[10.5px] font-semibold inline-flex items-center gap-0.5 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                          {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                          {up ? "+" : ""}{c.change_pct.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default CommoditySidebar;
