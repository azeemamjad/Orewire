import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, ExternalLink, Newspaper } from "lucide-react";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000;

const placeholderNews: NewsItem[] = [
  { title: "Gold tops $2,420/oz as Fed signals slower rate path; miners rally", summary: "", source: "Reuters", link: "https://www.reuters.com/markets/commodities/", pubDate: "", timeAgo: "18m ago", commodity: "Gold", sentiment: "bullish" },
  { title: "Copper hits 10-week high on China stimulus, LME stocks slide", summary: "", source: "Bloomberg", link: "https://www.bloomberg.com/markets/commodities", pubDate: "", timeAgo: "42m ago", commodity: "Copper", sentiment: "bullish" },
  { title: "Uranium spot prices climb back above $92/lb as utilities return to market", summary: "", source: "Kitco", link: "https://www.kitco.com/news/", pubDate: "", timeAgo: "1h ago", commodity: "Uranium", sentiment: "bullish" },
  { title: "Lithium glut deepens - Pilbara Minerals warns of further price weakness", summary: "", source: "Mining.com", link: "https://www.mining.com/", pubDate: "", timeAgo: "2h ago", commodity: "Lithium", sentiment: "bearish" },
  { title: "Newmont raises 2026 guidance after record Q1 free cash flow", summary: "", source: "Northern Miner", link: "https://www.northernminer.com/", pubDate: "", timeAgo: "3h ago", commodity: "Gold", sentiment: "bullish" },
  { title: "BHP, Rio Tinto pause exploration in Pilbara on heritage review", summary: "", source: "AFR", link: "https://www.afr.com/companies/mining", pubDate: "", timeAgo: "4h ago", commodity: "Iron Ore", sentiment: "neutral" },
  { title: "Silver outperforms gold YTD as industrial demand from solar surges", summary: "", source: "Reuters", link: "https://www.reuters.com/markets/commodities/", pubDate: "", timeAgo: "5h ago", commodity: "Silver", sentiment: "bullish" },
  { title: "Canada's critical minerals strategy adds $1.5B for processing facilities", summary: "", source: "Globe and Mail", link: "https://www.theglobeandmail.com/business/industry-news/energy-and-resources/", pubDate: "", timeAgo: "6h ago", commodity: "Policy", sentiment: "neutral" },
  { title: "Indonesia tightens nickel export licenses; LME nickel jumps 4%", summary: "", source: "Financial Times", link: "https://www.ft.com/commodities", pubDate: "", timeAgo: "7h ago", commodity: "Nickel", sentiment: "bullish" },
  { title: "Junior gold ETF GDXJ posts best monthly gain since 2020", summary: "", source: "Bloomberg", link: "https://www.bloomberg.com/markets/commodities", pubDate: "", timeAgo: "8h ago", commodity: "Gold", sentiment: "bullish" },
];

const NewsRow = ({ item }: { item: NewsItem }) => (
  <li className="flex-1 flex">
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 px-4 py-4 w-full hover:bg-background/60 transition-colors"
    >
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
        <div className="text-[14px] font-semibold leading-snug text-foreground group-hover:text-accent transition-colors line-clamp-2">
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
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent shrink-0 mt-1" />
    </a>
  </li>
);

const MarketNews = () => {
  const { data } = useQuery({
    queryKey: ["market-news-section"],
    queryFn: () => fetchNewsFeed({ page: 1, limit: 10, origin: "google" }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data?.items && data.items.length > 0 ? data.items.slice(0, 10) : placeholderNews;

  const [left, right] = useMemo(() => {
    const half = Math.ceil(items.length / 2);
    return [items.slice(0, half), items.slice(half)];
  }, [items]);

  return (
    <section id="market-news" className="border-b border-border bg-background">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-10 lg:py-12">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 flex items-center gap-2">
              <Newspaper className="w-3 h-3 text-accent" /> Global market news
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight">Latest Market News</h2>
          </div>
          <Link
            to="/market-news"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            View all <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="border border-border bg-surface grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          {[left, right].map((col, idx) => (
            <ul key={idx} className="divide-y divide-border flex flex-col">
              {col.map((item) => (
                <NewsRow key={item.link || item.title} item={item} />
              ))}
            </ul>
          ))}
        </div>

        <div className="mt-10 lg:mt-12 flex justify-center">
          <Link
            to="/market-news"
            className="inline-flex items-center gap-1.5 h-11 px-6 bg-foreground text-background font-mono text-[11px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
          >
            View all market news <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default MarketNews;
