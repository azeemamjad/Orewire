import type { NewsItem } from "@/lib/api";

export const newsSeverityStyle: Record<string, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-noteworthy text-noteworthy-foreground",
  Medium: "bg-watch text-watch-foreground",
  Low: "bg-routine text-routine-foreground",
};

export function getNewsSeverity(sentiment: string | undefined, title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("drill") && (t.includes("high-grade") || t.includes("2.4×") || /\d+.*g\/t/.test(t))) return "Critical";
  if (t.includes("resource") || t.includes("feasibility") || t.includes("assay")) return "High";
  if (t.includes("placement") || t.includes("financing") || t.includes("acquisition")) return "Medium";
  if (sentiment === "bullish") return "High";
  if (sentiment === "bearish") return "Medium";
  return "Low";
}

export function getNewsFilingType(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("drill")) return "Drill Result";
  if (t.includes("resource")) return "Resource Update";
  if (t.includes("feasibility") || t.includes("technical report")) return "Technical Report";
  if (t.includes("placement") || t.includes("financing") || t.includes("bought deal")) return "Private Placement";
  if (t.includes("quarterly") || /\bq[1-4]\b/.test(t)) return "Quarterly";
  if (t.includes("assay")) return "Assay";
  if (t.includes("acquisition") || t.includes("merger")) return "M&A";
  return "News Release";
}

export function cleanNewsSummary(text: string | null | undefined): string {
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

export function newsItemHref(item: NewsItem): string {
  return `/news/${encodeURIComponent(item.link || item.title)}`;
}

export function isCompanyLinkedNews(item: NewsItem): boolean {
  return item.companyId != null || !!item.ticker;
}

const NEWS_TZ = "America/Toronto";

/** Apr 24 · 7:31 AM - from pubDate; falls back to API timeAgo when missing. */
export function formatNewsDateTime(pubDate: string | null | undefined, fallback = ""): string {
  if (!pubDate) return fallback;
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return fallback;
  const datePart = d.toLocaleDateString("en-US", { timeZone: NEWS_TZ, month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", {
    timeZone: NEWS_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} · ${timePart}`;
}

export function newsDisplayTime(item: Pick<NewsItem, "pubDate" | "timeAgo">): string {
  return formatNewsDateTime(item.pubDate, item.timeAgo) || item.timeAgo || "";
}
