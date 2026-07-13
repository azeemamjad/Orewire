import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, FileText, X } from "lucide-react";
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
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { getNewsFilingType, getNewsSeverity, severityStyle } from "@/lib/news-severity";
import { newsDisplayTime } from "@/components/site/news-release-utils";
import {
  apiCommodityFromFilters,
  apiExchangeFromFilters,
  apiSeverityFromFilters,
  matchesMultiFilters,
  newsSignificanceLabel,
} from "@/lib/list-filter-api";

const PAGE_SIZE = 10;

function toNewsSlug(item: NewsItem): string {
  return encodeURIComponent(item.link || item.title);
}

function cleanSummary(text: string | null | undefined): string {
  if (!text) return "";
  const decoded = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  return decoded.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const News = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);

  const companyId = parseInt(searchParams.get("companyId") || "", 10) || undefined;
  const companyLabel = searchParams.get("companyLabel") || "";

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
    queryKey: ["news-feed", page, PAGE_SIZE, companyId, filters, appliedSearch],
    queryFn: () =>
      fetchNewsFeed({
        page,
        limit: PAGE_SIZE,
        origin: "rss",
        companyLinked: !companyId,
        companyId,
        exchange: apiExchangeFromFilters(filters),
        severity: apiSeverityFromFilters(filters),
        commodity: apiCommodityFromFilters(filters),
        search: appliedSearch || undefined,
      }),
    staleTime: 30 * 60 * 1000,
  });

  const pageItems = useMemo(() => {
    const items = (data?.items || []).slice().sort(
      (a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime(),
    );
    if (filters.severities.length > 1 || filters.exchanges.length > 1 || filters.commodities.length > 1) {
      return items.filter((item) =>
        matchesMultiFilters(filters, {
          exchange: item.exchange,
          commodity: item.commodity,
          text: `${item.title} ${item.summary}`,
          significance: newsSignificanceLabel(item.sentiment, item.title),
        }),
      );
    }
    return items;
  }, [data?.items, filters]);

  const total = data?.pagination?.total ?? 0;
  const totalPages = data?.pagination?.totalPages ?? 1;
  const showLoading = isLoading || (isFetching && pageItems.length === 0);

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
        eyebrow="News releases"
        title="All news releases"
        description={
          companyLabel
            ? `Every release from ${companyLabel}, summarized in one line.`
            : "Every release from TSX-V, CSE, TSX and ASX miners, summarized in one line."
        }
        totalCount={total}
        resultCount={pageItems.length}
        query={query}
        setQuery={setQuery}
        placeholder='Search by company, ticker or keyword (e.g. "gold drill")'
        onSearch={applySearch}
      />
      <main className="flex-1">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-8 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          <ListFilterSidebar filters={filters} setFilters={setFilters} />
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
            {showLoading ? (
              <div className="border border-dashed border-border p-12 text-center text-muted-foreground">Loading releases…</div>
            ) : pageItems.length === 0 ? (
              <div className="border border-dashed border-border p-12 text-center">
                <p className="text-muted-foreground">No releases match your filters.</p>
                <button type="button" onClick={resetAll} className="mt-3 text-sm underline">Reset</button>
              </div>
            ) : (
              <div className="border border-border bg-surface">
                <ul className="divide-y divide-border">
                  {pageItems.map((item, i) => {
                    const sev = getNewsSeverity(item.sentiment, item.title);
                    const filingType = getNewsFilingType(item.title);
                    const linkState =
                      companyId && companyLabel
                        ? {
                            from: `/news?companyId=${companyId}&companyLabel=${encodeURIComponent(companyLabel)}`,
                            fromLabel: "Back to news list",
                          }
                        : undefined;
                    return (
                      <li key={`${item.link}-${i}`} className="hover:bg-background/60">
                        <Link to={`/news/${toNewsSlug(item)}`} state={linkState} className="block px-4 py-4">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            {item.ticker && (
                              <span className="font-mono text-[13px] font-bold whitespace-nowrap">{item.ticker}</span>
                            )}
                            {item.exchange && (
                              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5 whitespace-nowrap">
                                {item.exchange}
                              </span>
                            )}
                            <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold whitespace-nowrap ${severityStyle[sev]}`}>
                              {newsSignificanceLabel(item.sentiment, item.title)}
                            </span>
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                              <Clock className="w-2.5 h-2.5" />
                              {newsDisplayTime(item)}
                            </span>
                          </div>
                          <div className="text-[13px] font-semibold text-foreground/90 mb-1 leading-snug truncate">{item.company || " "}</div>
                          <div className="flex items-center gap-1 text-[13.5px] font-bold tracking-tight text-foreground leading-snug mb-1.5 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                            <span className="truncate">{item.title}</span>
                          </div>
                          <p className="text-[12.5px] leading-relaxed text-foreground/70 line-clamp-2 min-h-[2.6rem]">
                            {cleanSummary(item.summary) || item.title}
                          </p>
                          <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{filingType}</span>
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

export default News;
