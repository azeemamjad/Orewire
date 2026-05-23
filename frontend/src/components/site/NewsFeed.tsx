import { Clock, Newspaper } from "lucide-react";

interface NewsItem {
  id: number;
  source: string;
  time: string;
  tag: string;
  headline: string;
}

const placeholderNews: NewsItem[] = [
  { id: 1, source: "Northern Miner", time: "8m", tag: "Gold", headline: "Gold above $2,400 lifts Canadian junior index 1.8% on the week" },
  { id: 2, source: "Reuters", time: "22m", tag: "Copper", headline: "Ivanhoe restarts Kakula at higher throughput after grid stabilization" },
  { id: 3, source: "Globe & Mail", time: "1h", tag: "Gold", headline: "De Grey Hemi feasibility supports 530koz/yr at AISC US$1,210" },
  { id: 4, source: "Stockhouse", time: "1h", tag: "Lithium", headline: "Patriot Battery closes C$45M flow-through for Corvette program" },
  { id: 5, source: "Kitco", time: "2h", tag: "Silver", headline: "Silver squeezes to $31.74 as LBMA inventory falls for 9th week" },
  { id: 6, source: "Mining.com", time: "3h", tag: "Copper", headline: "Filo del Sol: 156m @ 1.4% CuEq from 412m — among year's best" },
  { id: 7, source: "Bloomberg", time: "4h", tag: "Uranium", headline: "Uranium spot $92.10 as producers signal 2027 contract tightness" },
  { id: 8, source: "Reuters", time: "5h", tag: "Africa", headline: "Mali revises mining code; Resolute restarts Syama after talks" },
];

const NewsFeed = () => {
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
        {placeholderNews.map((item) => (
          <li key={item.id} className="px-3 py-2.5 hover:bg-background/60">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{item.source}</span>
              <span className="font-mono text-[9px] text-muted-foreground inline-flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {item.time}
              </span>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 border border-border">{item.tag}</span>
            </div>
            <a href="#" className="text-[13px] leading-snug font-medium hover:underline">{item.headline}</a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NewsFeed;
