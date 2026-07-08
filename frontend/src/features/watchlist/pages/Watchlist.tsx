import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Plus, Search, Trash2, ArrowUpRight, ArrowDownRight, Lock } from "lucide-react";
import SiteLayout from "@/layouts/SiteLayout";
import { fetchCompanies, fetchCommodities, fetchCurrencies, fetchIndexes, fetchWatchlist, addToWatchlist, removeFromWatchlist, reorderWatchlist, companySlug, type Company, type WatchlistItem } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

import { API_BASE } from '@/lib/api-client';
import {
  commodityApiKeyFromSlug,
  COMMODITY_SLUG_LABELS,
} from "@/lib/commodity-slugs";

const COMMODITY_SLUG_TO_LABEL: Record<string, string> = {
  ...COMMODITY_SLUG_LABELS,
  SLVR: "Silver",
  COPR: "Copper",
  LITH: "Lithium",
  NICK: "Nickel",
  PLAT: "Platinum",
  PALL: "Palladium",
};

const CURRENCY_LABELS: Record<string, { name: string; subtitle: string }> = {
  USDCAD: { name: "USD / CAD", subtitle: "" },
  AUDUSD: { name: "AUD / USD", subtitle: "" },
  CADAUD: { name: "CAD / AUD", subtitle: "" },
  DXY:    { name: "DXY",       subtitle: "US Dollar Index" },
};

const INDEX_LABELS: Record<string, string> = {
  TSX: "S&P/TSX Composite",
  TSXV: "TSX Venture Composite",
  TSXMINE: "S&P/TSX Global Mining",
  XAU: "Philadelphia Gold & Silver",
  HUI: "NYSE Arca Gold BUGS",
  GDX: "VanEck Gold Miners ETF",
  GDXJ: "VanEck Junior Gold Miners",
  COPX: "Global X Copper Miners ETF",
  URA: "Global X Uranium ETF",
  LIT: "Global X Lithium ETF",
};

function fmtIndexPrice(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "-";
  return `$${n.toFixed(Math.abs(n) < 1 ? 3 : 2)}`;
}

