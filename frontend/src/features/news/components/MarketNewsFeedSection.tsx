import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Newspaper } from "lucide-react";
import FeedRow from "@/components/site/FeedRow";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { googleNewsRssUrl } from "@/components/site/MarketNewsKeywordSection";

const REFETCH_MS = 30 * 60 * 1000;

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <FeedRow
      externalHref={item.link?.startsWith("http") ? item.link : "#"}
      company={item.title}
      time={item.timeAgo}
      category={item.commodity}
      source={item.source || "Google News"}
    />
  );
}

export default function MarketNewsFeedSection({
  keyword,
  title,
}: {
  keyword: string;
  title: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["market-news-feed", keyword],
    queryFn: () =>
      fetchNewsFeed({
        page: 1,
        limit: 8,
        origin: "google",
        search: keyword,
      }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data?.items ?? [];

  return (
    <section className="mt-10">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4 border-b border-border pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-2">
            <Newspaper className="w-3 h-3 text-accent" />
            Market news
          </div>
          <h2 className="font-display text-2xl tracking-tight leading-none">{title}</h2>
        </div>
        <Link
          to="/market-news"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          View all <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="card-surface">
        {isLoading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading headlines…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No recent headlines matched.{" "}
            <a
              href={googleNewsRssUrl(keyword)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Open Google News RSS
            </a>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <NewsRow key={item.link || item.title} item={item} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
