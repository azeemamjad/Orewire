import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock, FileText, Sparkles, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import SiteLayout from "@/layouts/SiteLayout";
import ListingPagination from "@/components/site/ListingPagination";
import {
  ListFilterHeader,
  ListFilterSidebar,
  ActiveChips,
  EMPTY_FILTERS,
  type ListFilters,
} from "@/components/site/ListFilterBar";
import { fetchFilingsPage, type Filing, type Verdict } from "@/lib/api";
import {
  apiCommodityFromFilters,
  apiExchangeFromFilters,
  apiVerdictFromFilters,
  matchesMultiFilters,
} from "@/lib/list-filter-api";

const PAGE_SIZE = 10;

const verdictStyle: Record<string, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
  "Extraction failed": "bg-muted text-muted-foreground",
  "Company mismatch": "bg-amber-500/15 text-amber-800 dark:text-amber-200",
};

const FilingsList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);

  const companyId = parseInt(searchParams.get("companyId") || "", 10) || undefined;
  const companyLabel = searchParams.get("companyLabel") || "";

  const apiVerdict = apiVerdictFromFilters(filters);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, filters, companyId]);

  const applySearch = () => {
    setAppliedSearch(query.trim());
    setPage(1);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const clearCompany = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("companyId");
    next.delete("companyLabel");
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["filings-list", page, apiVerdict, companyId, filters, appliedSearch],
    queryFn: () =>
      fetchFilingsPage({
        page,
        limit: PAGE_SIZE,
        verdict: apiVerdict ?? "All",
        companyId,
        exchange: apiExchangeFromFilters(filters),
        commodity: apiCommodityFromFilters(filters),
        search: appliedSearch || undefined,
      }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => {
    const raw = data?.items || [];
    if (filters.severities.length > 1 || filters.exchanges.length > 1 || filters.commodities.length > 1) {
      return raw.filter((item) =>
        matchesMultiFilters(filters, {
          exchange: item.exchange,
          commodity: item.commodity,
          text: `${item.company} ${item.summary} ${item.filingType}`,
          verdict: item.verdict,
        }),
      );
    }
    return raw;
  }, [data?.items, filters]);

  const total = data?.pagination?.total ?? 0;
  const totalPages = data?.pagination?.totalPages ?? 1;

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    setPage(clamped);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };

  const resetAll = () => {
    setFilters(EMPTY_FILTERS);
    setQuery("");
    setAppliedSearch("");
    setPage(1);
  };

  return (
    <SiteLayout className="min-h-screen flex flex-col bg-background">
      <ListFilterHeader
        eyebrow="Filings"
        title="All decoded filings"
        description={
          companyLabel
            ? `Filings for ${companyLabel}, distilled to what matters.`
            : "Every filing from SEDAR+, ASX Announcements and the CSE, distilled to what matters."
        }
        totalCount={total}
        resultCount={items.length}
        query={query}
        setQuery={setQuery}
        placeholder="Search filings by company, ticker or type"
        onSearch={applySearch}
      />
      <main className="flex-1">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-8 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          <ListFilterSidebar filters={filters} setFilters={setFilters} severityLabel="Significance" />
          <section>
            {companyId && (
              <div className="mb-4 flex items-center gap-2">
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
            <ActiveChips filters={filters} setFilters={setFilters} />
            {isLoading ? (
              <div className="border border-dashed border-border p-12 text-center text-muted-foreground">Loading filings…</div>
            ) : items.length === 0 ? (
              <div className="border border-dashed border-border p-12 text-center">
                <p className="text-muted-foreground">No filings match your filters.</p>
                <button type="button" onClick={resetAll} className="mt-3 text-sm underline">Reset</button>
              </div>
            ) : (
              <div className="border border-border bg-surface">
                <ul className="divide-y divide-border">
                  {items.map((item: Filing) => {
                    const listingBack =
                      companyId && companyLabel
                        ? {
                            from: `/filings?companyId=${companyId}&companyLabel=${encodeURIComponent(companyLabel)}`,
                            fromLabel: "Back to filings list",
                          }
                        : undefined;
                    return (
                      <li key={item.id} className="hover:bg-background/60">
                        <Link to={`/filings/${item.id}`} state={listingBack} className="block px-4 py-4">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="font-mono text-[13px] font-bold whitespace-nowrap">{item.ticker}</span>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5 whitespace-nowrap">
                              {item.exchange}
                            </span>
                            {item.verdict && (
                              <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold rounded-full whitespace-nowrap ${verdictStyle[item.verdict]}`}>
                                {item.verdict}
                              </span>
                            )}
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                              <Clock className="w-2.5 h-2.5" />
                              {item.time}
                            </span>
                          </div>
                          <div className="text-[13px] font-semibold text-foreground/90 mb-1 leading-snug">{item.company}</div>
                          <div className="inline-flex items-center gap-1 text-[13.5px] font-bold tracking-tight text-foreground leading-snug mb-1.5">
                            <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                            {item.filingType}
                          </div>
                          <p className="text-[12.5px] leading-relaxed text-foreground/70">
                            <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
                            {item.summary}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <ListingPagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  isFetching={isFetching}
                  onPageChange={goToPage}
                />
              </div>
            )}
          </section>
        </div>
      </main>
    </SiteLayout>
  );
};

export default FilingsList;
