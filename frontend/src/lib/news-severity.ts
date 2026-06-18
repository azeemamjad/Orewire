export type NewsSeverity = "Critical" | "High" | "Medium" | "Low";

export const NEWS_SEVERITIES: NewsSeverity[] = ["Critical", "High", "Medium", "Low"];

export const severityStyle: Record<NewsSeverity, string> = {
  Critical: "bg-destructive text-destructive-foreground",
  High: "bg-noteworthy text-noteworthy-foreground",
  Medium: "bg-watch text-watch-foreground",
  Low: "bg-routine text-routine-foreground",
};

export function getNewsSeverity(sentiment: string | undefined, title: string): NewsSeverity {
  const t = (title || "").toLowerCase();
  if (t.includes("drill") && (t.includes("high-grade") || /\d+.*g\/t/.test(t))) return "Critical";
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
  if (t.includes("quarterly") || /q[1-4]/.test(t)) return "Quarterly";
  if (t.includes("assay")) return "Assay";
  if (t.includes("acquisition") || t.includes("merger")) return "M&A";
  return "News Release";
}
