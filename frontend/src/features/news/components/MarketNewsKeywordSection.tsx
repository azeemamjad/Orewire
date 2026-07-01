import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000;

export function googleNewsRssUrl(keyword: string): string {
  const q = encodeURIComponent(`${keyword.trim()} mining`);
  return `https://news.google.com/rss/search?q=${q}&hl=en&gl=US&ceid=US:en`;
}

function MarketNewsKeywordSection({ keyword, title = "Market news" }: { keyword: string; title?: string }) {
  const rssUrl = googleNewsRssUrl(keyword);

  const { data, isLoading } = useQuery({
    queryKey: ["market-news-keyword", keyword],
    queryFn: () =>
      fetchNewsFeed({
        page: 1,
        limit: 6,
        origin: "google",
        search: keyword,
      }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data?.items ?? [];

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3 p-6 pb-3 flex-wrap">
        <h3 className="font-semibold font-display text-base uppercase tracking-wider">{title}</h3>
        <a
          href={rssUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Google News RSS <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <div className="px-6 pb-6 pt-0 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading headlines…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent headlines matched.{" "}
            <a href={rssUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              Open Google News RSS
            </a>
          </p>
        ) : (
          items.map((item: NewsItem) => (
            <a
              key={item.link || item.title}
              href={item.link?.startsWith("http") ? item.link : rssUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block group border-b border-border last:border-0 pb-3 last:pb-0"
            >
              <div className="font-medium text-sm leading-snug group-hover:underline underline-offset-2">{item.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                <span>{item.source || "Google News"}</span>
                {item.timeAgo && <span>· {item.timeAgo}</span>}
                <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
}

export default MarketNewsKeywordSection;
