import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Newspaper } from "lucide-react";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";

const PAGE_SIZE = 30;
const REFETCH_MS = 30 * 60 * 1000;

const placeholderNews: NewsItem[] = [
  { title: "Gold tops $2,420/oz as Fed signals slower rate path; miners rally", summary: "", source: "Reuters", link: "https://www.reuters.com/markets/commodities/", pubDate: "", timeAgo: "18m ago", commodity: "Gold", sentiment: "bullish" },
  { title: "Copper hits 10-week high on China stimulus, LME stocks slide", summary: "", source: "Bloomberg", link: "https://www.bloomberg.com/markets/commodities", pubDate: "", timeAgo: "42m ago", commodity: "Copper", sentiment: "bullish" },
  { title: "Uranium spot prices climb back above $92/lb as utilities return to market", summary: "", source: "Kitco", link: "https://www.kitco.com/news/", pubDate: "", timeAgo: "1h ago", commodity: "Uranium", sentiment: "bullish" },
  { title: "Lithium glut deepens — Pilbara Minerals warns of further price weakness", summary: "", source: "Mining.com", link: "https://www.mining.com/", pubDate: "", timeAgo: "2h ago", commodity: "Lithium", sentiment: "bearish" },
  { title: "Newmont raises 2026 guidance after record Q1 free cash flow", summary: "", source: "Northern Miner", link: "https://www.northernminer.com/", pubDate: "", timeAgo: "3h ago", commodity: "Gold", sentiment: "bullish" },
  { title: "BHP, Rio Tinto pause exploration in Pilbara on heritage review", summary: "", source: "AFR", link: "https://www.afr.com/companies/mining", pubDate: "", timeAgo: "4h ago", commodity: "Iron Ore", sentiment: "neutral" },
];

const NewsRow = ({ item }: { item: NewsItem }) => (
  <li>
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
        <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <span className="uppercase tracking-wider text-foreground/80">{item.source}</span>
          {item.timeAgo && (
            <>
              <span>·</span>
              <span>{item.timeAgo}</span>
            </>
          )}
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
);

const MarketNews = () => {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["market-news-feed", page, PAGE_SIZE],
    queryFn: () => fetchNewsFeed({ page, limit: PAGE_SIZE, origin: "google" }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = useMemo(
    () => (data?.items || []).slice().sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime()),
    [data?.items],
  );
  const totalPages = data?.pagination?.totalPages ?? 1;
  const showLoading = isLoading || (isFetching && items.length === 0);
  // Only fall back to the static teaser before the very first load resolves.
  const visible = !isLoading && items.length === 0 ? placeholderNews : items;

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
        <div className="max-w-[1100px] mx-auto px-4 lg:px-6 py-8 lg:py-10">
          <div className="mb-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 flex items-center gap-2">
              <Newspaper className="w-3 h-3 text-accent" /> Market news
            </div>
            <h1 className="font-display text-3xl lg:text-4xl font-extrabold tracking-tight">
              Global mining &amp; commodities news
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Headlines from Reuters, Bloomberg, Mining.com, Kitco and more. Click any item to read at the source.
            </p>
          </div>

          <div className="border border-border bg-surface">
            {showLoading ? (
              <div className="px-5 py-8 text-sm text-muted-foreground">Loading news...</div>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((item, i) => (
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
