import { useParams, Link } from "react-router-dom";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Globe,
  Newspaper,
  FileText,
  Clock,
  Sparkles,
  MessageSquare,
  Users,
  UserCheck,
  Building,
  Building2,
  Star,
  Lock,
  ExternalLink,
  Plus,
  Bell,
  ThumbsUp,
  ThumbsDown,
  X,
  Check,
  ChevronDown,
} from "lucide-react";
import { fetchCompany, fetchCompanyProfile, fetchDiscussions, postDiscussion, voteDiscussion, fetchCompanyNews, fetchCompanyInsiders, login as apiLogin, register as apiRegister, type CompanyPerson, type Discussion, type InsiderTransaction } from "@/lib/api";
import { getNewsSeverity, getNewsTags } from "@/components/site/NewsArticleCard";
import { useAuth } from "@/hooks/use-auth";
import { useState, useMemo, useEffect, useRef } from "react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import Footer from "@/components/site/Footer";

import { checkWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/api";


// Map our exchange codes to TradingView's symbol prefixes.
function tvSymbol(exchange?: string | null, ticker?: string | null): string | null {
  if (!ticker) return null;
  const ex = (exchange || "").toUpperCase().replace("-", ""); // "TSX-V" -> "TSXV"
  const prefix = ({ TSX: "TSX", TSXV: "TSXV", CSE: "CSE", ASX: "ASX" } as Record<string, string>)[ex] || ex;
  return prefix ? `${prefix}:${ticker.toUpperCase()}` : ticker.toUpperCase();
}

const PriceChart = ({ exchange, ticker }: { exchange?: string | null; ticker?: string | null }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const symbol = tvSymbol(exchange, ticker);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) return;
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      style: "1",
      locale: "en",
      withdateranges: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: true,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="space-y-1.5 p-6 pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
        {symbol && <span className="font-mono text-[11px] text-muted-foreground">{symbol}</span>}
      </div>
      <div className="p-6 pt-0">
        {symbol ? (
          <div
            className="tradingview-widget-container w-full aspect-[16/9] min-h-[340px]"
            ref={containerRef}
          />
        ) : (
          <div className="w-full aspect-[16/9] min-h-[340px] grid place-items-center text-sm text-muted-foreground">
            Chart unavailable for this listing.
          </div>
        )}
      </div>
    </div>
  );
};



function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function emailToHandle(email: string): string {
  return "@" + email.split("@")[0];
}

