import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, DollarSign, Flame, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import {
  fetchCommodities,
  fetchCurrencies,
  fetchIndexes,
  type CommoditySpot,
  type CurrencySpot,
  type IndexSpot,
} from "@/lib/api";

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

function fmtIndexPrice(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtFxPrice(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(4);
}

const commoditySlugMap: Record<string, string> = {
  gold: "GOLD", silver: "SLVR", copper: "COPR", uranium: "URAN", lithium: "LITH",
  iron_ore: "IRON", nickel: "NICK", zinc: "ZINC", brent: "BRENT", wti: "WTI",
  tin: "TIN", cobalt: "COBALT", lead: "LEAD", platinum: "PLAT", palladium: "PALL",
  natgas: "NATGAS",
};

const COMMODITY_FALLBACK: CommoditySpot[] = [
  // Must show — core metals
  { key: "gold",      label: "Gold",            unit: "oz",  price: null, change_pct: null },
  { key: "silver",    label: "Silver",          unit: "oz",  price: null, change_pct: null },
  { key: "copper",    label: "Copper",          unit: "lb",  price: null, change_pct: null },
  { key: "uranium",   label: "Uranium",         unit: "lb",  price: null, change_pct: null },
  { key: "lithium",   label: "Lithium",         unit: "t",   price: null, change_pct: null },
  { key: "iron_ore",  label: "Iron Ore",        unit: "t",   price: null, change_pct: null },
  { key: "nickel",    label: "Nickel",          unit: "t",   price: null, change_pct: null },
  // Should show — context
  { key: "zinc",      label: "Zinc",            unit: "t",   price: null, change_pct: null },
  { key: "brent",     label: "Brent Crude Oil", unit: "bbl", price: null, change_pct: null },
  { key: "wti",       label: "WTI Crude Oil",   unit: "bbl", price: null, change_pct: null },
  { key: "tin",       label: "Tin",             unit: "t",   price: null, change_pct: null },
  { key: "cobalt",    label: "Cobalt",          unit: "t",   price: null, change_pct: null },
  { key: "lead",      label: "Lead",            unit: "t",   price: null, change_pct: null },
  { key: "platinum",  label: "Platinum",        unit: "oz",  price: null, change_pct: null },
  { key: "palladium", label: "Palladium",       unit: "oz",  price: null, change_pct: null },
];

const INDEX_KIND: Record<string, "ETF" | "IDX"> = {
  GDXJ: "ETF", GDX: "ETF", URA: "ETF", COPX: "ETF", SIL: "ETF", LIT: "ETF", PICK: "ETF",
  TSXV: "IDX", XMM: "IDX", XGD: "IDX", TSX: "IDX", XJO: "IDX", SPX: "IDX", VIX: "IDX",
  TSXMINE: "IDX", XAU: "IDX", HUI: "IDX", SPTSXG: "IDX",
};

const INDEX_FALLBACK: IndexSpot[] = [
  { key: "GDXJ", label: "Junior Gold Miners ETF",   about: "ETF", price: null, change_pct: null, currency: null },
  { key: "TSXV", label: "TSX Venture Composite",    about: "IDX", price: null, change_pct: null, currency: null },
  { key: "XMM",  label: "ASX 300 Metals & Mining",  about: "IDX", price: null, change_pct: null, currency: null },
  { key: "GDX",  label: "Gold Miners ETF",          about: "ETF", price: null, change_pct: null, currency: null },
  { key: "XGD",  label: "S&P/TSX Gold Index",       about: "IDX", price: null, change_pct: null, currency: null },
  { key: "URA",  label: "Uranium Miners ETF",       about: "ETF", price: null, change_pct: null, currency: null },
  { key: "COPX", label: "Copper Miners ETF",        about: "ETF", price: null, change_pct: null, currency: null },
  { key: "SIL",  label: "Silver Miners ETF",        about: "ETF", price: null, change_pct: null, currency: null },
  { key: "LIT",  label: "Lithium & Battery ETF",    about: "ETF", price: null, change_pct: null, currency: null },
  { key: "PICK", label: "Metal & Mining SPDR ETF",  about: "ETF", price: null, change_pct: null, currency: null },
  { key: "TSX",  label: "S&P/TSX Composite",        about: "IDX", price: null, change_pct: null, currency: null },
  { key: "XJO",  label: "ASX 200",                  about: "IDX", price: null, change_pct: null, currency: null },
  { key: "SPX",  label: "S&P 500",                  about: "IDX", price: null, change_pct: null, currency: null },
  { key: "VIX",  label: "Volatility Index",         about: "IDX", price: null, change_pct: null, currency: null },
];

const CURRENCY_FALLBACK: CurrencySpot[] = [
  { key: "AUDCAD", label: "AUD / CAD", subtitle: null,             price: null, change_pct: null },
  { key: "USDCAD", label: "USD / CAD", subtitle: null,             price: null, change_pct: null },
  { key: "AUDUSD", label: "AUD / USD", subtitle: null,             price: null, change_pct: null },
  { key: "DXY",    label: "DXY",       subtitle: "US Dollar Index", price: null, change_pct: null },
];

const SectionHeader = ({
  icon: Icon,
  title,
  meta,
  accent,
}: {
  icon: typeof Flame;
  title: string;
  meta: string;
  accent?: boolean;
}) => (
  <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 ${accent ? "text-accent" : ""}`} />
      <h3 className="font-display text-sm font-bold tracking-tight">{title}</h3>
      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{meta}</span>
    </div>
  </div>
);

const TableHeader = () => (
  <thead>
    <tr className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
      <th className="text-left px-3 py-1.5 font-medium">Ticker</th>
      <th className="text-right py-1.5 font-medium">Last</th>
      <th className="text-right px-3 py-1.5 font-medium">Chg</th>
    </tr>
  </thead>
);

const ChgCell = ({ value }: { value: number | null }) => {
  if (value == null) {
    return (
      <td className="px-3 py-2 text-right font-mono font-bold text-muted-foreground">—</td>
    );
  }
  const up = value >= 0;
  return (
    <td className={`px-3 py-2 text-right font-mono font-bold ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
      <span className="inline-flex items-center gap-0.5">
        {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {fmtPct(value)}
      </span>
    </td>
  );
};

const CommoditySidebar = () => {
  const { data: commodityData } = useQuery({
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

  // Always render the curated lists in this order; merge live API data when keys match.
  const commodities = COMMODITY_FALLBACK.map((fallback) => {
    const live = commodityData?.items?.find((i) => i.key === fallback.key);
    return live ? { ...fallback, price: live.price, change_pct: live.change_pct } : fallback;
  });
  const indexes = INDEX_FALLBACK.map((fallback) => {
    const live = indexData?.items?.find((i) => i.key === fallback.key);
    return live ? { ...fallback, price: live.price, change_pct: live.change_pct, currency: live.currency } : fallback;
  });
  const currencies = CURRENCY_FALLBACK.map((fallback) => {
    const live = currencyData?.items?.find((i) => i.key === fallback.key);
    return live ? { ...fallback, price: live.price, change_pct: live.change_pct } : fallback;
  });

  return (
    <div className="flex flex-col gap-4 min-h-0 lg:h-full">
      {/* Commodities */}
      <div className="border border-border bg-surface flex flex-col flex-1 min-h-0">
        <SectionHeader icon={Flame} title="Commodities" meta="· Spot" accent />
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-[12.5px]">
            <TableHeader />
            <tbody className="divide-y divide-border">
              {commodities.map((c) => {
                const slug = commoditySlugMap[c.key] || c.key.toUpperCase();
                return (
                  <tr key={c.key} className="hover:bg-background/60 transition-colors cursor-pointer group">
                    <td className="px-3 py-2">
                      <Link to={`/market/commodity/${slug}`} className="block">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold group-hover:underline">{slug}</span>
                          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
                            SPOT
                          </span>
                        </div>
                        <div className="text-[10.5px] text-muted-foreground truncate max-w-[140px]">
                          {c.label} / {c.unit}
                        </div>
                      </Link>
                    </td>
                    <td className="py-2 text-right font-mono font-semibold whitespace-nowrap">{fmtPrice(c.price)}</td>
                    <ChgCell value={c.change_pct} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Indexes */}
      <div className="border border-border bg-surface flex flex-col flex-1 min-h-0">
        <SectionHeader icon={TrendingUp} title="Indexes" meta="· Mining & Markets" />
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-[12.5px]">
            <TableHeader />
            <tbody className="divide-y divide-border">
              {indexes.map((idx) => {
                const kind = INDEX_KIND[idx.key] || (idx.about === "ETF" ? "ETF" : "IDX");
                return (
                  <tr key={idx.key} className="hover:bg-background/60 transition-colors cursor-pointer group">
                    <td className="px-3 py-2">
                      <Link to={`/market/index/${idx.key}`} className="block">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold group-hover:underline">{idx.key}</span>
                          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
                            {kind}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-muted-foreground truncate max-w-[180px]">{idx.label}</div>
                      </Link>
                    </td>
                    <td className="py-2 text-right font-mono font-semibold whitespace-nowrap">{fmtIndexPrice(idx.price)}</td>
                    <ChgCell value={idx.change_pct} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Currencies */}
      <div className="border border-border bg-surface flex flex-col flex-1 min-h-0">
        <SectionHeader icon={DollarSign} title="Currencies" meta="· FX · Spot" accent />
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-[12.5px]">
            <TableHeader />
            <tbody className="divide-y divide-border">
              {currencies.map((c) => (
                <tr key={c.key} className="hover:bg-background/60 transition-colors cursor-pointer group">
                  <td className="px-3 py-2">
                    <Link to={`/market/currency/${c.key}`} className="block">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold group-hover:underline">{c.label || c.key}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
                          FX
                        </span>
                      </div>
                      {c.subtitle && (
                        <div className="text-[10.5px] text-muted-foreground truncate max-w-[180px]">{c.subtitle}</div>
                      )}
                    </Link>
                  </td>
                  <td className="py-2 text-right font-mono font-semibold whitespace-nowrap">{fmtFxPrice(c.price)}</td>
                  <ChgCell value={c.change_pct} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CommoditySidebar;
