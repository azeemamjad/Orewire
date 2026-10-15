import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import SiteLayout from "@/layouts/SiteLayout";
import FeedRow from "@/components/site/FeedRow";
import ListingPagination from "@/components/site/ListingPagination";
import {
  ListFilterHeader,
  ListFilterSidebar,
  ActiveChips,
  EMPTY_FILTERS,
  type ListFilters,
} from "@/components/site/ListFilterBar";
import { fetchFilingsPage, type Filing } from "@/lib/api";
import { useSeo, organizationLd, websiteLd, breadcrumbLd } from "@/lib/seo";
import {
  apiCommodityFromFilters,
  apiExchangeFromFilters,
  apiVerdictFromFilters,
  matchesMultiFilters,
} from "@/lib/list-filter-api";

const PAGE_SIZE = 10;

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

  // The static shell's canonical points at the homepage, so without this the SPA
  // claims every route is `/`. Crawlers are normally proxied to the rendered
  // HTML instead, but this closes the gap for any that reach the SPA, and keeps
  // the SPA's directive identical to the crawler renderer's.
  useSeo({
    title:
      page > 1
        ? `Decoded Mining Filings (page ${page}) | OreWire`
        : "Decoded Mining and Resource Filings | OreWire",
    description:
      "Browse mining and resource regulatory filings decoded and graded by OreWire, with plain-English summaries of what was filed.",
    canonicalPath: page > 1 ? `/filings?page=${page}` : "/filings",
    robots:
      page > 1
        ? "noindex, follow"
        : "index, follow, max-image-preview:large, max-snippet:-1",
    jsonLd: [
      organizationLd(),
      websiteLd(),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "Filings", path: "/filings" },
      ]),
    ],
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
        <div className="container-page section-y grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
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
              <div className="card-surface">
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
                      <FeedRow
                        key={item.id}
                        href={`/filings/${item.id}`}
                        linkState={listingBack}
                        ticker={item.ticker}
                        exchange={item.exchange}
                        verdict={item.verdict}
                        typeLabel={item.filingType}
                        time={item.time}
                        company={item.company}
                        summary={item.summary}
                      />
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
