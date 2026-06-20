import type { ListFilters } from "@/components/site/ListFilterBar";
import type { NewsSeverity } from "@/lib/news-severity";
import { getNewsSeverity } from "@/lib/news-severity";
import type { Verdict } from "@/lib/api";

/** Map design significance labels to API severity (single-select). */
const SIGNIFICANCE_TO_SEVERITY: Record<string, string> = {
  Noteworthy: "High",
  Watch: "Medium",
  Routine: "Low",
};

export function apiSeverityFromFilters(filters: ListFilters): string | undefined {
  if (filters.severities.length !== 1) return undefined;
  return SIGNIFICANCE_TO_SEVERITY[filters.severities[0]] ?? filters.severities[0];
}

export function apiVerdictFromFilters(filters: ListFilters): Verdict | "All" | undefined {
  if (filters.severities.length !== 1) return undefined;
  const v = filters.severities[0];
  if (v === "Noteworthy" || v === "Watch" || v === "Routine") return v;
  return undefined;
}

export function apiExchangeFromFilters(filters: ListFilters): string | undefined {
  return filters.exchanges.length === 1 ? filters.exchanges[0] : undefined;
}

export function apiCommodityFromFilters(filters: ListFilters): string | undefined {
  return filters.commodities.length === 1 ? filters.commodities[0] : undefined;
}

export function matchesMultiFilters(
  filters: ListFilters,
  row: {
    exchange?: string | null;
    commodity?: string | null;
    text?: string;
    significance?: string;
    verdict?: string | null;
  },
): boolean {
  if (filters.exchanges.length && !filters.exchanges.includes(row.exchange || "")) return false;
  if (filters.commodities.length) {
    const text = `${row.commodity || ""} ${row.text || ""}`.toLowerCase();
    if (!filters.commodities.some((c) => text.includes(c.toLowerCase()))) return false;
  }
  if (filters.severities.length) {
    if (row.verdict) {
      if (!filters.severities.includes(row.verdict)) return false;
    } else if (row.significance) {
      if (!filters.severities.includes(row.significance)) return false;
    }
  }
  return true;
}

export function newsSignificanceLabel(sentiment: string | undefined, title: string): string {
  const sev = getNewsSeverity(sentiment, title);
  const map: Record<NewsSeverity, string> = {
    Critical: "Noteworthy",
    High: "Noteworthy",
    Medium: "Watch",
    Low: "Routine",
  };
  return map[sev];
}
