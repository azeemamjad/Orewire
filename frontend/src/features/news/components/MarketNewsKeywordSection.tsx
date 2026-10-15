import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import FeedRow from "@/components/site/FeedRow";
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
      <div className="border-t border-border">
        {isLoading ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">Loading headlines…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">
            No recent headlines matched.{" "}
            <a href={rssUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              Open Google News RSS
            </a>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item: NewsItem) => (
              <FeedRow
                key={item.link || item.title}
                externalHref={item.link?.startsWith("http") ? item.link : rssUrl}
                company={item.title}
                time={item.timeAgo}
                category={item.commodity}
                source={item.source || "Google News"}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MarketNewsKeywordSection;
