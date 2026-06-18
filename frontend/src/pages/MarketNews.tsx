import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, ExternalLink, Newspaper, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import ListingSearch from "@/components/site/ListingSearch";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { newsDisplayTime } from "@/components/site/news-release-utils";

const EXCHANGES = ["All", "TSX", "TSX-V", "CSE", "ASX"] as const;
const SENTIMENTS = ["All", "Bullish", "Bearish", "Neutral"] as const;
const COMMODITIES = ["All", "Gold", "Silver", "Copper", "Lithium", "Uranium", "Nickel"] as const;
const SEVERITIES = ["All", "Critical", "High", "Medium", "Low"] as const;

const PAGE_SIZE = 10;
const REFETCH_MS = 30 * 60 * 1000;

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

const sentimentLabel: Record<string, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const NewsRow = ({ item }: { item: NewsItem }) => (
  <li>
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 px-5 py-4 hover:bg-background/60 transition-colors"
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
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {newsDisplayTime(item)}
          </span>
          {item.commodity && (
            <>
              <span>·</span>
              <span className="uppercase tracking-wider">{item.commodity}</span>
            </>
          )}
          {item.sentiment && (
            <>
              <span>·</span>
              <span className="uppercase tracking-wider">{sentimentLabel[item.sentiment] || item.sentiment}</span>
            </>
          )}
          {item.exchange && item.ticker && (
            <>
              <span>·</span>
              <span className="font-bold">{item.exchange}:{item.ticker}</span>
            </>
          )}
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-accent shrink-0 mt-1" />
    </a>
  </li>
);

const MarketNews = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") || "");

  const companyId = parseInt(searchParams.get("companyId") || "", 10) || undefined;
  const companyLabel = searchParams.get("companyLabel") || "";
  const exchange = searchParams.get("exchange") || "All";
  const sentiment = searchParams.get("sentiment") || "All";
  const commodity = searchParams.get("commodity") || "All";
  const severity = searchParams.get("severity") || "All";
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

  const sentimentApi =
    sentiment === "Bullish"
      ? "bullish"
      : sentiment === "Bearish"
        ? "bearish"
        : sentiment === "Neutral"
          ? "neutral"
          : undefined;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["market-news-feed", page, PAGE_SIZE, companyId, exchange, sentiment, commodity, severity, search],
    queryFn: () =>
      fetchNewsFeed({
        page,
        limit: PAGE_SIZE,
        origin: "google",
        companyId,
        exchange,
        commodity,
        severity,
        sentiment: sentimentApi,
        search: search || undefined,
      }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = useMemo(
    () =>
      (data?.items || []).slice().sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime()),
    [data?.items],
  );
  const totalPages = data?.pagination?.totalPages ?? 1;
  const showLoading = isLoading || (isFetching && items.length === 0);

  const goToPage = (next: number) => {
    const upper = data?.pagination?.totalPages;
    const clamped = upper ? Math.min(Math.max(1, next), upper) : Math.max(1, next);
    if (clamped === page) return;
    setPage(clamped);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Nav />
      <main className="flex-1">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 flex items-center gap-2">
              <Newspaper className="w-3 h-3 text-accent" />
              Market news
            </div>
            <h1 className="font-display text-3xl lg:text-5xl font-extrabold tracking-tight">
              Global mining &amp; commodities news
            </h1>
            <p className="text-sm text-foreground/70 mt-2">
              {companyLabel
                ? `Market headlines related to ${companyLabel}.`
                : "Headlines from Reuters, Bloomberg, Mining.com, Kitco and more. Click any item to read at the source."}
            </p>
          </div>

          <ListingSearch
            value={searchInput}
            onChange={setSearchInput}
            onSubmit={applySearch}
            placeholder='Search headlines, e.g. "gold price" or "copper China"'
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
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Exchange</span>
            {EXCHANGES.map((ex) => (
              <FilterChip key={ex} active={exchange === ex} onClick={() => setFilter("exchange", ex === "All" ? null : ex)}>
                {ex}
              </FilterChip>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Sentiment</span>
            {SENTIMENTS.map((s) => (
              <FilterChip key={s} active={sentiment === s} onClick={() => setFilter("sentiment", s === "All" ? null : s)}>
                {s}
              </FilterChip>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground py-1 mr-1">Severity</span>
            {SEVERITIES.map((s) => (
              <FilterChip key={s} active={severity === s} onClick={() => setFilter("severity", s === "All" ? null : s)}>
                {s}
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
              <span className="font-display text-sm font-bold">All market news</span>
            </div>

            {showLoading ? (
              <div className="px-5 py-8 text-sm text-muted-foreground">Loading news...</div>
            ) : items.length === 0 ? (
              <div className="px-5 py-8 text-sm text-muted-foreground">No headlines match these filters.</div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item, i) => (
                  <NewsRow key={`${item.link}-${i}`} item={item} />
                ))}
              </ul>
            )}
          </div>

          {!showLoading && totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
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

export default MarketNews;