const CompanyDetail = () => {
  const { slug } = useParams();
  const [inWatchlist, setInWatchlist] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["company", slug],
    queryFn: () => fetchCompany(slug!),
    enabled: !!slug,
  });

  const companyId = data?.id ?? 0;

  useEffect(() => {
    if (companyId) {
      checkWatchlist("company", String(companyId)).then(setInWatchlist);
    }
  }, [companyId]);

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <MarketStrip />
        <div className="flex items-center justify-center py-32">
          <div className="text-muted-foreground">Loading company profile...</div>
        </div>
        <Footer />
      </div>
    );
  }

  const md = data.marketData;

  const isUp = md && md.change_pct !== null && md.change_pct >= 0;
  const isDown = md && md.change_pct !== null && md.change_pct < 0;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} ET`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <MarketStrip />

      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 pb-0">
        {/* Breadcrumb */}
        <div className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <span>/</span>
          <Link to="/companies" className="hover:text-foreground">Companies</Link>
          <span>/</span>
          <span className="font-medium text-foreground">{data.exchange}:{data.ticker || data.name}</span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold px-2 py-1 bg-accent text-accent-foreground">
                {data.exchange}:{data.ticker || "N/A"}
              </span>
              {data.has_gold > 0 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">Gold</span>
              )}
              {data.has_silver > 0 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-surface text-muted-foreground border border-border">Silver</span>
              )}
              {data.has_copper > 0 && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-surface text-muted-foreground border border-border">Copper</span>
              )}
              {md?.country && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-surface text-muted-foreground border border-border">{md.country}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={async () => {
                  try {
                    if (inWatchlist) { await removeFromWatchlist("company", String(data.id)); setInWatchlist(false); }
                    else { await addToWatchlist("company", String(data.id), data.id); setInWatchlist(true); }
                  } catch { /* skip */ }
                }}
                className={`inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium border transition-colors ${
                  inWatchlist
                    ? "border-[hsl(var(--up))] bg-[hsl(var(--up))]/10 text-[hsl(var(--up))]"
                    : "border-border bg-surface hover:bg-muted"
                }`}
              >
                {inWatchlist ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                {inWatchlist ? "Watching" : "Watchlist"}
              </button>
              <button className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium bg-accent text-accent-foreground hover:bg-accent/90 transition-colors">
                <Bell className="w-3 h-3" /> Set alert
              </button>
            </div>
          </div>

          <h1 className="font-display text-3xl lg:text-4xl font-extrabold mb-2">{data.name}</h1>

          {md && md.price !== null && (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-2xl font-mono font-bold">
                C${md.price?.toFixed(3)}
              </span>
              {md.change_pct !== null && (
                <span className={`flex items-center gap-1 font-mono text-sm font-semibold ${isUp ? "text-[hsl(var(--up))]" : isDown ? "text-[hsl(var(--down))]" : "text-muted-foreground"}`}>
                  {isUp ? <ArrowUpRight className="w-4 h-4" /> : isDown ? <ArrowDownRight className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                  {md.change_abs !== null && md.change_abs >= 0 ? "+" : ""}{md.change_abs?.toFixed(3)} ({md.change_pct >= 0 ? "+" : ""}{md.change_pct?.toFixed(2)}%)
                </span>
              )}
              <span className="text-xs text-muted-foreground">· Live · Last: {timeStr}</span>
            </div>
          )}
        </div>

        {/* Chart + Stats */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 mb-10">
          <PriceChart exchange={data.exchange} ticker={data.ticker} />

          <div className="space-y-4">
            <div className="border border-border bg-surface">
              <div className="px-4 py-2.5 border-b border-border">
                <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Key Stats</h3>
              </div>
              <div className="px-4 py-3 space-y-2.5 text-sm">
                <StatRow label="VOLUME" value={md?.volume ? fmtNum(md.volume) : "—"} />
                <StatRow label="AVG VOL (30D)" value="—" />
                <StatRow label="MARKET CAP" value={data.market_cap ? `C$${(data.market_cap / 1e6).toFixed(1)}M` : "—"} />
                <StatRow label="SHARES OUT" value={data.total_float ? `${(data.total_float / 1e6).toFixed(1)}M` : "—"} />
                <StatRow label="52W HIGH" value={md?.price_52_week_high ? `C$${md.price_52_week_high.toFixed(2)}` : "—"} />
                <StatRow label="52W LOW" value={md?.price_52_week_low ? `C$${md.price_52_week_low.toFixed(2)}` : "—"} />
              </div>
            </div>

            <div className="border border-border bg-surface">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                <Building className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Identifiers</h3>
              </div>
              <div className="px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-2">Exchanges &amp; Symbols</div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <IdRow label={data.exchange || "—"} value={data.ticker || "—"} />
                    <IdRow label="OTCQB" value={data.sedar_ticker || "—"} />
                    <IdRow label="FRA" value="—" />
                  </tbody>
                </table>
                <div className="grid grid-cols-2 gap-x-4 mt-3">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">ISIN</div>
                    <div className="font-mono text-xs text-foreground/70">—</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">CUSIP</div>
                    <div className="font-mono text-xs text-foreground/70">—</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* About */}
        <AboutSection
          ticker={data.ticker || data.name}
          name={data.name}
          description={data.description || md?.description || `${data.name} is a ${data.sector || "mining"} company listed on the ${data.exchange || "exchange"}.`}
          website={data.website || null}
          headquarters={data.headquarters || null}
          transferAgent={data.transfer_agent || null}
          exchange={data.exchange || null}
        />

        {/* Directors & Senior Management */}
        <PeopleSection companyId={companyId} />

        {/* Corporate Spotlight */}
        <section className="mt-10 mb-10">
          <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
            <Star className="h-4 w-4" />
            Corporate Spotlight
          </h2>
          <div className="border border-dashed border-border bg-muted/20 p-8 text-center">
            <div className="mx-auto w-10 h-10 grid place-items-center bg-muted rounded-full mb-3">
              <Lock className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Not Yet Available
            </div>
            <h3 className="font-display text-xl tracking-tight mb-2">Are you a Company Director?</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-3">
              Put your Investment Case to Orewire's audience.
            </p>
            <a
              href="mailto:hello@orewire.com"
              className="text-sm font-medium underline underline-offset-4"
            >
              hello@orewire.com
            </a>
          </div>
        </section>

        {/* News & Filings */}
        <section className="mt-10 mb-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CompanyNewsColumn name={data.name} ticker={data.ticker || undefined} exchange={data.exchange || undefined} />
          <CompanyFilingsColumn
            filings={data.filings}
            name={data.name}
            ticker={data.ticker || undefined}
            exchange={data.exchange || undefined}
          />
        </section>

        {/* Insider ownership & transactions */}
        <CompanyInsiders companyId={companyId} ticker={data.ticker || undefined} exchange={data.exchange || undefined} name={data.name} />

        {/* Discussion */}
        <DiscussionSection companyId={companyId} ticker={data.ticker || data.name} />

        {/* Disclaimer */}
        <div className="text-[11px] text-muted-foreground leading-relaxed mb-8 border-t border-border pt-4">
          Orewire publishes editorial summaries of public filings for informational purposes only and does not provide investment advice. Data may be delayed. Always read the original filing.
        </div>
      </div>

      <Footer />
    </div>
  );
};

function fmtNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

const StatRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
    <span className="font-mono text-sm font-bold">{value}</span>
  </div>
);

const IdRow = ({ label, value }: { label: string; value: string }) => (
  <tr>
    <td className="py-1.5 font-mono text-xs text-muted-foreground uppercase">{label}</td>
    <td className="py-1.5 text-right font-mono text-xs font-bold">{value}</td>
  </tr>
);

const AboutSection = ({
  ticker,
  name,
  description,
  website,
  headquarters,
  transferAgent,
  exchange,
}: {
  ticker: string;
  name: string;
  description: string;
  website: string | null;
  headquarters?: string | null;
  transferAgent?: string | null;
  exchange?: string | null;
}) => {
  // ASX issuers list a "Share Registry"; Canadian venues list a "Transfer Agent".
  const agentLabel = (exchange || "").toUpperCase() === "ASX" ? "Share Registry" : "Transfer Agent";
  const displayHost = (() => {
    if (!website) return null;
    try {
      const u = new URL(website.match(/^https?:\/\//) ? website : `https://${website}`);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    }
  })();
  const href = website ? (website.match(/^https?:\/\//) ? website : `https://${website}`) : null;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
        <Building2 className="h-4 w-4" />
        About {ticker || name}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">
        <p>{description}</p>
        {href && displayHost && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
          >
            <Globe className="h-3.5 w-3.5" />
            {displayHost}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {(headquarters || transferAgent) && (
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 pt-3 mt-1 border-t border-border">
            {headquarters && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Head Office</dt>
                <dd className="text-sm">{headquarters}</dd>
              </div>
            )}
            {transferAgent && (
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{agentLabel}</dt>
                <dd className="text-sm">{transferAgent}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  );
};

const PeopleSection = ({ companyId }: { companyId: number }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["company-profile", companyId],
    queryFn: () => fetchCompanyProfile(companyId),
    enabled: companyId > 0,
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading || !data || !data.people || data.people.length === 0) return null;

  const people = data.people;
  const insiderSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const personType = (p: CompanyPerson): { label: string; kind: "executive" | "independent" | "director" } => {
    const title = (p.title || "").toLowerCase();
    if (p.kind === "manager") return { label: "Executive", kind: "executive" };
    if (/independent/.test(title)) return { label: "Independent", kind: "independent" };
    return { label: "Director", kind: "director" };
  };

  return (
    <section className="mt-10 mb-10">
      <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
        <Users className="h-4 w-4" />
        Directors &amp; Senior Management
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-2">Name</th>
              <th className="text-left font-medium py-2">Position</th>
              <th className="text-left font-medium py-2">Type</th>
              <th className="text-left font-medium py-2">Appointed</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const t = personType(p);
              return (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-medium">
                    <a className="hover:underline" href={`/insider/${insiderSlug(p.name)}`}>{p.name}</a>
                  </td>
                  <td className="py-2 text-muted-foreground">{p.title || "—"}</td>
                  <td className="py-2">
                    <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-foreground font-mono text-[10px]">
                      {t.label}
                    </div>
                  </td>
                  <td className="py-2 font-mono text-xs">{p.since_year || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-3 font-mono">
        Source: {people[0]?.source === "manual"
          ? "Manually entered"
          : people[0]?.source === "exchange"
          ? "Official exchange listing data"
          : "Latest management information circular"}
      </p>
    </section>
  );
};

const NEWS_PAGE_SIZE = 4;

const VERDICT_FILTERS = ["All", "Noteworthy", "Watch", "Routine"] as const;
type VerdictFilter = (typeof VERDICT_FILTERS)[number];

const DATE_RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const verdictRound: Record<string, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

function severityToVerdict(sev: "Critical" | "High" | "Medium" | "Low"): "Noteworthy" | "Watch" | "Routine" {
  if (sev === "Critical" || sev === "High") return "Noteworthy";
  if (sev === "Medium") return "Watch";
  return "Routine";
}

function newsType(title: string): string {
  return getNewsTags(title, null)[0] || "News Release";
}

function fmtExchange(ex?: string): string {
  if (!ex) return "";
  return ex.toUpperCase() === "TSXV" ? "TSX-V" : ex;
}

// Filing verdicts come from the API lowercase ("noteworthy"); normalize to the
// capitalized form used by the verdict pills and filters everywhere else.
function capVerdict(v: string | null): string | null {
  if (!v) return null;
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

// Some RSS-sourced news summaries arrive as raw/escaped HTML (e.g. embedded
// <a href> markup). Decode the common entities, strip tags, and collapse
// whitespace so long URLs don't overflow the card.
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

function withinDays(dateStr: string | undefined | null, days: string): boolean {
  if (days === "all" || !dateStr) return true;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= parseInt(days, 10) * 24 * 60 * 60 * 1000;
}

const FeedFilterBar = ({
  verdict,
  onVerdict,
  days,
  onDays,
}: {
  verdict: VerdictFilter;
  onVerdict: (v: VerdictFilter) => void;
  days: string;
  onDays: (d: string) => void;
}) => (
  <div className="flex flex-wrap items-center gap-2 mb-4">
    <div className="flex flex-wrap gap-1.5">
      {VERDICT_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onVerdict(f)}
          className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-full border transition-colors ${
            verdict === f
              ? "bg-foreground text-background border-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {f}
        </button>
      ))}
    </div>
    <select
      value={days}
      onChange={(e) => onDays(e.target.value)}
      className="ml-auto bg-card border border-border px-2.5 h-8 text-xs font-medium outline-none focus:border-accent cursor-pointer rounded-sm"
    >
      {DATE_RANGES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
  </div>
);

const FeedCard = ({
  to,
  verdict,
  exLabel,
  ticker,
  name,
  type,
  time,
  summary,
}: {
  to: string;
  verdict: string | null;
  exLabel: string;
  ticker?: string;
  name: string;
  type: string;
  time: string;
  summary: string;
}) => (
  <Link to={to} className="block border border-border bg-card hover:bg-muted/40 transition-colors px-3.5 py-3">
    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
      {ticker && <span className="font-mono text-sm font-extrabold tracking-tight leading-none">{ticker}</span>}
      {exLabel && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
          {exLabel}
        </span>
      )}
      <span className="text-[13px] font-semibold leading-none truncate max-w-[40%]">{name}</span>
      {verdict && (
        <span className={`text-[9px] font-mono uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full ${verdictRound[verdict] || "bg-surface text-muted-foreground"}`}>
          {verdict}
        </span>
      )}
      <span className="font-mono text-[9px] uppercase tracking-wider px-1 py-0.5 border border-border text-muted-foreground">{type}</span>
      <span className="ml-auto font-mono text-[9px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
        <Clock className="w-2.5 h-2.5" />
        {time}
      </span>
    </div>
    <p className="text-[12.5px] leading-snug text-foreground/85 pl-0.5 break-words line-clamp-2">
      <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
      {summary}
    </p>
  </Link>
);

const CompanyNewsColumn = ({ name, ticker, exchange }: { name: string; ticker?: string; exchange?: string }) => {
  const [verdict, setVerdict] = useState<VerdictFilter>("All");
  const [days, setDays] = useState("all");
  const { data, isLoading } = useInfiniteQuery({
    queryKey: ["company-news", name, ticker],
    queryFn: ({ pageParam }) =>
      fetchCompanyNews(name, ticker, exchange, { limit: NEWS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 30 * 60 * 1000,
  });

  const exLabel = fmtExchange(exchange);
  const newsItems = data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = newsItems
    .filter((n) => {
      const v = severityToVerdict(getNewsSeverity(n.sentiment, n.title));
      return (verdict === "All" || v === verdict) && withinDays(n.pubDate, days);
    })
    .slice(0, 4);

  return (
    <div className="min-w-0">
      <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
        <Newspaper className="h-4 w-4" />
        News Releases
      </h2>
      <div className="mt-4">
        <FeedFilterBar verdict={verdict} onVerdict={setVerdict} days={days} onDays={setDays} />
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading news…</div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No news match these filters.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((n, i) => (
              <FeedCard
                key={`${n.link}-${i}`}
                to={`/news/${encodeURIComponent(n.link || n.title)}`}
                verdict={severityToVerdict(getNewsSeverity(n.sentiment, n.title))}
                exLabel={exLabel}
                ticker={ticker}
                name={name}
                type={newsType(n.title)}
                time={n.timeAgo || ""}
                summary={cleanSummary(n.summary) || n.title}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

type CompanyFiling = {
  id: number;
  filing_type: string | null;
  commodity: string | null;
  created_at: string;
  verdict: string | null;
  summary: string | null;
};

const CompanyFilingsColumn = ({
  filings,
  name,
  ticker,
  exchange,
}: {
  filings: CompanyFiling[];
  name: string;
  ticker?: string;
  exchange?: string;
}) => {
  const [verdict, setVerdict] = useState<VerdictFilter>("All");
  const [days, setDays] = useState("all");
  const exLabel = fmtExchange(exchange);

  const filtered = filings
    .filter((f) => (verdict === "All" || capVerdict(f.verdict) === verdict) && withinDays(f.created_at, days))
    .slice(0, 4);

  return (
    <div className="min-w-0">
      <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
        <FileText className="h-4 w-4" />
        Filings
      </h2>
      <div className="mt-4">
        <FeedFilterBar verdict={verdict} onVerdict={setVerdict} days={days} onDays={setDays} />
        {filings.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No filings found.</div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No filings match these filters.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((f) => (
              <FeedCard
                key={f.id}
                to={`/filings/${f.id}`}
                verdict={capVerdict(f.verdict)}
                exLabel={exLabel}
                ticker={ticker}
                name={name}
                type={f.filing_type || "Filing"}
                time={new Date(f.created_at).toLocaleDateString("en-CA")}
                summary={f.summary || "No summary available"}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <div className="border border-border bg-surface mb-6">
    <div className="px-5 py-3 border-b border-border flex items-center gap-2">
      {icon}
      <h3 className="font-display text-lg font-bold">{title}</h3>
    </div>
    {children}
  </div>
);

const fmtShares = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString());
const fmtPctOwn = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

function txDescriptor(t: InsiderTransaction): string {
  const verb =
    t.transaction_type === "sale" || t.transaction_type === "disposition" ? "Sold"
    : t.transaction_type === "grant" ? "Granted"
    : t.transaction_type === "exercise" ? "Exercised"
    : "Bought";
  const sh = t.shares != null ? `${Number(t.shares).toLocaleString()} shares` : "shares";
  const at = t.price != null ? ` at $${t.price.toFixed(2)}` : "";
  const after = t.total_holdings_after != null ? ` Total holdings now ${Number(t.total_holdings_after).toLocaleString()}.` : "";
  return `${verb} ${sh}${at}.${after}`;
}

// Routine by default; Watch for a director/CEO purchase > $50K (spec rule).
function txVerdict(t: InsiderTransaction): "Watch" | "Routine" {
  const value = (t.shares ?? 0) * (t.price ?? 0);
  const senior = /ceo|cfo|director|chair/i.test(t.title || "");
  if (t.transaction_type === "purchase" && senior && value > 50000) return "Watch";
  return "Routine";
}

const CompanyInsiders = ({
  companyId,
  ticker,
  exchange,
}: {
  companyId: number;
  ticker?: string;
  exchange?: string;
  name: string;
}) => {
  const { data } = useQuery({
    queryKey: ["company-insiders", companyId],
    queryFn: () => fetchCompanyInsiders(companyId),
    enabled: companyId > 0,
    staleTime: 30 * 60 * 1000,
  });

  const exLabel = fmtExchange(exchange);
  const ownership = data?.ownership ?? [];
  const transactions = data?.transactions ?? [];
  const registered = data?.registered ?? false;
  const moreOwners = (data?.ownershipTotal ?? 0) - ownership.length;
  const moreTx = (data?.transactionsTotal ?? 0) - transactions.length;

  if (ownership.length === 0 && transactions.length === 0) {
    return (
      <Section icon={<UserCheck className="w-4 h-4" />} title="Insider Ownership">
        <div className="px-5 py-6 text-sm text-muted-foreground">No insider data on file yet for this company.</div>
      </Section>
    );
  }

  return (
    <Section icon={<UserCheck className="w-4 h-4" />} title="Insider Ownership">
      {ownership.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-5 py-2 font-medium">Name</th>
              <th className="text-left py-2 font-medium">Title</th>
              <th className="text-right py-2 font-medium">Shares held</th>
              <th className="text-right py-2 font-medium">% Out</th>
              <th className="text-left px-5 py-2 font-medium">Last transaction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ownership.map((o) => (
              <tr key={o.insider_name}>
                <td className="px-5 py-2.5 font-medium">{o.insider_name}</td>
                <td className="py-2.5 text-muted-foreground">{o.title || "—"}</td>
                <td className="py-2.5 text-right font-mono">{fmtShares(o.total_shares)}</td>
                <td className="py-2.5 text-right font-mono">{fmtPctOwn(o.percent_ownership)}</td>
                <td className="px-5 py-2.5 font-mono text-[12px] text-muted-foreground">
                  {o.last_transaction || "—"}
                  {o.last_transaction_date ? ` · ${new Date(o.last_transaction_date).toLocaleDateString("en-CA")}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!registered && moreOwners > 0 && (
        <div className="px-5 py-3 border-t border-border text-center">
          <Link to="/register" className="text-[12px] font-mono uppercase tracking-widest text-accent hover:underline">
            Sign up free to see all {data?.ownershipTotal} insiders →
          </Link>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="border-t border-border p-4 space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Insider transactions</div>
          {transactions.map((t, i) => {
            const verdict = txVerdict(t);
            return (
              <div key={`${t.insider_name}-${i}`} className="border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[9px] font-mono uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full ${verdictRound[verdict]}`}>
                    {verdict}
                  </span>
                  {ticker && <span className="font-mono text-[11px] font-bold">{exLabel}: {ticker}</span>}
                  <span className="text-[13px] font-semibold">
                    {t.insider_name}
                    {t.title ? ` (${t.title})` : ""}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
                    <Clock className="w-2.5 h-2.5" />
                    {t.transaction_date ? new Date(t.transaction_date).toLocaleDateString("en-CA") : "—"}
                  </span>
                </div>
                <p className="text-[12.5px] leading-snug text-foreground/85">{txDescriptor(t)}</p>
              </div>
            );
          })}
          {!registered && moreTx > 0 && (
            <div className="pt-1 text-center">
              <Link to="/register" className="text-[12px] font-mono uppercase tracking-widest text-accent hover:underline">
                Sign up free to see all {data?.transactionsTotal} transactions →
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="px-5 py-2 border-t border-border">
        <span className="font-mono text-[10px] text-muted-foreground">
          Source: SEDI / proxy / director interest / substantial holder filings
        </span>
      </div>
    </Section>
  );
};

const DiscussionSection = ({ companyId, ticker }: { companyId: number; ticker: string }) => {
  const { isAuthenticated } = useAuth();
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingPost, setPendingPost] = useState(false);

  const { data: comments = [], refetch } = useQuery({
    queryKey: ["discussions", companyId],
    queryFn: () => fetchDiscussions(companyId),
    enabled: companyId > 0,
  });

  const submitComment = async () => {
    if (!commentText.trim() || posting) return;
    setPosting(true);
    try {
      await postDiscussion(companyId, commentText.trim());
      setCommentText("");
      setPendingPost(false);
      refetch();
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("Login") || err.message?.includes("Session expired")) {
        setPendingPost(true);
        setShowAuthModal(true);
      }
    } finally {
      setPosting(false);
    }
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    if (!isAuthenticated) {
      setPendingPost(true);
      setShowAuthModal(true);
      return;
    }
    submitComment();
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (pendingPost && commentText.trim()) {
      setTimeout(() => submitComment(), 100);
    }
  };

  const handleVote = async (comment: Discussion, vote: number) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    const newVote = comment.userVote === vote ? 0 : vote;
    try {
      await voteDiscussion(companyId, comment.id, newVote);
      refetch();
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("Login") || err.message?.includes("Session expired")) {
        setShowAuthModal(true);
      }
    }
  };

  return (
    <>
      <Section icon={<MessageSquare className="w-4 h-4" />} title="Discussion">
        <div className="px-5 py-3 border-b border-border">
          <form onSubmit={handlePost} className="flex gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={`Discuss ${ticker}...`}
              className="flex-1 bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent"
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={posting || !commentText.trim()}
              className="px-4 h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              Post
            </button>
          </form>
        </div>
        {comments.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-muted-foreground">
            No comments yet. Be the first to discuss {ticker}.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {comments.map((c) => (
              <li key={c.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <button
                      onClick={() => handleVote(c, 1)}
                      className={`hover:text-foreground ${c.userVote === 1 ? "text-[hsl(var(--up))]" : ""}`}
                    >
                      <ThumbsUp className="w-3 h-3" />
                    </button>
                    <span className="font-mono text-[11px] font-bold">{c.score}</span>
                    <button
                      onClick={() => handleVote(c, -1)}
                      className={`hover:text-foreground ${c.userVote === -1 ? "text-[hsl(var(--down))]" : ""}`}
                    >
                      <ThumbsDown className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="font-mono text-[11px] font-bold">{emailToHandle(c.userEmail)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">· {timeAgo(c.createdAt)}</span>
                </div>
                <p className="text-sm text-foreground/80">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {showAuthModal && (
        <AuthModal
          onSuccess={handleAuthSuccess}
          onClose={() => { setShowAuthModal(false); setPendingPost(false); }}
          pendingComment={pendingPost ? commentText : undefined}
        />
      )}
    </>
  );
};

const AuthModal = ({
  onSuccess,
  onClose,
  pendingComment,
}: {
  onSuccess: () => void;
  onClose: () => void;
  pendingComment?: string;
}) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await apiLogin(email, password);
      } else {
        await apiRegister(email, password);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border w-full max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-display text-base font-bold">
            {mode === "login" ? "Log in" : "Create account"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {pendingComment && (
            <div className="mb-4 p-2.5 bg-muted/50 border border-border text-xs text-muted-foreground">
              Your comment will be posted after you {mode === "login" ? "log in" : "sign up"}:
              <p className="mt-1 text-foreground font-medium truncate">"{pendingComment}"</p>
            </div>
          )}

          {error && (
            <div className="mb-3 p-2.5 bg-destructive/10 text-destructive text-xs">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
              className="w-full bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              minLength={6}
              className="w-full bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {loading ? "..." : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          <div className="mt-3 text-center text-xs text-muted-foreground">
            {mode === "login" ? (
              <>Don't have an account?{" "}
                <button onClick={() => { setMode("register"); setError(""); }} className="text-accent hover:underline font-medium">
                  Sign up
                </button>
              </>
            ) : (
              <>Already have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }} className="text-accent hover:underline font-medium">
                  Log in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyDetail;
