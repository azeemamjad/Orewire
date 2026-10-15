import { Link } from "react-router-dom";
import { Clock, Sparkles, FileText } from "lucide-react";
import { type FeedItem, verdictPill } from "@/data/feedMock";
import AddToWatchButton from "@/components/site/AddToWatchButton";

/**
 * FeedCard — compact feed row used by the anonymous landing preview.
 *
 * Ported from the Lovable export (src/components/site/FeedCard.tsx) unmodified
 * apart from the AddToWatchButton import path. It renders whatever `FeedItem`
 * it is given; the sample items come from @/data/feedMock. No data fetching,
 * no auth required to render.
 */

const FeedCard = ({ item, kind = "news" }: { item: FeedItem; kind?: "news" | "filing" }) => {
  return (
    <Link
      to={item.href}
      className="block border border-border bg-card hover:bg-muted/40 transition-colors px-4 py-3.5"
    >
      <div className="flex items-center gap-2.5 mb-1 flex-wrap">
        <span className="font-mono text-[18px] font-extrabold tracking-tight leading-none">
          {item.ticker}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
          {item.exchange}
        </span>
        <span className="text-[15px] font-semibold leading-none truncate max-w-[45%]">
          {item.company}
        </span>
        <span
          className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictPill[item.verdict]}`}
        >
          {item.verdict}
        </span>
        {kind === "news" && (
          <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
            {item.category}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {item.time}
        </span>
        <AddToWatchButton ticker={item.ticker} market={item.exchange} name={item.company} />
      </div>
      {kind === "filing" && (
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
          <FileText className="w-3 h-3 text-accent" />
          {item.category}
        </div>
      )}
      <p className="text-[13px] leading-snug text-foreground/85 pl-0.5">
        <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
        {item.summary}
      </p>
    </Link>
  );
};

export default FeedCard;
