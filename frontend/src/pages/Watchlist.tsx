import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { ChevronDown, ChevronUp, Plus, Search, Trash2, ArrowUpRight, ArrowDownRight, ArrowUpDown } from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import Footer from "@/components/site/Footer";
import { fetchCompanies, type Company } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

interface WatchlistItem {
  id: number;
  ticker: string | null;
  exchange: string | null;
  name: string;
  market_cap: number | null;
}

const STORAGE_KEY = "orewire.watchlist.v1";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

function loadWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
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
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>(() => loadWatchlist());
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveWatchlist(items);
  }, [items]);

  const { data: searchData } = useQuery({
    queryKey: ["watchlist-search", debounced],
    queryFn: () => fetchCompanies({ search: debounced, limit: 8, page: 1 }),
    enabled: debounced.length > 0 && isAuthenticated,
  });

  if (!isAuthenticated) {
    return <Navigate to="/login?redirect=/watchlist" replace />;
  }

  const results = useMemo<Company[]>(() => searchData?.data ?? [], [searchData]);

  const addItem = (c: Company) => {
    if (items.some((i) => i.id === c.id)) return;
    setItems((prev) => [
      ...prev,
      {
        id: c.id,
        ticker: c.ticker,
        exchange: c.exchange,
        name: c.name,
        market_cap: c.market_cap,
      },
    ]);
  };

  const remove = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />
      <MarketStrip />

      {/* Header */}
      <section className="bg-background border-b border-border">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-10 lg:py-14 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
              Your list
            </div>
            <h1 className="font-display text-4xl lg:text-5xl font-extrabold leading-tight mb-3">
              Watchlist
            </h1>
            <p className="text-sm text-foreground/70 max-w-md">
              Track the juniors you care about. Saved to this browser — no account needed.
            </p>
          </div>
          <button
            onClick={() => {
              setShowResults(true);
              setTimeout(() => document.getElementById("watchlist-search-input")?.focus(), 50);
            }}
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                className="w-full pl-11 pr-4 h-12 bg-transparent text-sm outline-none"
              />
            </div>
            {showResults && debounced && results.length > 0 && (
              <div className="border-t border-border grid sm:grid-cols-2 gap-px bg-border">
                {results.map((c) => {
                  const already = items.some((i) => i.id === c.id);
                  return (
                    <button
                      key={c.id}
                      disabled={already}
                      onClick={() => addItem(c)}
                      className="bg-surface text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono font-bold text-sm">{c.ticker || "—"}</span>
                          {c.exchange && (
                            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              {c.exchange}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-foreground/70 truncate">{c.name}</div>
                      </div>
                      <Plus className="w-4 h-4 text-accent shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
            {showResults && debounced && results.length === 0 && (
              <div className="border-t border-border px-4 py-6 text-sm text-muted-foreground text-center">
                No matches.
              </div>
            )}
          </div>

          {/* Table */}
          <div className="bg-surface border border-border overflow-hidden">
            <div className="grid grid-cols-[70px_140px_1fr_110px_120px_120px_50px] items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>Order</div>
              <div>Ticker</div>
              <div>Company</div>
              <div className="text-right">Price</div>
              <div className="text-right">Change</div>
              <div className="text-right">Mkt Cap</div>
              <div />
            </div>

            {items.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Your watchlist is empty. Use the search above or click{" "}
                <span className="font-semibold text-foreground">Add company</span> to start.
              </div>
            ) : (
              items.map((it, i) => (
                <WatchlistRow
                  key={it.id}
                  item={it}
                  isFirst={i === 0}
                  isLast={i === items.length - 1}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  onRemove={() => remove(it.id)}
                />
              ))
            )}
          </div>

          {items.length > 0 && (
            <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2">
              <ArrowUpDown className="w-3 h-3" /> Use the up/down arrows to reorder. Click the trash icon to remove.
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};

interface RowProps {
  item: WatchlistItem;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}

const WatchlistRow = ({ item, isFirst, isLast, onUp, onDown, onRemove }: RowProps) => {
  const ex = normalizeExchangeForTv(item.exchange);
  const enabled = !!(ex && item.ticker);

  const { data } = useQuery({
    queryKey: ["watchlist-quote", ex, item.ticker],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/market/quote/${ex}/${item.ticker}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ price: number | null; change_pct: number | null }>;
    },
    enabled,
    staleTime: 60_000,
  });

  const change = data?.change_pct ?? null;
  const up = change != null && change >= 0;

  return (
    <div className="grid grid-cols-[70px_140px_1fr_110px_120px_120px_50px] items-center gap-3 px-5 py-4 border-b border-border last:border-b-0">
      <div className="flex flex-col -my-1">
        <button
          onClick={onUp}
          disabled={isFirst}
          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move up"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={onDown}
          disabled={isLast}
          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move down"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      <div>
        <div className="font-mono font-bold text-sm">{item.ticker || "—"}</div>
        {item.exchange && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {item.exchange}
          </div>
        )}
      </div>

      <div className="font-display text-[15px] font-semibold truncate">{item.name}</div>

      <div className="text-right font-mono text-sm">{fmtPrice(data?.price)}</div>

      <div className="text-right">
        {change == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={`font-mono text-sm inline-flex items-center justify-end gap-1 ${up ? "text-emerald-600" : "text-red-600"}`}>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {up ? "+" : ""}
            {change.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="text-right font-mono text-sm">{fmtMcap(item.market_cap)}</div>

      <div className="flex justify-end">
        <button
          onClick={onRemove}
          className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors"
          aria-label="Remove"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default Watchlist;