function fmtChgAbs(n: number | null | undefined, price: number | null | undefined) {
  if (n == null) return "-";
  const d = price != null && Math.abs(price) < 1 ? 3 : 2;
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(d)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtVol(n: number | null | undefined) {
  if (n == null) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

// [reorder] Ticker Exch Company Price Chg$ Chg% Volume MktCap Tags [del+link].
// Full literal (no interpolation) so Tailwind's JIT emits the arbitrary tracks.
const WATCH_GRID = "grid-cols-[44px_60px_52px_minmax(120px,1.3fr)_80px_84px_72px_78px_90px_minmax(120px,1fr)_72px]";

// Spot tables (commodities / indexes / currencies): no volume/mkt-cap/tags -
// those don't apply - so a leaner set: [reorder] Symbol Name Price Chg$ Chg% [del+open].
const SPOT_GRID = "grid-cols-[44px_120px_minmax(120px,1fr)_140px_120px_110px_72px]";

// Absolute change derived from price + percent change (these feeds only give %).
function deriveChangeAbs(price: number | null | undefined, pct: number | null | undefined): number | null {
  if (price == null || pct == null) return null;
  return price - price / (1 + pct / 100);
}

function fmtMcap(n: number | null | undefined) {
  if (n == null) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n.toFixed(0)}`;
}

function normalizeExchangeForTv(ex: string | null): string | null {
  if (!ex) return null;
  return ex.toUpperCase().replace("-", "");
}

const Watchlist = () => {
  const { isAuthenticated, loading } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showResults, setShowResults] = useState(false);

  const { data: items = [], refetch } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
    enabled: isAuthenticated && !loading,
  });

  const { data: commodityData } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
    staleTime: 30 * 60 * 1000,
  });

  const commodityByKey = useMemo(() => {
    const map = new Map<string, { price: number | null; change_pct: number | null; unit: string }>();
    commodityData?.items?.forEach(c => map.set(c.key, { price: c.price, change_pct: c.change_pct, unit: c.unit }));
    return map;
  }, [commodityData]);

  const { data: currencyData } = useQuery({
    queryKey: ["currencies"],
    queryFn: fetchCurrencies,
    staleTime: 30 * 60 * 1000,
  });

  const currencyByKey = useMemo(() => {
    const map = new Map<string, { price: number | null; change_pct: number | null; subtitle: string | null }>();
    currencyData?.items?.forEach(c => map.set(c.key, { price: c.price, change_pct: c.change_pct, subtitle: c.subtitle }));
    return map;
  }, [currencyData]);

  const { data: indexData } = useQuery({
    queryKey: ["indexes"],
    queryFn: fetchIndexes,
    staleTime: 30 * 60 * 1000,
  });

  const indexByKey = useMemo(() => {
    const map = new Map<string, { price: number | null; change_pct: number | null; label: string; currency: string | null }>();
    indexData?.items?.forEach(idx => map.set(idx.key, {
      price: idx.price,
      change_pct: idx.change_pct,
      label: idx.label,
      currency: idx.currency,
    }));
    return map;
  }, [indexData]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: searchData } = useQuery({
    queryKey: ["watchlist-search", debounced],
    queryFn: () => fetchCompanies({ search: debounced, limit: 8, page: 1 }),
    enabled: debounced.length > 0 && isAuthenticated,
  });

  const results = useMemo<Company[]>(() => searchData?.data ?? [], [searchData]);
  const companyItems = items.filter(i => i.itemType === "company");
  const commodityItems = items.filter(i => i.itemType === "commodity");
  const indexItems = items.filter(i => i.itemType === "index");
  const currencyItems = items.filter(i => i.itemType === "currency");
  const isEmpty = companyItems.length === 0 && commodityItems.length === 0 && indexItems.length === 0 && currencyItems.length === 0;

  if (loading) {
    return (
      <SiteLayout morningBrief className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
      </SiteLayout>
    );
  }

  if (!isAuthenticated) {
    return (
      <SiteLayout morningBrief className="min-h-screen bg-background text-foreground flex flex-col">
        <main className="flex-1 flex items-center justify-center px-4 py-20">
          <div className="max-w-md w-full border border-border bg-card p-8 text-center">
            <div className="mx-auto w-12 h-12 grid place-items-center bg-muted rounded-full mb-4">
              <Lock className="w-5 h-5" />
            </div>
            <h1 className="font-display text-2xl tracking-tight mb-2">Sign in to use your watchlist</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Create a free account to save companies and access full filings &amp; insider data.
            </p>
            <div className="flex gap-2 justify-center">
              <Link
                to="/register?redirect=/watchlist"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium h-10 px-4 py-2 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
              >
                Sign up free
              </Link>
              <Link
                to="/login?redirect=/watchlist"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 rounded-none transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        </main>
      </SiteLayout>
    );
  }

  const handleAddCompany = async (c: Company) => {
    if (items.some(i => i.itemType === "company" && i.itemKey === String(c.id))) return;
    try {
      await addToWatchlist("company", String(c.id), c.id);
      refetch();
    } catch { /* skip */ }
  };

  const handleRemove = async (itemType: string, itemKey: string) => {
    try {
      await removeFromWatchlist(itemType, itemKey);
      refetch();
    } catch { /* skip */ }
  };

  return (
    <SiteLayout morningBrief searchHeroBar className="min-h-screen bg-background text-foreground flex flex-col">
      <section className="bg-background border-b border-border">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-10 lg:py-14 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Your list</div>
            <h1 className="font-display text-4xl lg:text-5xl font-extrabold leading-tight mb-3">Watchlist</h1>
            <p className="text-sm text-foreground/70 max-w-md">
              Track the juniors, indexes, commodities and currencies you care about. {companyItems.length} companies · {indexItems.length} indexes · {commodityItems.length} commodities · {currencyItems.length} currencies
            </p>
          </div>
          <button
            onClick={() => { setShowResults(true); setTimeout(() => document.getElementById("watchlist-search-input")?.focus(), 50); }}
            className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-11 text-sm font-semibold hover:opacity-90 transition-opacity self-start lg:self-auto"
          >
            <Plus className="w-4 h-4" /> Add company
          </button>
        </div>
      </section>

      <main className="flex-1 bg-surface/30">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-10 space-y-6">
          {/* Search */}
          <div className="bg-surface border border-border">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                id="watchlist-search-input"
                type="text"
                placeholder="Search company name or ticker..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setShowResults(true); }}
                onFocus={() => setShowResults(true)}
                className="w-full pl-11 pr-4 h-12 bg-transparent text-sm outline-none"
              />
            </div>
            {showResults && debounced && results.length > 0 && (
              <div className="border-t border-border grid sm:grid-cols-2 gap-px bg-border">
                {results.map((c) => {
                  const already = items.some(i => i.itemType === "company" && i.itemKey === String(c.id));
                  return (
                    <button key={c.id} disabled={already} onClick={() => handleAddCompany(c)}
                      className="bg-surface text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono font-bold text-sm">{c.ticker || "-"}</span>
                          {c.exchange && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{c.exchange}</span>}
                        </div>
                        <div className="text-xs text-foreground/70 truncate">{c.name}</div>
                      </div>
                      <Plus className="w-4 h-4 text-accent shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Company table */}
          {companyItems.length > 0 && (
            <>
              <CompanyWatchTable items={companyItems} onRemove={handleRemove} refetch={refetch} />
              <p className="text-[11px] text-muted-foreground -mt-3">
                Use the up/down arrows to reorder. Click a row to open the company page. Click the trash icon to remove.
              </p>
            </>
          )}

          {/* Commodity watchlist */}
          {commodityItems.length > 0 && (
            <SpotWatchTable
              title="Commodities"
              nameHeader="Name"
              priceHeader="Spot price"
              onRemove={handleRemove}
              refetch={refetch}
              rows={commodityItems.map((it) => {
                const slug = it.itemKey.toUpperCase();
                const apiKey = commodityApiKeyFromSlug(slug);
                const data = commodityByKey.get(apiKey);
                const price = data?.price ?? null;
                const abs = deriveChangeAbs(price, data?.change_pct);
                return {
                  id: it.id,
                  itemType: "commodity",
                  itemKey: it.itemKey,
                  symbol: slug,
                  name: COMMODITY_SLUG_TO_LABEL[slug] || slug,
                  nameSuffix: data?.unit ? `/ ${data.unit}` : null,
                  href: `/market/commodity/${slug}`,
                  changePct: data?.change_pct ?? null,
                  priceText: price != null ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "-",
                  changeAbsText: abs != null ? `${abs >= 0 ? "+" : "-"}$${Math.abs(abs).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "-",
                };
              })}
            />
          )}

          {/* Index watchlist */}
          {indexItems.length > 0 && (
            <SpotWatchTable
              title="Indexes"
              nameHeader="Index"
              priceHeader="Level"
              onRemove={handleRemove}
              refetch={refetch}
              rows={indexItems.map((it) => {
                const slug = it.itemKey.toUpperCase();
                const data = indexByKey.get(slug);
                const price = data?.price ?? null;
                const abs = deriveChangeAbs(price, data?.change_pct);
                return {
                  id: it.id,
                  itemType: "index",
                  itemKey: it.itemKey,
                  symbol: slug,
                  name: data?.label || INDEX_LABELS[slug] || slug,
                  nameSuffix: null,
                  href: `/market/index/${slug}`,
                  changePct: data?.change_pct ?? null,
                  priceText: price != null ? `${fmtIndexPrice(price)}${data?.currency ? ` ${data.currency}` : ""}` : "-",
                  changeAbsText: abs != null ? `${abs >= 0 ? "+" : "-"}${fmtIndexPrice(Math.abs(abs))}` : "-",
                };
              })}
            />
          )}

          {/* Currency watchlist */}
          {currencyItems.length > 0 && (
            <SpotWatchTable
              title="Currencies"
              nameHeader="Pair"
              priceHeader="Rate"
              onRemove={handleRemove}
              refetch={refetch}
              rows={currencyItems.map((it) => {
                const slug = it.itemKey.toUpperCase();
                const data = currencyByKey.get(slug);
                const meta = CURRENCY_LABELS[slug];
                const price = data?.price ?? null;
                const abs = deriveChangeAbs(price, data?.change_pct);
                return {
                  id: it.id,
                  itemType: "currency",
                  itemKey: it.itemKey,
                  symbol: slug,
                  name: meta?.name || slug,
                  nameSuffix: meta?.subtitle || data?.subtitle || null,
                  href: `/market/currency/${slug}`,
                  changePct: data?.change_pct ?? null,
                  priceText: price != null ? price.toFixed(4) : "-",
                  changeAbsText: abs != null ? `${abs >= 0 ? "+" : "-"}${Math.abs(abs).toFixed(4)}` : "-",
                };
              })}
            />
          )}

          {isEmpty && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Your watchlist is empty. Use the search above to add companies, or use <span className="font-semibold text-foreground">Watchlist</span> on any index, commodity, or currency page.
            </div>
          )}
        </div>
      </main>
    </SiteLayout>
  );
};

