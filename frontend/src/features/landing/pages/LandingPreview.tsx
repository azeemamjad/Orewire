import SiteLayout from "@/layouts/SiteLayout";
import { useSeo } from "@/lib/seo";
import Coverage from "@/components/site/Coverage";
import Problem from "@/components/site/Problem";
import Dashboard from "@/components/site/Dashboard";
import Verdicts from "@/components/site/Verdicts";
import Performance from "@/components/site/Performance";
import FeedPreview from "@/components/site/FeedPreview";
import FeedCard from "@/components/site/FeedCard";
import MarketNewsSection from "@/components/site/MarketNewsSection";
import CTA from "@/components/site/CTA";
import { NEWS_FEED } from "@/data/feedMock";

/**
 * LandingPreview — review surface for the anonymous/pre-signin design ported
 * from the Lovable export.
 *
 * Why this exists: the ported sections (Coverage, Problem, Dashboard, Verdicts,
 * Performance, FeedPreview, MarketNewsSection, CTA) are marketing-only and are
 * referenced by nothing else in the app, because the live home page at `/`
 * deliberately renders the API-backed components instead. Without a page that
 * composes them the port would be unreachable code and impossible to review,
 * so this route exists purely so the design can be seen end to end.
 *
 * Delete this file and its route in src/app/routes.tsx to drop it; nothing else
 * depends on it.
 *
 * It is marked noindex: this content is presentation sample data (see
 * src/data/feedMock.ts and src/data/marketNews.ts) and must not be indexed as
 * real coverage claims. The real, indexable home page is `/`.
 */

const LandingPreview = () => {
  useSeo(
    {
      title: "OreWire Landing Preview (internal)",
      description: "Internal review surface for the pre-signin landing design. Not indexed.",
      canonicalPath: "/preview",
      robots: "noindex, nofollow",
    },
    [],
  );

  return (
    <SiteLayout variant="home">
      <main>
        <Coverage />
        <Problem />
        <Dashboard />

        {/* FeedCard sample — the compact row the landing feed is built from. */}
        <section className="border-b border-border/70 bg-background">
          <div className="container-page section-y">
            <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                  Feed card
                </div>
                <h2 className="section-title">Latest filings</h2>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                Sample rows · /news and /filings
              </span>
            </div>
            <div className="space-y-2">
              {NEWS_FEED.slice(0, 4).map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        </section>

        <Verdicts />
        <Performance />
        <MarketNewsSection />

        <section className="border-b border-border/70 bg-background">
          <div className="container-page py-24 lg:py-32 grid lg:grid-cols-2 gap-14 items-center">
            <FeedPreview />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                /// Filing → alert
              </div>
              <h2 className="font-display text-4xl lg:text-5xl font-bold leading-[0.95] mb-6">
                The feed,<br />
                <span className="text-primary">before the open.</span>
              </h2>
              <p className="text-foreground/70 leading-relaxed">
                Every filing arrives decoded: what was filed, whether it matters, and what to
                watch next. No PDFs to open.
              </p>
            </div>
          </div>
        </section>

        <CTA />
      </main>
    </SiteLayout>
  );
};

export default LandingPreview;
