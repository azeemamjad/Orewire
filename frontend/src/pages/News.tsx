import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Newspaper } from "lucide-react";
import { Link } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { fetchNewsFeed, type NewsItem } from "@/lib/api";

const severityStyle: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-noteworthy text-noteworthy-foreground",
  medium: "bg-watch text-watch-foreground",
  low: "bg-routine text-routine-foreground",
};

function getSeverity(sentiment: string | undefined, title: string): { label: string; style: string } {
  const t = (title || "").toLowerCase();
  if (t.includes("drill") && (t.includes("high-grade") || /\d+.*g\/t/.test(t))) return { label: "Critical", style: severityStyle.critical };
  if (t.includes("resource") || t.includes("feasibility") || t.includes("assay")) return { label: "High", style: severityStyle.high };
  if (t.includes("placement") || t.includes("financing") || t.includes("acquisition")) return { label: "Medium", style: severityStyle.medium };
  if (sentiment === "bullish") return { label: "High", style: severityStyle.high };
  if (sentiment === "bearish") return { label: "Medium", style: severityStyle.medium };
  return { label: "Low", style: severityStyle.low };
}

function getFilingType(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("drill")) return "Drill Result";
  if (t.includes("resource")) return "Resource Update";
  if (t.includes("feasibility") || t.includes("technical report")) return "Technical Report";
  if (t.includes("placement") || t.includes("financing") || t.includes("bought deal")) return "Private Placement";
  if (t.includes("quarterly") || t.includes("q1") || t.includes("q2") || t.includes("q3") || t.includes("q4")) return "Quarterly";
  if (t.includes("assay")) return "Assay";
  if (t.includes("acquisition") || t.includes("merger")) return "M&A";
  return "News Release";
}

function toNewsSlug(item: NewsItem): string {
  return encodeURIComponent(item.link || item.title);
}

// Decode/strip raw HTML some RSS summaries carry so long URLs don't overflow.
function cleanSummary(text: string | null | undefined): string {
  if (!text) return "";
  const decoded = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  return decoded.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const PAGE_SIZE = 10;

const News = () => {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["news-feed", page, PAGE_SIZE],
    queryFn: () => fetchNewsFeed({ page, limit: PAGE_SIZE }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  const pageItems = useMemo(
    () => (data?.items || []).slice().sort((a, b) => new Date(b.pubDate || 0).getTime() - new Date(a.pubDate || 0).getTime()),
    [data?.items],
  );
  const totalPages = data?.pagination?.totalPages ?? 1;
  const showLoading = isLoading || (isFetching && pageItems.length === 0);

  const goToPage = (next: number) => {
    const upper = data?.pagination?.totalPages;
    const clamped = upper ? Math.min(Math.max(1, next), upper) : Math.max(1, next);
    if (clamped === page) return;
    setPage(clamped);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Live feed</div>
          <h1 className="font-display text-3xl lg:text-5xl font-extrabold tracking-tight mb-2">News Releases</h1>
          <p className="text-sm text-foreground/70">Latest mining and market releases with AI summaries.</p>
        </div>

        <div className="border border-border bg-surface">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <Newspaper className="w-4 h-4" />
            <span className="font-display text-sm font-bold">All News</span>
          </div>

          {showLoading ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">Loading news...</div>
          ) : pageItems.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">No news available.</div>
          ) : (
            <ul className="divide-y divide-border">
              {pageItems.map((item, i) => {
                const sev = getSeverity(item.sentiment, item.title);
                const filingType = getFilingType(item.title);
                return (
                  <li key={`${item.link}-${i}`} className="hover:bg-background/60">
                    <Link to={`/news/${toNewsSlug(item)}`} className="block px-5 py-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold ${sev.style}`}>
                          {sev.label}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-border px-1 py-0.5">
                          {filingType}
                        </span>
                        {item.commodity && (
                          <span className="font-mono text-[9px] uppercase tracking-widest px-1 py-0.5 border border-border">
                            {item.commodity}
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.timeAgo}
                        </span>
                      </div>
                      <h2 className="font-display text-lg font-bold leading-tight mb-1">{item.title}</h2>
                      <p className="text-sm text-foreground/75 line-clamp-2 break-words">{cleanSummary(item.summary) || item.title}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {!showLoading && totalPages > 1 && (
            <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Page {page} of {totalPages}
                {isFetching ? " · loading…" : ""}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1 || isFetching}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages || isFetching}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default News;
