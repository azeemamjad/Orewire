import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Clock, ExternalLink, Sparkles } from "lucide-react";

/**
 * FeedRow — the single row presentation shared by every filing / news-release /
 * market-news list in the app.
 *
 * Layout follows the Lovable design export:
 *
 *   M24   [ROUTINE]   [NEWS RELEASE]                       🕐 Oct 1 · 7:26 PM
 *   ✨ PERIODIC REPORTS · 2796KB
 *
 * i.e. mono ticker first, a filled rounded verdict pill, an outlined type pill,
 * the timestamp pushed right, then a single detail line led by a small icon.
 *
 * This file owns the design conventions so no list re-declares them:
 *  - tickers are monospace and formatted `TSX-V: AUR`
 *  - verdicts are ALWAYS Noteworthy | Watch | Routine (never LOW/HIGH), mapped
 *    to teal / amber / gray
 *  - the brand is always "OreWire"
 *
 * It is presentation only: every value comes from the caller, so each list keeps
 * its own data layer (react-query + our API). No mock data is referenced here.
 */

export type VerdictTone = "Noteworthy" | "Watch" | "Routine";

/**
 * Verdict pill fills: Noteworthy teal, Watch amber, Routine gray.
 *
 * These read the `--noteworthy` / `--watch` / `--routine` tokens, which are set
 * to the export's exact palette (#0F766E / #B45309 / gray) in src/index.css, so
 * every verdict badge in the app — these rows and the landing sections alike —
 * stays on one palette.
 */
export const verdictPillTone: Record<VerdictTone, string> = {
  Noteworthy: "bg-noteworthy text-noteworthy-foreground",
  Watch: "bg-watch text-watch-foreground",
  Routine: "bg-routine text-routine-foreground",
};

/** Verdict names that can arrive from the API but are not user-facing verdicts. */
const NON_VERDICT_VALUES = new Set(["extraction failed", "company mismatch", "unknown", "none", ""]);

/**
 * Normalise anything verdict-ish into the three public verdicts.
 *
 * Accepts our API's `Verdict` ("Noteworthy" | "Watch" | "Routine" |
 * "Extraction failed" | "Company mismatch", sometimes lowercase), the older
 * internal severity scale ("Critical" | "High" | "Medium" | "Low") which must
 * never be shown to users, and empty values.
 */
export function normalizeVerdict(value: string | null | undefined): VerdictTone | null {
  if (!value) return null;
  const raw = value.trim();
  if (NON_VERDICT_VALUES.has(raw.toLowerCase())) return null;
  switch (raw.toLowerCase()) {
    case "noteworthy":
    case "critical":
    case "high":
      return "Noteworthy";
    case "watch":
    case "medium":
      return "Watch";
    case "routine":
    case "low":
      return "Routine";
    default:
      return null;
  }
}

/**
 * Ticker formatted the way the export writes it: `TSX-V: AUR`.
 * Falls back to the bare ticker when the exchange is unknown, and to an empty
 * string when there is neither.
 */
export function formatTickerLabel(ticker?: string | null, exchange?: string | null): string {
  const sym = (ticker || "").trim();
  const ex = normalizeExchange(exchange);
  if (sym && ex) return `${ex}: ${sym}`;
  return sym || ex;
}

/** `TSXV` -> `TSX-V`; trims and upper-cases so listings are consistent. */
export function normalizeExchange(exchange?: string | null): string {
  const ex = (exchange || "").trim().toUpperCase();
  if (!ex) return "";
  return ex === "TSXV" ? "TSX-V" : ex;
}

/**
 * The detail line's `LABEL · SIZE` suffix. The detail itself (category, filing
 * type, source) is passed separately; the size comes back as null whenever our
 * data does not carry a byte size, in which case the row simply omits it rather
 * than inventing a figure.
 */
