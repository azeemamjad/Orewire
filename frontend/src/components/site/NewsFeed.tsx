import { useQuery } from "@tanstack/react-query";
import { Clock, Newspaper } from "lucide-react";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";

const placeholderNews: NewsItem[] = [
  { title: "Gold above $2,400 lifts Canadian junior index 1.8% on the week", source: "Northern Miner", timeAgo: "8m", commodity: "Gold", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Ivanhoe restarts Kakula at higher throughput after grid stabilization", source: "Reuters", timeAgo: "22m", commodity: "Copper", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "De Grey Hemi feasibility supports 530koz/yr at AISC US$1,210", source: "Globe & Mail", timeAgo: "1h", commodity: "Gold", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Patriot Battery closes C$45M flow-through for Corvette program", source: "Stockhouse", timeAgo: "1h", commodity: "Lithium", sentiment: "neutral", link: "#", pubDate: "", summary: "" },
  { title: "Silver squeezes to $31.74 as LBMA inventory falls for 9th week", source: "Kitco", timeAgo: "2h", commodity: "Silver", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Filo del Sol: 156m @ 1.4% CuEq from 412m — among year's best", source: "Mining.com", timeAgo: "3h", commodity: "Copper", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Uranium spot $92.10 as producers signal 2027 contract tightness", source: "Bloomberg", timeAgo: "4h", commodity: "Uranium", sentiment: "bullish", link: "#", pubDate: "", summary: "" },
  { title: "Mali revises mining code; Resolute restarts Syama after talks", source: "Reuters", timeAgo: "5h", commodity: null, sentiment: "neutral", link: "#", pubDate: "", summary: "" },
];

const NewsFeed = () => {
  const { data } = useQuery({
    queryKey: ["news-feed"],
    queryFn: fetchNewsFeed,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  const items = data && data.length > 0 ? data : placeholderNews;

  return (
    <div className="border border-border bg-surface h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5" />
          <h3 className="font-display text-sm font-bold tracking-tight">News feed</h3>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· Summarized</span>
        </div>
        <a href="#feed" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
          All →
        </a>
      </div>
      <ul className="divide-y divide-border flex-1">
        {items.slice(0, 8).map((item, i) => (
          <li key={i} className="px-3 py-2.5 hover:bg-background/60">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{item.source}</span>
              <span className="font-mono text-[9px] text-muted-foreground inline-flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {item.timeAgo}
              </span>
              {item.commodity && (
                <span className="ml-auto font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 border border-border">{item.commodity}</span>
              )}
            </div>
            <a
              href={item.link !== "#" ? item.link : undefined}
              target={item.link !== "#" ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="text-[13px] leading-snug font-medium hover:underline"
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NewsFeed;
