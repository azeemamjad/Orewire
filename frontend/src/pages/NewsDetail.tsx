import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { fetchNewsFeed, fetchNewsItem, type NewsItem } from "@/lib/api";

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

function formatFullDate(dateStr: string): string {
  if (!dateStr) return "Unknown time";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-CA", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function getNewsBody(item: NewsItem): string[] {
  const text = (item.summary || item.title || "").trim();
  if (!text) return ["No detailed summary available for this release yet."];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const NewsDetail = () => {
  const { slug } = useParams();
  const decoded = decodeURIComponent(slug || "");

  // Primary: look up the item directly by link.
  const { data: directItem, isLoading: directLoading } = useQuery({
    queryKey: ["news-item", decoded],
    queryFn: () => fetchNewsItem(decoded),
    enabled: !!decoded,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  // Fallback: scan the latest 50 from the feed (handles cases where the slug
  // isn't a link but the title, or the item isn't yet in the DB by link).
  const { data: feedData, isLoading: feedLoading } = useQuery({
    queryKey: ["news-feed-detail-lookup"],
    queryFn: () => fetchNewsFeed({ page: 1, limit: 50 }),
    enabled: !directItem,
    staleTime: 30 * 60 * 1000,
  });
  const items = feedData?.items || [];

  const item = useMemo<NewsItem | null | undefined>(() => {
    if (directItem) return directItem;
    return items.find((n) => (n.link || n.title) === decoded);
  }, [directItem, items, decoded]);

  const isLoading = directLoading || (!directItem && feedLoading);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-sm text-muted-foreground">Loading news detail...</main>
        <Footer />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 lg:px-6 py-12">
          <Link to="/news" className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to feed
          </Link>
          <div className="border border-border bg-surface p-6 text-sm text-muted-foreground">News item not found.</div>
        </main>
        <Footer />
      </div>
    );
  }

  const sev = getSeverity(item.sentiment, item.title);
  const filingType = getFilingType(item.title);
  const bodyParts = getNewsBody(item);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-3xl mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <Link to="/news" className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to feed
        </Link>

        <div className="border border-border bg-surface p-5 lg:p-6 mb-6">
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <span className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest font-bold ${sev.style}`}>{sev.label}</span>
            <span className="font-mono text-[10px] uppercase tracking-widest border border-border px-1.5 py-1">{filingType}</span>
            {item.commodity && <span className="font-mono text-[11px] font-bold">{item.commodity}</span>}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatFullDate(item.pubDate)}
            </span>
          </div>

          <h1 className="font-display text-2xl lg:text-4xl font-extrabold leading-tight mb-4">{item.title}</h1>

          <div className="border-t border-border pt-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-accent mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> AI summary
            </div>
            <p className="text-[15px] leading-relaxed text-foreground/85">{item.summary || item.title}</p>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-border">
            {item.commodity && (
              <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-muted/50 border border-border">{item.commodity}</span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-muted/50 border border-border">{item.source}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-muted/50 border border-border">{filingType}</span>
          </div>
        </div>

        <article className="prose-sm max-w-none">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Full release · Source: {item.source}</div>
          <div className="space-y-4 text-[15px] leading-relaxed text-foreground/85">
            {bodyParts.map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
          </div>
          {item.link && item.link !== "#" && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex mt-5 text-sm font-semibold text-accent hover:underline"
            >
              Read original release →
            </a>
          )}
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default NewsDetail;
