import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import CommodityBar from "@/components/site/CommodityBar";
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

const COMMODITY_COLOR: Record<string, string> = {
  Gold:        "bg-amber-100 text-amber-800 border-amber-200",
  Silver:      "bg-slate-100 text-slate-700 border-slate-200",
  Copper:      "bg-orange-100 text-orange-800 border-orange-200",
  Lithium:     "bg-emerald-100 text-emerald-800 border-emerald-200",
  Nickel:      "bg-zinc-100 text-zinc-700 border-zinc-200",
  Uranium:     "bg-lime-100 text-lime-800 border-lime-200",
  Zinc:        "bg-sky-100 text-sky-800 border-sky-200",
  Cobalt:      "bg-blue-100 text-blue-800 border-blue-200",
  "Rare Earths": "bg-rose-100 text-rose-800 border-rose-200",
};

const STATUS_COLOR: Record<string, string> = {
  Trading:  "bg-emerald-100 text-emerald-800 border-emerald-200",
  Halted:   "bg-red-100 text-red-700 border-red-200",
  Upcoming: "bg-amber-100 text-amber-800 border-amber-200",
  Delisted: "bg-zinc-100 text-zinc-600 border-zinc-200",
  Listed:   "bg-zinc-100 text-zinc-600 border-zinc-200",
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

const Companies = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sel, setSel] = useState<Selected>(EMPTY);

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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />
      <MarketStrip />
      <CommodityBar />

      <section className="border-b border-border bg-background">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-8 lg:py-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Database
          </div>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-4xl lg:text-5xl font-extrabold leading-tight mb-2">
                Companies
              </h1>
              <p className="text-sm text-foreground/70 max-w-xl">
                Search and filter junior miners across TSX-V, CSE, ASX and TSX. Ask in plain English or filter manually.
              </p>
            </div>
            {pagination && (
              <div className="font-mono text-[11px] text-muted-foreground">
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} companies
              </div>
            )}
          </div>

          {/* AI-style search */}
          <div className="mt-6 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Try: "gold companies in Africa" or "lithium on ASX"`}
                className="w-full h-12 pl-12 pr-4 bg-surface border border-border text-sm outline-none focus:border-accent"
              />
            </div>
            <button
              className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-12 text-sm font-semibold hover:opacity-90 transition-opacity"
              onClick={() => setDebouncedSearch(search.trim())}
            >
              <Search className="w-4 h-4" /> Search
            </button>
          </div>
        </div>
      </section>

      <main className="flex-1 bg-surface/30">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-8 grid lg:grid-cols-[260px_1fr] gap-6">
          {/* Filter sidebar */}
          <aside className="space-y-6 self-start lg:sticky lg:top-20">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-extrabold tracking-tight">Filters</h3>
              {hasActive && (
                <button
                  onClick={clearAll}
                  className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            <FilterGroup
              title="Market"
              options={filterOptions?.markets ?? []}
              value={sel.market}
              onToggle={(v) => toggle("market", v)}
            />
            <FilterGroup
              title="Commodity"
              options={filterOptions?.commodities ?? []}
              value={sel.commodity}
              onToggle={(v) => toggle("commodity", v)}
            />
            <FilterGroup
              title="Continent"
              options={filterOptions?.continents ?? []}
              value={sel.continent}
              onToggle={(v) => toggle("continent", v)}
            />
            <FilterGroup
              title="Country of Operations"
              options={filterOptions?.countries ?? []}
              value={sel.country}
              onToggle={(v) => toggle("country", v)}
            />
            <FilterGroup
              title="Status"
              options={filterOptions?.statuses ?? []}
              value={sel.status}
              onToggle={(v) => toggle("status", v)}
            />
          </aside>

          {/* Table */}
          <div className="min-w-0">
            <div className="bg-surface border border-border overflow-hidden">
              {/* Header row */}
              <div className="grid grid-cols-[110px_1fr_220px_120px_100px_40px] items-center gap-3 px-5 py-3 border-b border-border bg-background/60 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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
                companies.map((c) => (
                  <CompanyRow key={c.id} c={c} onOpen={() => navigate(`/company/${companySlug(c.exchange, c.ticker)}`)} />
                ))
              )}
            </div>

            {/* Pagination */}
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
          </div>
        </div>
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
  <div>
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            onClick={() => onToggle(o)}
            className={`px-2.5 py-1 text-[11px] border rounded-sm transition-colors ${
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-surface text-foreground/80 border-border hover:border-accent"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  </div>
);

interface RowProps {
  c: Company;
  onOpen: () => void;
}

const CompanyRow = ({ c, onOpen }: RowProps) => {
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

  return (
    <div
      className="grid grid-cols-[110px_1fr_220px_120px_100px_40px] items-center gap-3 px-5 py-3.5 border-b border-border last:border-b-0 hover:bg-background/40 transition-colors cursor-pointer"
      onClick={onOpen}
    >
      <div>
        <div className="font-mono font-bold text-sm">{c.ticker || "—"}</div>
        {exLabel && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{exLabel}</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-display text-[14px] font-semibold truncate">{c.name}</span>
          {status && (
            <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border ${STATUS_COLOR[status] || STATUS_COLOR.Listed}`}>
              {status}
            </span>
          )}
        </div>
        {c.country && (
          <div className="text-[11px] text-muted-foreground truncate">{c.country}</div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {(c.commodities ?? []).slice(0, 4).map((cm) => (
          <span
            key={cm}
            className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ${COMMODITY_COLOR[cm] || "bg-zinc-100 text-zinc-700 border-zinc-200"}`}
          >
            {cm}
          </span>
        ))}
        {(c.commodities?.length ?? 0) === 0 && <span className="text-muted-foreground text-xs">—</span>}
      </div>

      <div className="text-right font-mono text-sm">{fmtMcap(c.market_cap)}</div>

      <div className="text-right">
        {change == null ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <span className={`font-mono text-sm inline-flex items-center justify-end gap-0.5 ${up ? "text-emerald-600" : "text-red-600"}`}>
            {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {fmtPct(change)}
          </span>
        )}
      </div>

      <div className="flex justify-end">
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </div>
  );
};

export default Companies;
