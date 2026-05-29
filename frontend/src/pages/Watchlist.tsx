import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Plus, Search, Trash2, ArrowUpRight, ArrowDownRight, ArrowUpDown, Lock } from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import MorningBrief from "@/components/site/MorningBrief";
import Footer from "@/components/site/Footer";
import { fetchCompanies, fetchCommodities, fetchCurrencies, fetchIndexes, fetchWatchlist, addToWatchlist, removeFromWatchlist, companySlug, type Company } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

const COMMODITY_SLUG_TO_KEY: Record<string, string> = {
  GOLD: "gold", SLVR: "silver", COPR: "copper", PLAT: "platinum", PALL: "palladium",
  LITH: "lithium", NICK: "nickel", COBALT: "cobalt", URAN: "uranium", IRON: "iron_ore",
  ZINC: "zinc", WTI: "wti", BRENT: "brent", NATGAS: "natgas",
};
const COMMODITY_SLUG_TO_LABEL: Record<string, string> = {
  GOLD: "Gold", SLVR: "Silver", COPR: "Copper", PLAT: "Platinum", PALL: "Palladium",
  LITH: "Lithium", NICK: "Nickel", COBALT: "Cobalt", URAN: "Uranium U₃O₈", IRON: "Iron Ore",
  ZINC: "Zinc", WTI: "Crude (WTI)", BRENT: "Brent", NATGAS: "Natural Gas",
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
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtMcap(n: number | null | undefined) {
  if (n == null) return "—";
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
      <div className="min-h-screen bg-background flex flex-col">
        <Nav />
        <MarketStrip />
        <MorningBrief />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
        <Footer />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <Nav />
        <MarketStrip />
        <MorningBrief />
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
        <Footer />
      </div>
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
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />
      <MarketStrip />
      <MorningBrief />

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
                          <span className="font-mono font-bold text-sm">{c.ticker || "—"}</span>
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
            <div className="bg-surface border border-border overflow-hidden">
              <div className="grid grid-cols-[140px_1fr_110px_120px_50px] items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>Ticker</div><div>Company</div><div className="text-right">Mkt Cap</div><div className="text-right">Exchange</div><div />
              </div>
              {companyItems.map((it) => (
                <div key={it.id} className="grid grid-cols-[140px_1fr_110px_120px_50px] items-center gap-3 px-5 py-4 border-b border-border last:border-b-0">
                  <Link to={`/company/${companySlug(it.exchange, it.ticker)}`} className="hover:underline">
                    <div className="font-mono font-bold text-sm">{it.ticker || "—"}</div>
                  </Link>
                  <Link to={`/company/${companySlug(it.exchange, it.ticker)}`} className="font-display text-[15px] font-semibold truncate hover:underline">{it.companyName || "—"}</Link>
                  <div className="text-right font-mono text-sm">{fmtMcap(it.marketCap)}</div>
                  <div className="text-right font-mono text-xs text-muted-foreground">{it.exchange || "—"}</div>
                  <div className="flex justify-end">
                    <button onClick={() => handleRemove("company", it.itemKey)} className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors" aria-label="Remove">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Commodity watchlist */}
          {commodityItems.length > 0 && (
            <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">Commodities</div>
            <div className="bg-surface border border-border overflow-hidden">
              <div className="grid grid-cols-[140px_1fr_140px_120px_50px] items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>Symbol</div><div>Name</div><div className="text-right">Spot price</div><div className="text-right">Change</div><div />
              </div>
              {commodityItems.map((it) => {
                const slug = it.itemKey.toUpperCase();
                const apiKey = COMMODITY_SLUG_TO_KEY[slug] || slug.toLowerCase();
                const data = commodityByKey.get(apiKey);
                const label = COMMODITY_SLUG_TO_LABEL[slug] || slug;
                const up = (data?.change_pct ?? 0) >= 0;
                return (
                  <div key={it.id} className="grid grid-cols-[140px_1fr_140px_120px_50px] items-center gap-3 px-5 py-4 border-b border-border last:border-b-0">
                    <Link to={`/market/commodity/${slug}`} className="font-mono font-bold text-sm hover:underline">{slug}</Link>
                    <Link to={`/market/commodity/${slug}`} className="font-display text-[15px] font-semibold truncate hover:underline">
                      {label}
                      {data?.unit && <span className="font-mono text-[10px] text-muted-foreground ml-2">/ {data.unit}</span>}
                    </Link>
                    <div className="text-right font-mono text-sm font-semibold">
                      {data?.price != null ? `$${data.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
                    </div>
                    <div className="text-right">
                      {data?.change_pct == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={`font-mono text-sm inline-flex items-center justify-end gap-1 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {up ? "+" : ""}{data.change_pct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => handleRemove("commodity", it.itemKey)} className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors" aria-label="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}

          {/* Index watchlist */}
          {indexItems.length > 0 && (
            <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">Indexes</div>
            <div className="bg-surface border border-border overflow-hidden">
              <div className="grid grid-cols-[140px_1fr_140px_120px_50px] items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>Symbol</div><div>Index</div><div className="text-right">Level</div><div className="text-right">Change</div><div />
              </div>
              {indexItems.map((it) => {
                const slug = it.itemKey.toUpperCase();
                const data = indexByKey.get(slug);
                const label = data?.label || INDEX_LABELS[slug] || slug;
                const up = (data?.change_pct ?? 0) >= 0;
                return (
                  <div key={it.id} className="grid grid-cols-[140px_1fr_140px_120px_50px] items-center gap-3 px-5 py-4 border-b border-border last:border-b-0">
                    <Link to={`/market/index/${slug}`} className="font-mono font-bold text-sm hover:underline">{slug}</Link>
                    <Link to={`/market/index/${slug}`} className="font-display text-[15px] font-semibold truncate hover:underline">{label}</Link>
                    <div className="text-right font-mono text-sm font-semibold">
                      {data?.price != null ? (
                        <>
                          {fmtIndexPrice(data.price)}
                          {data.currency && <span className="text-[10px] text-muted-foreground ml-1">{data.currency}</span>}
                        </>
                      ) : "—"}
                    </div>
                    <div className="text-right">
                      {data?.change_pct == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={`font-mono text-sm inline-flex items-center justify-end gap-1 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {up ? "+" : ""}{data.change_pct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => handleRemove("index", it.itemKey)} className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors" aria-label="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}

          {/* Currency watchlist */}
          {currencyItems.length > 0 && (
            <>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">Currencies</div>
            <div className="bg-surface border border-border overflow-hidden">
              <div className="grid grid-cols-[140px_1fr_140px_120px_50px] items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>Symbol</div><div>Pair</div><div className="text-right">Rate</div><div className="text-right">Change</div><div />
              </div>
              {currencyItems.map((it) => {
                const slug = it.itemKey.toUpperCase();
                const data = currencyByKey.get(slug);
                const meta = CURRENCY_LABELS[slug];
                const up = (data?.change_pct ?? 0) >= 0;
                return (
                  <div key={it.id} className="grid grid-cols-[140px_1fr_140px_120px_50px] items-center gap-3 px-5 py-4 border-b border-border last:border-b-0">
                    <Link to={`/market/currency/${slug}`} className="font-mono font-bold text-sm hover:underline">{slug}</Link>
                    <Link to={`/market/currency/${slug}`} className="font-display text-[15px] font-semibold truncate hover:underline">
                      {meta?.name || slug}
                      {(meta?.subtitle || data?.subtitle) && (
                        <span className="font-mono text-[10px] text-muted-foreground ml-2">{meta?.subtitle || data?.subtitle}</span>
                      )}
                    </Link>
                    <div className="text-right font-mono text-sm font-semibold">
                      {data?.price != null ? data.price.toFixed(4) : "—"}
                    </div>
                    <div className="text-right">
                      {data?.change_pct == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={`font-mono text-sm inline-flex items-center justify-end gap-1 ${up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                          {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {up ? "+" : ""}{data.change_pct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => handleRemove("currency", it.itemKey)} className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors" aria-label="Remove">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}

          {isEmpty && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Your watchlist is empty. Use the search above to add companies, or use <span className="font-semibold text-foreground">Watchlist</span> on any index, commodity, or currency page.
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Watchlist;
