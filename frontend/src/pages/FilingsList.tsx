import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock, FileText, Sparkles, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import ListingSearch from "@/components/site/ListingSearch";
import { fetchFilingsPage, type Filing, type Verdict } from "@/lib/api";

const VERDICTS = ["All", "Noteworthy", "Watch", "Routine"] as const;
const EXCHANGES = ["All", "TSX", "TSX-V", "CSE", "ASX"] as const;
const COMMODITIES = ["All", "Gold", "Silver", "Copper", "Lithium", "Uranium", "Nickel"] as const;

type VerdictFilter = (typeof VERDICTS)[number];

const PAGE_SIZE = 10;

const verdictStyle: Record<Verdict, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-full border transition-colors ${
        active
          ? "bg-foreground text-background border-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const FilingsList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") || "");

  const companyId = parseInt(searchParams.get("companyId") || "", 10) || undefined;
  const companyLabel = searchParams.get("companyLabel") || "";
  const verdict = (searchParams.get("verdict") || "All") as VerdictFilter;
  const exchange = searchParams.get("exchange") || "All";
  const commodity = searchParams.get("commodity") || "All";
  const search = searchParams.get("search") || "";

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const setFilter = (key: string, value: string | null) => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (!value || value === "All") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const clearCompany = () => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    next.delete("companyId");
    next.delete("companyLabel");
    setSearchParams(next, { replace: true });
  };

  const applySearch = () => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    const q = searchInput.trim();
    if (q) next.set("search", q);
    else next.delete("search");
    setSearchParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["filings-list", page, verdict, companyId, exchange, commodity, search],
    queryFn: () =>
      fetchFilingsPage({
        page,
        limit: PAGE_SIZE,
        verdict,
        companyId,
        exchange,
        commodity,
        search: search || undefined,
      }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const items = data?.items || [];
  const totalPages = data?.pagination?.totalPages ?? 1;

  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  const goToPage = (next: number) => {
    const upper = data?.pagination?.totalPages;
    const clamped = upper ? Math.min(Math.max(1, next), upper) : Math.max(1, next);
    if (clamped === page) return;
    setPage(clamped);
    scrollToTop();
  };

  useEffect(() => {
    if (!data?.pagination) return;
    setPage((p) => Math.min(Math.max(1, p), data.pagination.totalPages));
  }, [data?.pagination?.totalPages, verdict, companyId, exchange, commodity, search]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Filing intelligence</div>
          <h1 className="font-display text-3xl lg:text-5xl font-extrabold tracking-tight mb-2">Filings</h1>
          <p className="text-sm text-foreground/70">
            {companyLabel
              ? `Filings for ${companyLabel}.`
              : "Every filing from SEDAR+, ASX Announcements and the CSE - summarized with a significance verdict."}
          </p>
        </div>

        <ListingSearch
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={applySearch}
          onCompanySelect={(id, label) => {
            setPage(1);
            const next = new URLSearchParams(searchParams);
            next.set("companyId", String(id));
            next.set("companyLabel", label);
            next.delete("search");
            setSearchParams(next, { replace: true });
            setSearchInput("");
          }}
        />

        {companyId && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Company</span>
            <button
              type="button"
              onClick={clearCompany}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 border border-border bg-muted/40 hover:bg-muted"
            >
              {companyLabel || `ID ${companyId}`}
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Verdict</span>
          {VERDICTS.map((f) => (
            <FilterChip key={f} active={verdict === f} onClick={() => setFilter("verdict", f === "All" ? null : f)}>
              {f}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Exchange</span>
          {EXCHANGES.map((ex) => (
            <FilterChip key={ex} active={exchange === ex} onClick={() => setFilter("exchange", ex === "All" ? null : ex)}>
              {ex}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-6">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Commodity</span>
          {COMMODITIES.map((c) => (
            <FilterChip key={c} active={commodity === c} onClick={() => setFilter("commodity", c === "All" ? null : c)}>
              {c}
            </FilterChip>
          ))}
        </div>

        <div className="border border-border bg-surface">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            <span className="font-display text-sm font-bold">All filings</span>
          </div>

          {isLoading ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">Loading filings...</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">No filings match these filters.</div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item: Filing) => {
                const listingBack =
                  companyId && companyLabel
                    ? {
                        from: `/filings?companyId=${companyId}&companyLabel=${encodeURIComponent(companyLabel)}`,
                        fromLabel: "Back to filings list",
                      }
                    : undefined;
                const detailState = listingBack;
                return (
                  <li key={item.id} className="hover:bg-background/60">
                    <Link to={`/filings/${item.id}`} state={detailState} className="block px-5 py-4">
                      <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                        <span className="font-mono text-[18px] font-extrabold tracking-tight leading-none">{item.ticker}</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
                          {item.exchange}
                        </span>
                        <span className="text-[15px] font-semibold leading-none truncate max-w-[45%]">{item.company}</span>
                        {item.verdict && (
                          <span className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictStyle[item.verdict]}`}>
                            {item.verdict}
                          </span>
                        )}
                        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
                          {item.filingType}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {item.time}
                        </span>
                      </div>
                      <p className="text-[13px] leading-snug text-foreground/85 pl-0.5">
                        <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
                        {item.summary}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {!isLoading && totalPages > 1 && (
            <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Page {page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default FilingsList;
