import { Link } from "react-router-dom";
import { ArrowUpRight, ExternalLink, Newspaper } from "lucide-react";
import { MARKET_NEWS } from "@/data/marketNews";

/**
 * MarketNewsSection — anonymous landing-page "Latest Market News" block.
 *
 * Ported from the Lovable export (src/components/site/MarketNewsSection.tsx).
 * It renders sample headlines from @/data/marketNews and links out to the
 * publishers, so it needs no authenticated data call and no API request at all.
 *
 * Note: the app already has a live, API-backed market news component at
 * @/components/site/MarketNews (re-exporting @/features/news/components/MarketNews).
 * This one is the static marketing variant and is deliberately separate — the
 * existing component was not touched.
 */

const HOME_LIMIT = 10;

const MarketNewsSection = () => {
  const items = MARKET_NEWS.slice(0, HOME_LIMIT);
  const left = items.slice(0, 5);
  const right = items.slice(5, 10);

  return (
    <section id="market-news" className="border-b border-border bg-background">
      <div className="container-page section-y">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-2">
              <Newspaper className="w-3 h-3 text-accent" /> Global market news
            </div>
            <h2 className="font-display text-2xl lg:text-3xl font-extrabold tracking-tight">
              Latest Market News
            </h2>
          </div>
          <Link
            to="/market-news"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            View all <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="card-surface grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          {[left, right].map((col, idx) => (
            <ul key={idx} className="divide-y divide-border flex flex-col">
              {col.map((n) => (
                <li key={n.id} className="flex-1 flex">
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 px-4 py-4 w-full hover:bg-background/60 transition-colors"
                  >
                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                      <div className="text-[13px] font-semibold leading-snug text-foreground group-hover:text-accent transition-colors line-clamp-2">
                        {n.headline}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                        <span className="uppercase tracking-wider text-foreground/80">{n.source}</span>
                        <span>·</span>
                        <span>{n.publishedAt}</span>
                        {n.category && (
                          <>
                            <span>·</span>
                            <span className="uppercase tracking-wider truncate">{n.category}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent shrink-0 mt-1" />
                  </a>
                </li>
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

export default MarketNewsSection;