export function formatSizeLabel(bytes?: number | null): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export interface FeedRowProps {
  /** Internal route. Use this or `externalHref`. */
  href?: string;
  /** External URL (market news). Renders an anchor with an outbound icon. */
  externalHref?: string;
  /** Router location state, e.g. the "back to list" breadcrumb. */
  linkState?: unknown;

  ticker?: string | null;
  exchange?: string | null;
  /** Verdict or legacy severity; normalised, and hidden when not a real verdict. */
  verdict?: string | null;
  /** Outlined pill on the first line, e.g. `NEWS RELEASE` / `NI 43-101`. */
  typeLabel?: string | null;
  /** `Oct 1 · 7:26 PM`. */
  time?: string | null;

  /** Second line's subject — the company name, or the headline for market news. */
  company?: string | null;
  /** Detail shown after the leading icon, e.g. `PERIODIC REPORTS`. */
  category?: string | null;
  /** Optional byte size rendered as `CATEGORY · 2796KB`. Omitted when absent. */
  sizeBytes?: number | null;
  /** Summary line under the detail line. */
  summary?: string | null;
  /** Market-news source, rendered beside the category rather than as a pill. */
  source?: string | null;

  /** Extra controls (e.g. watch button) appended to the first line. */
  actions?: ReactNode;
  className?: string;
  /** `dense` tightens padding for sidebar panels. */
  density?: "default" | "dense";
}

const FeedRow = ({
  href,
  externalHref,
  linkState,
  ticker,
  exchange,
  verdict,
  typeLabel,
  time,
  company,
  category,
  sizeBytes,
  summary,
  source,
  actions,
  className = "",
  density = "default",
}: FeedRowProps) => {
  const tone = normalizeVerdict(verdict);
  const tickerLabel = formatTickerLabel(ticker, exchange);
  const sizeLabel = formatSizeLabel(sizeBytes);
  // Show the exchange as its own pill only when the ticker could not absorb it.
  const showExchangePill = !tickerLabel.includes(":") && !!normalizeExchange(exchange);
  const detail = [category, source].filter(Boolean).join(" · ");

  const pad = density === "dense" ? "px-3.5 py-3" : "px-4 py-3.5";
  const interactive = "block w-full text-left transition-colors hover:bg-muted/40";

  const body = (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        {tone && (
          <span
            className={`shrink-0 font-mono text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictPillTone[tone]}`}
          >
            {tone}
          </span>
        )}
        {tickerLabel && (
          <span className="font-mono text-[13px] font-bold whitespace-nowrap">{tickerLabel}</span>
        )}
        {showExchangePill && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5 whitespace-nowrap">
            {normalizeExchange(exchange)}
          </span>
        )}
        {company && (
          <span className="text-[12px] text-muted-foreground truncate max-w-[40%]">· {company}</span>
        )}
        {typeLabel && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground whitespace-nowrap">
            {typeLabel}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-2 shrink-0">
          {time && (
            <span className="font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
              <Clock className="w-2.5 h-2.5" />
              {time}
            </span>
          )}
          {actions}
        </span>
      </div>

      {(detail || sizeLabel) && (
        <div className="flex items-center gap-1.5 min-w-0 mb-1.5">
          <Sparkles className="w-3 h-3 text-accent shrink-0" />
          {detail && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground truncate">
              {detail}
            </span>
          )}
          {detail && sizeLabel && <span className="font-mono text-[11px] text-muted-foreground">·</span>}
          {sizeLabel && (
            <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">{sizeLabel}</span>
          )}
        </div>
      )}

      {summary && (
        <p className="text-[13px] leading-snug text-foreground/85 line-clamp-2 break-words">{summary}</p>
      )}
    </>
  );

  if (externalHref) {
    return (
      <li className={`w-full ${className}`}>
        <a
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className={`group ${interactive} ${pad}`}
        >
          <span className="flex items-start gap-2">
            <span className="flex-1 min-w-0">{body}</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent shrink-0 mt-1" />
          </span>
        </a>
      </li>
    );
  }

  return (
    <li className={`w-full ${className}`}>
      <Link to={href || "#"} state={linkState} className={`${interactive} ${pad}`}>
        {body}
      </Link>
    </li>
  );
};

export default FeedRow;
