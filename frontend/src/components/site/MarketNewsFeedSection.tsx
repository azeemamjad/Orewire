import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, ExternalLink, Newspaper } from "lucide-react";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";
import { googleNewsRssUrl } from "@/components/site/MarketNewsKeywordSection";

const REFETCH_MS = 30 * 60 * 1000;

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <li>
      <a
        href={item.link?.startsWith("http") ? item.link : "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-3 px-4 py-4 hover:bg-background/60 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold leading-snug text-foreground group-hover:text-accent transition-colors">
            {item.title}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="uppercase tracking-wider text-foreground/80">{item.source || "Google News"}</span>
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
        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent shrink-0 mt-1" />
      </a>
    </li>
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
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 flex items-center gap-2">
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
      <div className="border border-border bg-surface">
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
