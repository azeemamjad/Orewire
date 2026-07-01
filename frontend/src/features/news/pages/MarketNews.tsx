import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
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
import { googleNewsRssUrl } from "@/components/site/MarketNewsKeywordSection";
import { newsDisplayTime } from "@/components/site/news-release-utils";
import { apiCommodityFromFilters, matchesMultiFilters } from "@/lib/list-filter-api";

const PAGE_SIZE = 10;
const REFETCH_MS = 30 * 60 * 1000;

const MarketNewsPage = () => {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, filters]);

  const applySearch = () => {
    setAppliedSearch(query.trim());
    setPage(1);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["market-news-feed", page, PAGE_SIZE, filters, appliedSearch],
    queryFn: () =>
      fetchNewsFeed({
        page,
        limit: PAGE_SIZE,
        origin: "google",
        commodity: apiCommodityFromFilters(filters),
        search: appliedSearch || undefined,
      }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = useMemo(() => {
    const raw = (data?.items || []).slice().sort(
      (a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime(),
    );
    if (filters.commodities.length > 1) {
      return raw.filter((item) =>
        matchesMultiFilters(filters, {
          commodity: item.commodity,
          text: `${item.title} ${item.summary}`,
        }),
      );
    }
    return raw;
  }, [data?.items, filters]);

  const total = data?.pagination?.total ?? 0;
  const totalPages = data?.pagination?.totalPages ?? 1;
  const showLoading = isLoading || (isFetching && items.length === 0);

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
        eyebrow="Market news"
        title="Global mining and commodity news"
        description="Headlines sourced via Google News RSS. Each item opens at the original publisher."
        totalCount={total}
        resultCount={items.length}
        query={query}
        setQuery={setQuery}
        placeholder="Search headlines or commodities"
        onSearch={applySearch}
      />
      <main className="flex-1">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-8 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          <ListFilterSidebar
            filters={filters}
            setFilters={setFilters}
            showSeverity={false}
            showExchange={false}
          />
          <section>
            {appliedSearch && (
              <a
                href={googleNewsRssUrl(appliedSearch)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground mb-4"
              >
                Open Google News RSS for &ldquo;{appliedSearch}&rdquo; <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <ActiveChips filters={filters} setFilters={setFilters} />
            {showLoading ? (
              <div className="border border-dashed border-border p-12 text-center text-muted-foreground">Loading headlines…</div>
            ) : items.length === 0 ? (
              <div className="border border-dashed border-border p-12 text-center">
                <p className="text-muted-foreground">No headlines match your filters.</p>
                <button type="button" onClick={resetAll} className="mt-3 text-sm underline">Reset</button>
              </div>
            ) : (
              <div className="border border-border bg-surface">
                <ul className="divide-y divide-border">
                  {items.map((item: NewsItem, i) => (
                    <li key={`${item.link}-${i}`}>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-3 px-4 py-4 hover:bg-background/60 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-accent transition-colors">
                            {item.title}
                          </div>
                          {item.summary && (
                            <p className="mt-1 text-sm text-foreground/75 line-clamp-2">{item.summary}</p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] font-mono text-muted-foreground">
                            <span className="uppercase tracking-wider text-foreground/80">{item.source}</span>
                            <span>·</span>
                            <span>{newsDisplayTime(item)}</span>
                            {item.commodity && (
                              <>
                                <span>·</span>
                                <span className="uppercase tracking-wider">{item.commodity}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-accent shrink-0 mt-1" />
                      </a>
                    </li>
                  ))}
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

export default MarketNewsPage;