// ---------------------------------------------------------------------------
// Company watchlist table - full market columns + up/down reordering.
// ---------------------------------------------------------------------------

const CompanyWatchTable = ({
  items,
  onRemove,
  refetch,
}: {
  items: WatchlistItem[];
  onRemove: (itemType: string, itemKey: string) => void;
  refetch: () => void;
}) => {
  const [rows, setRows] = useState<WatchlistItem[]>(items);

  // Resync from server whenever the fetched list changes (after add/remove/reorder).
  useEffect(() => { setRows(items); }, [items]);

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const prev = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next); // optimistic
    try {
      await reorderWatchlist(next.map((r) => r.id));
      refetch();
    } catch {
      setRows(prev); // revert on failure
    }
  };

  return (
    <div className="bg-surface border border-border overflow-x-auto">
      <div className="min-w-[960px]">
        <div className={`grid ${WATCH_GRID} items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground`}>
          <div />
          <div>Ticker</div>
          <div>Exch</div>
          <div>Company</div>
          <div className="text-right">Price</div>
          <div className="text-right">Chg $</div>
          <div className="text-right">Chg %</div>
          <div className="text-right">Volume</div>
          <div className="text-right">Mkt Cap</div>
          <div>Tags</div>
          <div className="text-center">Del</div>
        </div>
        {rows.map((it, i) => (
          <CompanyWatchRow
            key={it.id}
            it={it}
            isFirst={i === 0}
            isLast={i === rows.length - 1}
            onMove={(dir) => move(i, dir)}
            onRemove={() => onRemove("company", it.itemKey)}
          />
        ))}
      </div>
    </div>
  );
};

