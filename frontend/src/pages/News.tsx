import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Newspaper, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import ListingSearch from "@/components/site/ListingSearch";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { getNewsFilingType, getNewsSeverity, severityStyle } from "@/lib/news-severity";
import { newsDisplayTime } from "@/components/site/news-release-utils";

const EXCHANGES = ["All", "TSX", "TSX-V", "CSE", "ASX"] as const;
const SEVERITIES = ["All", "Critical", "High", "Medium", "Low"] as const;
const COMMODITIES = ["All", "Gold", "Silver", "Copper", "Lithium", "Uranium", "Nickel"] as const;

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

const News = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") || "");

  const companyId = parseInt(searchParams.get("companyId") || "", 10) || undefined;
  const companyLabel = searchParams.get("companyLabel") || "";
  const exchange = searchParams.get("exchange") || "All";
  const severity = searchParams.get("severity") || "All";
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

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["news-feed", page, PAGE_SIZE, companyId, exchange, severity, commodity, search],
    queryFn: () =>
      fetchNewsFeed({
        page,
        limit: PAGE_SIZE,
        origin: "rss",
        companyLinked: !companyId,
        companyId,
        exchange,
        severity,
        commodity,
        search: search || undefined,
      }),
    staleTime: 30 * 60 * 1000,
  });

  const pageItems = useMemo(
    () =>
      (data?.items || []).slice().sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime()),
    [data?.items],
  );
  const totalPages = data?.pagination?.totalPages ?? 1;
  const showLoading = isLoading || (isFetching && pageItems.length === 0);

  const goToPage = (next: number) => {
    const upper = data?.pagination?.totalPages;
    const clamped = upper ? Math.min(Math.max(1, next), upper) : Math.max(1, next);
    if (clamped === page) return;
    setPage(clamped);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Live feed</div>
          <h1 className="font-display text-3xl lg:text-5xl font-extrabold tracking-tight mb-2">News Releases</h1>
          <p className="text-sm text-foreground/70">
            {companyLabel
              ? `News releases for ${companyLabel}.`
              : "Latest mining and market releases with AI summaries."}
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
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Severity</span>
          {SEVERITIES.map((s) => (
            <FilterChip key={s} active={severity === s} onClick={() => setFilter("severity", s === "All" ? null : s)}>
              {s}
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
            <Newspaper className="w-4 h-4" />
            <span className="font-display text-sm font-bold">All News</span>
          </div>

          {showLoading ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">Loading news...</div>
          ) : pageItems.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">No news matches these filters.</div>
          ) : (
            <ul className="divide-y divide-border">
              {pageItems.map((item, i) => {
                const sev = getNewsSeverity(item.sentiment, item.title);
                const filingType = getNewsFilingType(item.title);
                const linkState =
                  companyId && companyLabel
                    ? { from: `/news?companyId=${companyId}&companyLabel=${encodeURIComponent(companyLabel)}`, fromLabel: "Back to news list" }
                    : undefined;
                return (
                  <li key={`${item.link}-${i}`} className="hover:bg-background/60">
                    <Link
                      to={`/news/${toNewsSlug(item)}`}
                      state={linkState}
                      className="block px-5 py-4"
                    >
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold ${severityStyle[sev]}`}>
                          {sev}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-border px-1 py-0.5">
                          {filingType}
                        </span>
                        {item.commodity && (
                          <span className="font-mono text-[9px] uppercase tracking-widest px-1 py-0.5 border border-border">
                            {item.commodity}
                          </span>
                        )}
                        {item.exchange && item.ticker && (
                          <span className="font-mono text-[9px] font-bold">{item.exchange}:{item.ticker}</span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {newsDisplayTime(item)}
                        </span>
                      </div>
                      <h2 className="font-display text-lg font-bold leading-tight mb-1">{item.title}</h2>
                      <p className="text-sm text-foreground/75 line-clamp-2 break-words">{cleanSummary(item.summary) || item.title}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {!showLoading && totalPages > 1 && (
            <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Page {page} of {totalPages}
                {isFetching ? " · loading…" : ""}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1 || isFetching}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages || isFetching}
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

export default News;
