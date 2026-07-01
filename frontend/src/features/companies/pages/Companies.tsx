import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ListingPagination from "@/components/site/ListingPagination";
import SiteLayout from "@/layouts/SiteLayout";
import { ArrowDown, ArrowUp, Filter, Search, Sparkles, Star, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchCompanies,
  fetchCompanyFilters,
  companySlug,
  addToWatchlist,
  removeFromWatchlist,
  checkWatchlist,
  type Company,
} from "@/lib/api";
import { parseCompanySearchQuery, parsedExchangeToMarket } from "@/lib/company-search-parse";

type Selected = {
  market: string | null;
  commodity: string | null;
  continent: string | null;
  country: string | null;
};

const EMPTY: Selected = {
  market: null,
  commodity: null,
  continent: null,
  country: null,
};

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

function fmtMcap(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "-";
  return `$${n.toFixed(Math.abs(n) < 1 ? 3 : 2)}`;
}

function fmtChgAbs(n: number | null | undefined, price: number | null | undefined): string {
  if (n == null) return "-";
  const d = price != null && Math.abs(price) < 1 ? 3 : 2;
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(d)}`;
}

function fmtVol(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

/** Split "CHILE, PERU" / "A; B" into separate display tags. */
function expandTags(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    for (const part of item.split(/[,;]/)) {
      const tag = part.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

// Ticker · Exch · Company · Price · Chg$ · Chg% · Volume · Mkt Cap · Tags · Watch.
// Both class strings are written as full literals (no interpolation) so Tailwind's
// JIT scanner picks up the arbitrary grid-template tracks.
const GRID = "grid-cols-[64px_52px_minmax(120px,1.3fr)_80px_84px_72px_78px_90px_minmax(110px,1fr)_44px]";
const COL = "grid grid-cols-1 md:grid-cols-[64px_52px_minmax(120px,1.3fr)_80px_84px_72px_78px_90px_minmax(110px,1fr)_44px]";

const Companies = () => {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("search") || "");
  const [sel, setSel] = useState<Selected>(() => ({
    market: searchParams.get("market") || null,
    commodity: searchParams.get("commodity") || null,
    continent: searchParams.get("continent") || null,
    country: searchParams.get("country") || null,
  }));

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: filterOptions } = useQuery({
    queryKey: ["company-filters"],
    queryFn: fetchCompanyFilters,
    staleTime: 5 * 60 * 1000,
  });

  const parsedSearch = useMemo(() => parseCompanySearchQuery(debouncedSearch), [debouncedSearch]);

  const parsedFilterLabels = useMemo(() => {
    if (!parsedSearch.parsed) return [];
    const labels: string[] = [];
    const market = parsedExchangeToMarket(parsedSearch.exchange);
    if (market) labels.push(market);
    if (parsedSearch.commodity) labels.push(parsedSearch.commodity);
    if (parsedSearch.continent) labels.push(parsedSearch.continent);
    if (parsedSearch.country) labels.push(parsedSearch.country);
    if (parsedSearch.textSearch) labels.push(`"${parsedSearch.textSearch}"`);
    return labels;
  }, [parsedSearch]);

  const apiExchange = useMemo(() => {
    if (!sel.market) return undefined;
    return sel.market === "TSX-V" ? "TSXV" : sel.market;
  }, [sel.market]);

  const { data, isLoading } = useQuery({
    queryKey: ["companies", page, debouncedSearch, sel],
    queryFn: () =>
      fetchCompanies({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        exchange: apiExchange,
        commodity: sel.commodity || undefined,
        continent: sel.continent || undefined,
        country: sel.country || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const companies = data?.data ?? [];
  const pagination = data?.pagination;

  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  const goToPage = (next: number) => {
    const upper = pagination?.totalPages;
    const clamped = upper ? Math.min(Math.max(1, next), upper) : Math.max(1, next);
    if (clamped === page) return;
    setPage(clamped);
    scrollToTop();
  };

  const toggle = (key: keyof Selected, value: string) => {
    setPage(1);
    setSel((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
    scrollToTop();
  };

  const clearAll = () => {
    setSel(EMPTY);
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
    scrollToTop();
  };

  const hasActive = Object.values(sel).some(Boolean) || debouncedSearch.length > 0;
  const shown = pagination ? Math.min(pagination.page * pagination.limit, pagination.total) : companies.length;

  return (
    <SiteLayout morningBrief className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Hero */}
      <section className="border-b border-border bg-card">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-8">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Database</div>
              <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">Companies</h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                Search and filter junior miners across TSX-V, CSE, ASX and TSX. Ask in plain English or filter manually.
              </p>
            </div>
            <div className="text-sm text-muted-foreground font-mono">
              <span className="text-foreground font-bold">{shown}</span> of {pagination?.total ?? shown} companies
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setDebouncedSearch(search.trim());
              setPage(1);
              scrollToTop();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Try: "gold companies in Africa" or "lithium on ASX"'
                className="pl-10 pr-10 h-12 text-base bg-background rounded-none border-foreground/20 focus-visible:ring-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <Button type="submit" className="h-12 px-6 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 font-semibold">
              <Search className="w-4 h-4 mr-2" /> Search
            </Button>
          </form>
          {parsedFilterLabels.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Filtering by{" "}
              <span className="font-mono text-foreground">{parsedFilterLabels.join(" · ")}</span>
            </p>
          )}
        </div>
      </section>

      <main className="max-w-[1440px] mx-auto w-full px-6 lg:px-10 py-8 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Filter sidebar */}
        <aside>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4" />
              <h3 className="font-display font-bold text-lg">Filters</h3>
            </div>
            {hasActive && (
              <button
                onClick={clearAll}
                className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          <FilterGroup title="Market" options={filterOptions?.markets ?? []} value={sel.market} onToggle={(v) => toggle("market", v)} />
          <FilterGroup title="Commodity" options={filterOptions?.commodities ?? []} value={sel.commodity} onToggle={(v) => toggle("commodity", v)} />
          <FilterGroup title="Continent" options={filterOptions?.continents ?? []} value={sel.continent} onToggle={(v) => toggle("continent", v)} />
          <FilterGroup title="Country of Operations" options={filterOptions?.countries ?? []} value={sel.country} onToggle={(v) => toggle("country", v)} />
        </aside>

        {/* Table */}
        <section className="min-w-0">
          <div className="border border-border bg-card">
            <div className={`hidden md:grid ${GRID} gap-3 px-4 py-3 border-b border-border bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground`}>
              <div>Ticker</div>
              <div>Exch</div>
              <div>Company</div>
              <div className="text-right">Price</div>
              <div className="text-right">Chg $</div>
              <div className="text-right">Chg %</div>
              <div className="text-right">Volume</div>
              <div className="text-right">Mkt Cap</div>
              <div>Tags</div>
              <div className="text-center">Watch</div>
            </div>

            {isLoading ? (
              <div className="py-16 text-center text-muted-foreground text-sm">Loading companies...</div>
            ) : companies.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                No companies match your filters. Try clearing some.
              </div>
            ) : (
              companies.map((c) => <CompanyRow key={c.id} c={c} />)
            )}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <ListingPagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              onPageChange={goToPage}
              className="mt-6 border border-border"
            />
          )}
        </section>
      </main>
    </SiteLayout>
  );
};

interface FilterGroupProps {
  title: string;
  options: string[];
  value: string | null;
  onToggle: (v: string) => void;
}

const FilterGroup = ({ title, options, value, onToggle }: FilterGroupProps) => (
  <div className="border-t border-border py-4">
    <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">{title}</h4>
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            onClick={() => onToggle(o)}
            className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-foreground/80 border-border hover:border-foreground/40"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  </div>
);

// Watchlist star - toggles without navigating the row's parent Link. Unauthed
// clicks bounce to the register page (matches the rest of the site's gating).
const WatchStar = ({ companyId }: { companyId: number }) => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (isAuthenticated && companyId) {
      checkWatchlist("company", String(companyId)).then((w) => active && setWatched(w));
    } else {
      setWatched(false);
    }
    return () => { active = false; };
  }, [isAuthenticated, companyId]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!isAuthenticated) {
      navigate("/register");
      return;
    }
    setBusy(true);
    try {
      if (watched) {
        await removeFromWatchlist("company", String(companyId));
        setWatched(false);
      } else {
        await addToWatchlist("company", String(companyId), companyId);
        setWatched(true);
      }
    } catch {
      /* skip */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      className="inline-grid place-items-center w-7 h-7 border border-border rounded-sm hover:border-foreground/40 transition-colors"
    >
      <Star className={`w-3.5 h-3.5 ${watched ? "fill-[hsl(var(--watch))] text-[hsl(var(--watch))]" : "text-muted-foreground"}`} />
    </button>
  );
};

const CompanyRow = ({ c }: { c: Company }) => {
  const exForTv = c.exchange === "TSXV" ? "TSXV" : c.exchange;
  const enabled = !!(exForTv && c.ticker);
  const { data: quote } = useQuery({
    queryKey: ["company-row-quote", exForTv, c.ticker],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/market/quote/${exForTv}/${c.ticker}`);
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
  const exLabel = c.exchange === "TSXV" ? "TSX-V" : c.exchange;
  const commodityTags = expandTags(c.commodities ?? []).slice(0, 3);
  const geoTags = expandTags(
    [c.country, ...(c.continents ?? [])].filter(Boolean) as string[],
  ).slice(0, 4);
  const moveColor =
    change == null ? "text-muted-foreground" : up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]";

  return (
    <Link
      to={`/company/${companySlug(c.exchange, c.ticker)}`}
      className={`group ${COL} gap-y-1 gap-x-3 px-4 py-3.5 border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors items-center`}
    >
      {/* Ticker */}
      <span className="font-mono font-bold text-sm group-hover:underline">{c.ticker || "-"}</span>

      {/* Exch */}
      <span className="font-mono text-[10px] text-muted-foreground uppercase">{exLabel || "-"}</span>

      {/* Company */}
      <div className="min-w-0">
        <div className="font-display font-bold text-base truncate">{c.name}</div>
      </div>

      {/* Price */}
      <span className="md:text-right font-mono text-sm font-semibold">{fmtPrice(price)}</span>

      {/* Chg $ */}
      <span className={`md:text-right font-mono text-sm font-semibold ${moveColor}`}>
        {fmtChgAbs(changeAbs, price)}
      </span>

      {/* Chg % */}
      <span className={`md:text-right font-mono text-sm font-semibold inline-flex md:justify-end items-center gap-0.5 ${moveColor}`}>
        {change == null ? (
          "-"
        ) : (
          <>
            {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {fmtPct(change)}
          </>
        )}
      </span>

      {/* Volume */}
      <span className="md:text-right font-mono text-sm text-muted-foreground">{fmtVol(volume)}</span>

      {/* Mkt Cap */}
      <span className="md:text-right font-mono text-sm font-semibold">{fmtMcap(c.market_cap)}</span>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {commodityTags.length === 0 && geoTags.length === 0 ? (
          <span className="text-muted-foreground text-xs">-</span>
        ) : (
          <>
            {commodityTags.map((cm) => (
              <span key={`c-${cm}`} className="text-[10px] font-mono uppercase bg-muted px-1.5 py-0.5 rounded-sm">
                {cm}
              </span>
            ))}
            {geoTags.map((g) => (
              <span key={`g-${g}`} className="text-[10px] font-mono uppercase border border-border text-muted-foreground px-1.5 py-0.5 rounded-sm">
                {g}
              </span>
            ))}
          </>
        )}
      </div>

      {/* Watch */}
      <div className="md:text-center">
        <WatchStar companyId={c.id} />
      </div>
    </Link>
  );
};

export default Companies;