const CompanyWatchRow = ({
  it,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  it: WatchlistItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const exForTv = normalizeExchangeForTv(it.exchange);
  const enabled = !!(exForTv && it.ticker);
  const { data: quote } = useQuery({
    queryKey: ["watchlist-row-quote", exForTv, it.ticker],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/market/quote/${exForTv}/${it.ticker}`);
      if (!res.ok) return null;
      return res.json() as Promise<{
        price: number | null;
        change_pct: number | null;
        change_abs: number | null;
        volume: number | null;
      }>;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const price = quote?.price ?? null;
  const change = quote?.change_pct ?? null;
  const changeAbs = quote?.change_abs ?? null;
  const volume = quote?.volume ?? null;
  const up = change != null && change >= 0;
  const exLabel = it.exchange === "TSXV" ? "TSX-V" : it.exchange;
  const href = `/company/${companySlug(it.exchange, it.ticker)}`;
  const commodities = it.commodities ?? [];
  const geo = [it.country, ...(it.continents ?? [])].filter(Boolean) as string[];
  const moveColor =
    change == null ? "text-muted-foreground" : up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]";

  return (
    <div className={`grid ${WATCH_GRID} items-center gap-3 px-5 py-4 border-b border-border last:border-b-0 hover:bg-background/40 transition-colors`}>
      {/* Reorder */}
      <div className="flex flex-col -my-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={isFirst}
          aria-label="Move up"
          className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={isLast}
          aria-label="Move down"
          className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Ticker */}
      <Link to={href} className="font-mono font-bold text-sm hover:underline">{it.ticker || "-"}</Link>

      {/* Exch */}
      <span className="font-mono text-[10px] text-muted-foreground uppercase">{exLabel || "-"}</span>

      {/* Company */}
      <Link to={href} className="font-display text-[15px] font-semibold truncate hover:underline">{it.companyName || "-"}</Link>

      {/* Price */}
      <span className="text-right font-mono text-sm font-semibold">{fmtPrice(price)}</span>

      {/* Chg $ */}
      <span className={`text-right font-mono text-sm font-semibold ${moveColor}`}>{fmtChgAbs(changeAbs, price)}</span>

      {/* Chg % */}
      <span className={`text-right font-mono text-sm font-semibold inline-flex justify-end items-center gap-0.5 ${moveColor}`}>
        {change == null ? (
          "-"
        ) : (
          <>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {fmtPct(change)}
          </>
        )}
      </span>

      {/* Volume */}
      <span className="text-right font-mono text-sm text-muted-foreground">{fmtVol(volume)}</span>

      {/* Mkt Cap */}
      <span className="text-right font-mono text-sm font-semibold">{fmtMcap(it.marketCap)}</span>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {commodities.length === 0 && geo.length === 0 ? (
          <span className="text-muted-foreground text-xs">-</span>
        ) : (
          <>
            {commodities.slice(0, 3).map((cm) => (
              <span key={`c-${cm}`} className="text-[10px] font-mono uppercase bg-muted px-1.5 py-0.5 rounded-sm">{cm}</span>
            ))}
            {geo.slice(0, 2).map((g) => (
              <span key={`g-${g}`} className="text-[10px] font-mono uppercase border border-border text-muted-foreground px-1.5 py-0.5 rounded-sm">{g}</span>
            ))}
          </>
        )}
      </div>

      {/* Del + open */}
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors"
          aria-label="Remove"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <Link to={href} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Open company page">
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Spot watchlist table (commodities / indexes / currencies) - reorder + Chg$.
// ---------------------------------------------------------------------------

type SpotRow = {
  id: number;
  itemType: string;
  itemKey: string;
  symbol: string;
  name: string;
  nameSuffix: string | null;
  href: string;
  changePct: number | null;
  priceText: string;
  changeAbsText: string;
};

const SpotWatchTable = ({
  title,
  nameHeader,
  priceHeader,
  rows: incoming,
  onRemove,
  refetch,
}: {
  title: string;
  nameHeader: string;
  priceHeader: string;
  rows: SpotRow[];
  onRemove: (itemType: string, itemKey: string) => void;
  refetch: () => void;
}) => {
  const [rows, setRows] = useState<SpotRow[]>(incoming);

  // Resync whenever the source list / live quotes change.
  useEffect(() => { setRows(incoming); }, [incoming]);

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const prev = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next); // optimistic
    try {
      await reorderWatchlist(next.map((r) => r.id));
      refetch();
    } catch {
      setRows(prev); // revert on failure
    }
  };

  return (
    <>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">{title}</div>
      <div className="bg-surface border border-border overflow-x-auto">
        <div className="min-w-[680px]">
          <div className={`grid ${SPOT_GRID} items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground`}>
            <div />
            <div>Symbol</div>
            <div>{nameHeader}</div>
            <div className="text-right">{priceHeader}</div>
            <div className="text-right">Chg $</div>
            <div className="text-right">Chg %</div>
            <div className="text-center">Del</div>
          </div>
          {rows.map((r, i) => (
            <SpotWatchRow
              key={r.id}
              row={r}
              isFirst={i === 0}
              isLast={i === rows.length - 1}
              onMove={(dir) => move(i, dir)}
              onRemove={() => onRemove(r.itemType, r.itemKey)}
            />
          ))}
        </div>
      </div>
    </>
  );
};

const SpotWatchRow = ({
  row,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  row: SpotRow;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const up = row.changePct != null && row.changePct >= 0;
  const moveColor =
    row.changePct == null ? "text-muted-foreground" : up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]";

  return (
    <div className={`grid ${SPOT_GRID} items-center gap-3 px-5 py-4 border-b border-border last:border-b-0 hover:bg-background/40 transition-colors`}>
      {/* Reorder */}
      <div className="flex flex-col -my-1">
        <button type="button" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Move up"
          className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed">
          <ChevronUp className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={isLast} aria-label="Move down"
          className="text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed">
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Symbol */}
      <Link to={row.href} className="font-mono font-bold text-sm hover:underline">{row.symbol}</Link>

      {/* Name */}
      <Link to={row.href} className="font-display text-[15px] font-semibold truncate hover:underline">
        {row.name}
        {row.nameSuffix && <span className="font-mono text-[10px] text-muted-foreground ml-2">{row.nameSuffix}</span>}
      </Link>

      {/* Price */}
      <span className="text-right font-mono text-sm font-semibold">{row.priceText}</span>

      {/* Chg $ */}
      <span className={`text-right font-mono text-sm font-semibold ${moveColor}`}>{row.changeAbsText}</span>

      {/* Chg % */}
      <span className={`text-right font-mono text-sm inline-flex justify-end items-center gap-0.5 ${moveColor}`}>
        {row.changePct == null ? (
          "-"
        ) : (
          <>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {up ? "+" : ""}{row.changePct.toFixed(2)}%
          </>
        )}
      </span>

      {/* Del + open */}
      <div className="flex items-center justify-center gap-1">
        <button type="button" onClick={onRemove} className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors" aria-label="Remove">
          <Trash2 className="w-4 h-4" />
        </button>
        <Link to={row.href} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Open detail page">
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
};

export default Watchlist;
