import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronLeft, ChevronRight, Filter, Search, Sparkles, X } from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import MorningBrief from "@/components/site/MorningBrief";
import Footer from "@/components/site/Footer";
import {
  fetchCompanies,
  fetchCompanyFilters,
  companySlug,
  type Company,
} from "@/lib/api";

type Selected = {
  market: string | null;
  commodity: string | null;
  continent: string | null;
  country: string | null;
  status: string | null;
};

const EMPTY: Selected = {
  market: null,
  commodity: null,
  continent: null,
  country: null,
  status: null,
};

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

// Status badges use theme verdict tokens (matches the rest of the site).
const STATUS_COLOR: Record<string, string> = {
  Trading:  "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Halted:   "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Upcoming: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Delisted: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
  Listed:   "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

function fmtMcap(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const COL = "grid grid-cols-1 md:grid-cols-[110px_1fr_140px_120px_120px_40px]";

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
    status: searchParams.get("status") || null,
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
        status: sel.status || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const companies = data?.data ?? [];
  const pagination = data?.pagination;

  const toggle = (key: keyof Selected, value: string) => {
    setPage(1);
    setSel((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }));
  };

  const clearAll = () => {
    setSel(EMPTY);
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  };

  const hasActive = Object.values(sel).some(Boolean) || debouncedSearch.length > 0;
  const shown = pagination ? Math.min(pagination.page * pagination.limit, pagination.total) : companies.length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />
      <MarketStrip />
      <MorningBrief />

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
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setDebouncedSearch(search.trim());
              setPage(1);
            }}
          >
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Try: "gold companies in Africa" or "lithium on ASX"`}
                className="w-full pl-10 pr-10 h-12 text-base bg-background border border-foreground/20 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 h-12 px-6 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold text-sm transition-colors"
            >
              <Search className="w-4 h-4" /> Search
            </button>
          </form>
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
          <FilterGroup title="Status" options={filterOptions?.statuses ?? []} value={sel.status} onToggle={(v) => toggle("status", v)} />
        </aside>

        {/* Table */}
        <section className="min-w-0">
          <div className="border border-border bg-card">
            <div className={`hidden md:grid grid-cols-[110px_1fr_140px_120px_120px_40px] gap-4 px-4 py-3 border-b border-border bg-muted/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground`}>
              <div>Ticker</div>
              <div>Company</div>
              <div>Commodities</div>
              <div className="text-right">Market Cap</div>
              <div className="text-right">Change</div>
              <div />
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
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!pagination.hasPrev}
                className="p-2 border border-border disabled:opacity-30 hover:border-accent transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-mono px-3">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!pagination.hasNext}
                className="p-2 border border-border disabled:opacity-30 hover:border-accent transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
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

const CompanyRow = ({ c }: { c: Company }) => {
  const exForTv = c.exchange === "TSXV" ? "TSXV" : c.exchange;
  const enabled = !!(exForTv && c.ticker);
  const { data: quote } = useQuery({
    queryKey: ["company-row-quote", exForTv, c.ticker],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/market/quote/${exForTv}/${c.ticker}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ price: number | null; change_pct: number | null }>;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const change = quote?.change_pct ?? null;
  const up = change != null && change >= 0;
  const exLabel = c.exchange === "TSXV" ? "TSX-V" : c.exchange;
  const status = c.status || "Listed";
  const commodities = c.commodities ?? [];

  return (
    <Link
      to={`/company/${companySlug(c.exchange, c.ticker)}`}
      className={`group ${COL} gap-2 md:gap-4 px-4 py-4 border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors items-center`}
    >
      <div className="flex flex-col">
        <span className="font-mono font-bold text-sm">{c.ticker || "—"}</span>
        {exLabel && <span className="font-mono text-[10px] text-muted-foreground">{exLabel}</span>}
      </div>

      <div className="min-w-0">
        <div className="font-display font-bold text-base truncate">{c.name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_COLOR[status] || STATUS_COLOR.Listed}`}>
            {status}
          </span>
          {c.country && <span>{c.country}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {commodities.length === 0 ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          commodities.slice(0, 4).map((cm) => (
            <span key={cm} className="text-[10px] font-mono uppercase border border-border px-1.5 py-0.5">
              {cm}
            </span>
          ))
        )}
      </div>

      <div className="md:text-right font-mono text-sm font-semibold">{fmtMcap(c.market_cap)}</div>

      <div
        className={`md:text-right font-mono text-sm font-semibold inline-flex md:justify-end items-center gap-1 ${
          change == null ? "text-muted-foreground" : up ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"
        }`}
      >
        {change == null ? "—" : (
          <>
            {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {fmtPct(change)}
          </>
        )}
      </div>

      <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground hidden md:block" />
    </Link>
  );
};

export default Companies;
