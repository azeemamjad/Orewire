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
  ShoppingCart,
  Building2,
  Star,
  Lock,
  ExternalLink,
  Plus,
  Heart,
  X,
  Check,
} from "lucide-react";
import { fetchCompany, fetchCompanyProfile, fetchDiscussions, postDiscussion, voteDiscussion, fetchCompanyNews, fetchCompanyInsiders, login as apiLogin, register as apiRegister, type Discussion, type InsiderTransaction, type NewsItem } from "@/lib/api";
import { getNewsSeverity, getNewsTags } from "@/components/site/NewsArticleCard";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect, type ReactNode } from "react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import MorningBrief from "@/components/site/MorningBrief";
import Footer from "@/components/site/Footer";
import SetAlertButton from "@/components/site/SetAlertButton";
import TradingViewChart from "@/components/site/TradingViewChart";
import { tvSymbol } from "@/lib/tradingview";

import { checkWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/api";


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
        <MorningBrief />
        <div className="flex items-center justify-center py-32">
          <div className="text-muted-foreground">Loading company profile...</div>
        </div>
        <Footer />
      </div>
    );
  }

  const md = data.marketData;
  const fund = data.fundamentals;

  // Trading currency (price, 52W, computed market cap) is driven by the exchange.
  const priceCcy = exchangeCcy(data.exchange);
  // Prefer live shares-outstanding from TradingView, then the scraped DB values.
  const sharesOut = fund?.shares_outstanding ?? data.shares_outstanding ?? data.total_float ?? null;
  // Market cap = price × shares (kept in the trading currency so it matches the price).
  // Fall back to TradingView's market_cap_basic (reported in its own currency) or the DB value.
  const computedMcap = md?.price != null && sharesOut != null ? md.price * sharesOut : null;
  const marketCap = computedMcap ?? fund?.market_cap ?? data.market_cap ?? null;
  const marketCapCcy = computedMcap != null ? priceCcy : fund?.market_cap != null ? ccySymbol(fund.market_cap_currency) : priceCcy;

  const isUp = md && md.change_pct != null && md.change_pct >= 0;
  const isDown = md && md.change_pct != null && md.change_pct < 0;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} ET`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <MarketStrip />
      <MorningBrief />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <nav className="text-xs text-muted-foreground mb-4 font-mono">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          <span>Companies</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">
            {fmtExLabel(data.exchange)}:{data.ticker || data.name}
          </span>
        </nav>

        <header className="border-b border-border pb-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="font-mono text-sm px-2 py-1 bg-foreground text-background rounded-sm">
                  {fmtExLabel(data.exchange)}:{data.ticker || "N/A"}
                </span>
                {data.has_gold > 0 && (
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground font-mono">
                    Gold
                  </span>
                )}
                {data.has_silver > 0 && (
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                    Silver
                  </span>
                )}
                {data.has_copper > 0 && (
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                    Copper
                  </span>
                )}
                {md?.country && (
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                    {md.country}
                  </span>
                )}
              </div>
              <h1 className="font-display text-4xl md:text-5xl tracking-tight">{data.name}</h1>
              {md && md.price != null && (
                <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-3xl font-semibold">{priceCcy}{md.price.toFixed(Math.abs(md.price) < 1 ? 4 : 3)}</span>
                  {md.change_pct != null && (
                    <span
                      className={`font-mono text-sm flex items-center gap-1 ${
                        isUp ? "text-[hsl(var(--up))]" : isDown ? "text-[hsl(var(--down))]" : "text-muted-foreground"
                      }`}
                    >
                      {isUp ? <ArrowUpRight className="h-4 w-4" /> : isDown ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      {md.change_abs != null && `${md.change_abs >= 0 ? "+" : ""}${md.change_abs.toFixed(Math.abs(md.price) < 1 ? 4 : 3)}`}
                      {" "}({md.change_pct >= 0 ? "+" : ""}{md.change_pct.toFixed(2)}%)
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">· Live · Last: {timeStr}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (inWatchlist) {
                      await removeFromWatchlist("company", String(data.id));
                      setInWatchlist(false);
                    } else {
                      await addToWatchlist("company", String(data.id), data.id);
                      setInWatchlist(true);
                    }
                  } catch {
                    /* skip */
                  }
                }}
                className={`inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium h-9 rounded-md px-3 border transition-colors ${
                  inWatchlist
                    ? "border-[hsl(var(--up))] bg-[hsl(var(--up))]/10 text-[hsl(var(--up))]"
                    : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {inWatchlist ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {inWatchlist ? "Watching" : "Watchlist"}
              </button>
              <SetAlertButton
                itemType="company"
                itemKey={String(data.id)}
                companyId={data.id}
                label="News alerts"
                activeLabel="News alerts on"
              />
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6 items-stretch">
          <div className="lg:col-span-2 min-h-0">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm h-full flex flex-col">
              <div className="space-y-1.5 p-6 pb-3 flex flex-row items-center justify-between gap-3 flex-wrap shrink-0">
                <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
                {tvSymbol(data.exchange, data.ticker) && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {tvSymbol(data.exchange, data.ticker)}
                  </span>
                )}
              </div>
              <div className="p-6 pt-0 flex-1 min-h-0">
                <TradingViewChart symbol={tvSymbol(data.exchange, data.ticker)} />
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-6 min-h-0 lg:h-full">
            <KeyStatsCard
              volume={md?.volume ?? null}
              avgVol30={data.fundamentals?.avg_volume_30d ?? null}
              marketCap={marketCap}
              marketCapCcy={marketCapCcy}
              sharesOut={sharesOut}
              high52={md?.price_52_week_high ?? null}
              low52={md?.price_52_week_low ?? null}
              priceCcy={priceCcy}
            />
            <IdentifiersCard
              exchange={data.exchange}
              ticker={data.ticker}
              sedarTicker={data.sedar_ticker}
              transferAgent={data.transfer_agent}
              isin={data.fundamentals?.isin}
              cusip={data.fundamentals?.cusip}
              isAsx={(data.exchange || "").toUpperCase() === "ASX"}
              className="flex-1"
            />
          </aside>
        </div>

        <section className="mt-10">
          <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            About {data.ticker || data.name}
          </h2>
          <AboutPanel
            description={
              data.description ||
              md?.description ||
              `${data.name} is a ${data.sector || "mining"} company listed on the ${data.exchange || "exchange"}.`
            }
            website={data.website || null}
            headquarters={data.headquarters || null}
          />
        </section>

        <section className="mt-10">
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

        <section className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CompanyNewsColumn name={data.name} ticker={data.ticker || undefined} exchange={data.exchange || undefined} />
          <CompanyFilingsColumn
            filings={data.filings}
            name={data.name}
            ticker={data.ticker || undefined}
            exchange={data.exchange || undefined}
          />
        </section>

        <PeopleSection companyId={companyId} />

        <InsiderTransactionsSection companyId={companyId} />

        <DiscussionSection companyId={companyId} ticker={data.ticker || data.name} />

        <p className="text-xs text-muted-foreground mt-10 leading-relaxed border-t border-border pt-4">
          Orewire publishes editorial summaries of public filings for informational purposes only and does not provide investment advice. Data may be delayed. Always read the original filing.
        </p>
      </main>

      <Footer />
    </div>
  );
};

// Key stats show full numbers with thousands separators — no K/M/B abbreviation.
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtMarketCap(n: number | null | undefined, ccy = "C$"): string {
  if (n == null) return "—";
  return `${ccy}${Math.round(n).toLocaleString("en-US")}`;
}

function fmtSharesOut(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

// Map an ISO currency code to its display symbol.
function ccySymbol(code: string | null | undefined): string {
  switch ((code || "").toUpperCase()) {
    case "USD": return "US$";
    case "AUD": return "A$";
    case "CAD": return "C$";
    case "GBP": return "£";
    case "EUR": return "€";
    default: return "C$";
  }
}

// Trading currency for an OreWire exchange (we only list TSX-V / CSE / ASX).
function exchangeCcy(exchange: string | null | undefined): string {
  return (exchange || "").toUpperCase().replace("-", "") === "ASX" ? "A$" : "C$";
}

function fmtExLabel(ex?: string | null): string {
  if (!ex) return "—";
  const u = ex.toUpperCase().replace("-", "");
  return u === "TSXV" ? "TSX-V" : ex;
}

function websiteParts(website: string | null) {
  if (!website) return { href: null as string | null, host: null as string | null };
  const href = website.match(/^https?:\/\//) ? website : `https://${website}`;
  try {
    const u = new URL(href);
    return { href, host: u.hostname.replace(/^www\./, "") };
  } catch {
    return {
      href,
      host: website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""),
    };
  }
}

const KeyStatsCard = ({
  volume,
  avgVol30,
  marketCap,
  marketCapCcy,
  sharesOut,
  high52,
  low52,
  priceCcy,
}: {
  volume: number | null;
  avgVol30: number | null;
  marketCap: number | null;
  marketCapCcy: string;
  sharesOut: number | null;
  high52: number | null;
  low52: number | null;
  priceCcy: string;
}) => {
  const px = (n: number | null) => (n != null ? `${priceCcy}${n.toFixed(Math.abs(n) < 1 ? 4 : 2)}` : "—");
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm shrink-0">
      <div className="flex flex-col space-y-1.5 p-6 pb-3">
        <h3 className="font-semibold font-display text-base uppercase tracking-wider">Key stats</h3>
      </div>
      <div className="p-6 pt-0">
        <dl className="grid grid-cols-2 gap-y-2.5 text-sm leading-normal">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Volume</dt>
          <dd className="font-mono text-right font-semibold">{volume != null ? fmtNum(volume) : "—"}</dd>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Avg Vol (30D)</dt>
          <dd className="font-mono text-right font-semibold">{avgVol30 != null ? fmtNum(avgVol30) : "—"}</dd>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Market Cap</dt>
          <dd className="font-mono text-right font-semibold">{fmtMarketCap(marketCap, marketCapCcy)}</dd>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Shares Out</dt>
          <dd className="font-mono text-right font-semibold">{fmtSharesOut(sharesOut)}</dd>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">52W High</dt>
          <dd className="font-mono text-right font-semibold">{px(high52)}</dd>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">52W Low</dt>
          <dd className="font-mono text-right font-semibold">{px(low52)}</dd>
        </dl>
      </div>
    </div>
  );
};

const IdentifiersCard = ({
  exchange,
  ticker,
  sedarTicker,
  transferAgent,
  isin,
  cusip,
  isAsx,
  className = "",
}: {
  exchange?: string | null;
  ticker?: string | null;
  sedarTicker?: string | null;
  transferAgent?: string | null;
  isin?: string | null;
  cusip?: string | null;
  isAsx?: boolean;
  className?: string;
}) => (
  <div className={`rounded-lg border bg-card text-card-foreground shadow-sm flex flex-col min-h-0 ${className}`.trim()}>
    <div className="flex flex-col space-y-1.5 p-6 pb-3 shrink-0">
      <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
        <Building2 className="h-4 w-4" />
        Identifiers
      </h3>
    </div>
    <div className="p-6 pt-0 space-y-2.5 text-sm leading-normal flex-1">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Exchanges &amp; Symbols</div>
        <ul className="space-y-1">
          <li className="flex justify-between font-mono text-xs">
            <span className="text-muted-foreground">{fmtExLabel(exchange)}</span>
            <span className="font-semibold">{ticker || "—"}</span>
          </li>
          {sedarTicker && (
            <li className="flex justify-between font-mono text-xs">
              <span className="text-muted-foreground">OTCQB</span>
              <span className="font-semibold">{sedarTicker}</span>
            </li>
          )}
        </ul>
      </div>
      <div className="border-t border-border pt-2.5 space-y-1.5">
        <div className="flex justify-between font-mono text-xs">
          <span className="text-muted-foreground">ISIN</span>
          <span className="font-semibold">{isin || "—"}</span>
        </div>
        <div className="flex justify-between font-mono text-xs">
          <span className="text-muted-foreground">CUSIP</span>
          <span className="font-semibold">{cusip || "—"}</span>
        </div>
      </div>
      {transferAgent && (
        <div className="border-t border-border pt-2.5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            {isAsx ? "Share Registry" : "Transfer Agent / Share Registry"}
          </div>
          <p className="text-xs leading-normal font-medium">{transferAgent}</p>
        </div>
      )}
    </div>
  </div>
);

const AboutPanel = ({
  description,
  website,
  headquarters,
}: {
  description: string;
  website: string | null;
  headquarters?: string | null;
}) => {
  const { href, host } = websiteParts(website);

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 space-y-3 text-sm leading-relaxed">
      <p>{description}</p>
      {href && host && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
        >
          <Globe className="h-3.5 w-3.5" />
          {host}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {headquarters && (
        <div className="flex items-start gap-2 text-sm">
          <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Headquarters</div>
            <p>{headquarters}</p>
          </div>
        </div>
      )}
    </div>
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

  return (
    <section className="mt-10">
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
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-medium">
                    <Link className="hover:underline" to={`/insider/${insiderSlug(p.name)}`}>
                      {p.name}
                    </Link>
                  </td>
                  <td className="py-2 text-muted-foreground">{p.title || "—"}</td>
                </tr>
            ))}
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

const NEWS_PAGE_SIZE = 12;
// News and Filings columns cap at the same number of visible cards so the two-up
// layout stays balanced. Logged-out visitors see a few more behind a blurred gate.
const FEED_VISIBLE = 5;
const FEED_LOCKED_TEASER = 3;

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
}) => {
  const sym = ticker && exLabel ? `${exLabel}: ${ticker}` : ticker || exLabel;
  return (
    <Link to={to} className="block border border-border bg-card hover:bg-muted/40 transition-colors px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        {verdict && (
          <span
            className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${
              verdictRound[verdict] || "bg-surface text-muted-foreground"
            }`}
          >
            {verdict}
          </span>
        )}
        {sym && <span className="font-mono text-[11px] font-bold">{sym}</span>}
        <span className="text-[12px] text-muted-foreground truncate max-w-[40%]">· {name}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
          {type}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {time}
        </span>
      </div>
      <p className="text-[13px] leading-snug text-foreground/85 line-clamp-2 break-words min-h-[2.75em]">
        <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
        {summary}
      </p>
    </Link>
  );
};

// Shared footer for the News / Filings columns: signed-in users get a button to the
// full list; logged-out visitors get a blurred teaser of the next few cards behind a
// sign-up gate.
const FeedMoreGate = ({
  isAuthenticated,
  lockedCards,
  moreCount,
  allHref,
  allLabel,
}: {
  isAuthenticated: boolean;
  lockedCards: ReactNode[];
  moreCount: number;
  allHref: string;
  allLabel: string;
}) => {
  if (isAuthenticated) {
    return (
      <div className="flex justify-center mt-4">
        <Link
          to={allHref}
          className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-10 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          {allLabel}
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }
  if (lockedCards.length === 0) return null;
  return (
    <div className="relative mt-2">
      <div className="space-y-2 pointer-events-none select-none blur-sm opacity-70">{lockedCards}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-background/30 via-background/70 to-background">
        <div className="text-center">
          {moreCount > 0 && (
            <p className="text-sm mb-3">
              <span className="font-semibold">{moreCount} more</span> in the full history
            </p>
          )}
          <Link
            to="/register"
            className="inline-flex items-center justify-center gap-2 px-4 h-9 bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90"
          >
            Sign up free to unlock
          </Link>
        </div>
      </div>
    </div>
  );
};

const CompanyNewsColumn = ({ name, ticker, exchange }: { name: string; ticker?: string; exchange?: string }) => {
  const [verdict, setVerdict] = useState<VerdictFilter>("All");
  const [days, setDays] = useState("all");
  const { isAuthenticated } = useAuth();
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
  const filteredAll = newsItems.filter((n) => {
    const v = severityToVerdict(getNewsSeverity(n.sentiment, n.title));
    return (verdict === "All" || v === verdict) && withinDays(n.pubDate, days);
  });
  const visible = filteredAll.slice(0, FEED_VISIBLE);
  const locked = isAuthenticated ? [] : filteredAll.slice(FEED_VISIBLE, FEED_VISIBLE + FEED_LOCKED_TEASER);
  const moreCount = Math.max(0, filteredAll.length - visible.length);

  const renderCard = (n: NewsItem, i: number) => (
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
  );

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
        ) : filteredAll.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No news match these filters.</div>
        ) : (
          <>
            <div className="space-y-2">{visible.map(renderCard)}</div>
            <FeedMoreGate
              isAuthenticated={isAuthenticated}
              lockedCards={locked.map(renderCard)}
              moreCount={moreCount}
              allHref="/news"
              allLabel="View all news"
            />
          </>
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
  const { isAuthenticated } = useAuth();
  const exLabel = fmtExchange(exchange);

  const filteredAll = filings.filter(
    (f) => (verdict === "All" || capVerdict(f.verdict) === verdict) && withinDays(f.created_at, days),
  );
  const visible = filteredAll.slice(0, FEED_VISIBLE);
  const locked = isAuthenticated ? [] : filteredAll.slice(FEED_VISIBLE, FEED_VISIBLE + FEED_LOCKED_TEASER);
  const moreCount = Math.max(0, filteredAll.length - visible.length);

  const renderCard = (f: CompanyFiling) => (
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
  );

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
        ) : filteredAll.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No filings match these filters.</div>
        ) : (
          <>
            <div className="space-y-2">{visible.map(renderCard)}</div>
            <FeedMoreGate
              isAuthenticated={isAuthenticated}
              lockedCards={locked.map(renderCard)}
              moreCount={moreCount}
              allHref="/filings"
              allLabel="View all filings"
            />
          </>
        )}
      </div>
    </div>
  );
};

function insiderSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function isInsiderSell(t: InsiderTransaction): boolean {
  return t.transaction_type === "sale" || t.transaction_type === "disposition";
}

function insiderTxTypeLabel(t: InsiderTransaction): string {
  if (isInsiderSell(t)) return "Sell";
  if (t.transaction_type === "grant") return "Grant";
  if (t.transaction_type === "exercise") return "Exercise";
  return "Buy";
}

function fmtInsiderShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

function fmtInsiderPrice(n: number | null): string {
  if (n == null) return "—";
  return `C$${n.toFixed(2)}`;
}

function fmtInsiderValue(shares: number | null, price: number | null): string {
  if (shares == null || price == null) return "—";
  const v = shares * price;
  if (v >= 1_000_000) return `C$${(v / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (v >= 1_000) return `C$${Math.round(v / 1_000)}K`;
  return `C$${Math.round(v)}`;
}

function fmtInsiderDate(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return d.slice(0, 10);
  return t.toISOString().slice(0, 10);
}

const InsiderTransactionsSection = ({ companyId }: { companyId: number }) => {
  const { data } = useQuery({
    queryKey: ["company-insiders", companyId],
    queryFn: () => fetchCompanyInsiders(companyId),
    enabled: companyId > 0,
    staleTime: 30 * 60 * 1000,
  });

  const transactions = data?.transactions ?? [];
  const registered = data?.registered ?? false;
  const moreTx = (data?.transactionsTotal ?? 0) - transactions.length;

  if (transactions.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          Recent Insider Transactions
        </h2>
        <p className="text-sm text-muted-foreground">No recent insider transactions on file for this company.</p>
        <p className="text-xs text-muted-foreground mt-3 font-mono">Source: SEDI insider reports · last 90 days</p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
        <ShoppingCart className="h-4 w-4" />
        Recent Insider Transactions
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-2">Insider</th>
              <th className="text-left font-medium py-2">Role</th>
              <th className="text-left font-medium py-2">Type</th>
              <th className="text-left font-medium py-2">Date</th>
              <th className="text-right font-medium py-2">Shares</th>
              <th className="text-right font-medium py-2">Price</th>
              <th className="text-right font-medium py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t, i) => {
              const sell = isInsiderSell(t);
              const typeLabel = insiderTxTypeLabel(t);
              return (
                <tr key={`${t.insider_name}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-medium">
                    <Link to={`/insider/${insiderSlug(t.insider_name)}`} className="hover:underline">
                      {t.insider_name}
                    </Link>
                  </td>
                  <td className="py-2 text-muted-foreground">{t.title || "—"}</td>
                  <td className="py-2">
                    <div
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        sell
                          ? "border-red-500/40 text-red-600 dark:text-red-400"
                          : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {typeLabel}
                    </div>
                  </td>
                  <td className="py-2 font-mono text-xs">{fmtInsiderDate(t.transaction_date)}</td>
                  <td className="py-2 text-right font-mono">{fmtInsiderShares(t.shares)}</td>
                  <td className="py-2 text-right font-mono">{fmtInsiderPrice(t.price)}</td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {fmtInsiderValue(t.shares, t.price)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!registered && moreTx > 0 && (
        <p className="text-center mt-3">
          <Link to="/register" className="text-[12px] font-mono uppercase tracking-widest text-accent hover:underline">
            Sign up free to see all {data?.transactionsTotal} transactions →
          </Link>
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-3 font-mono">Source: SEDI insider reports · last 90 days</p>
    </section>
  );
};

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-purple-100 text-purple-700",
];

function avatarInitials(email: string): string {
  const handle = email.split("@")[0] || "U";
  return handle.slice(0, 2).toUpperCase();
}

function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h + email.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

const DiscussionSection = ({ companyId, ticker }: { companyId: number; ticker: string }) => {
  const { isAuthenticated, user } = useAuth();
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingPost, setPendingPost] = useState(false);
  const [sort, setSort] = useState<"new" | "top">("new");

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

  const sorted = [...comments].sort((a, b) =>
    sort === "top" ? b.score - a.score : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <>
      <section className="mt-10">
        <div className="flex items-end justify-between mb-6 border-b border-border pb-4">
          <div>
            <h2 className="font-display text-2xl tracking-tight leading-none flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Discussion
            </h2>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1.5">
              {comments.length} {comments.length === 1 ? "post" : "posts"}
            </p>
          </div>
          <div className="flex bg-muted rounded p-0.5">
            <button
              type="button"
              onClick={() => setSort("new")}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-sm transition-colors ${
                sort === "new" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              new
            </button>
            <button
              type="button"
              onClick={() => setSort("top")}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-sm transition-colors ${
                sort === "top" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              top
            </button>
          </div>
        </div>

        <div className="mb-8 bg-card border border-border p-3 shadow-sm">
          <form onSubmit={handlePost}>
            <div className="flex gap-3">
              <div
                className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold ${
                  user?.email ? avatarColor(user.email) : "bg-muted text-muted-foreground"
                }`}
              >
                {user?.email ? avatarInitials(user.email) : "YO"}
              </div>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={`Share an insight on ${ticker}...`}
                rows={2}
                maxLength={2000}
                className="flex w-full rounded-md border border-input ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 bg-transparent border-none focus-visible:ring-0 px-0 py-2 text-sm resize-none min-h-0 shadow-none"
              />
            </div>
            <div className="flex justify-end items-center mt-3 pt-3 border-t border-border">
              <button
                type="submit"
                disabled={posting || !commentText.trim()}
                className="bg-foreground text-background font-mono text-[11px] font-bold px-5 py-2 uppercase tracking-wider hover:bg-foreground/90 transition-colors disabled:opacity-40"
              >
                Post
              </button>
            </div>
          </form>
        </div>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No comments yet. Be the first to discuss {ticker}.
          </p>
        ) : (
          <div className="space-y-6">
            {sorted.map((c) => (
              <article key={c.id} className="flex gap-3 pb-6 border-b border-border last:border-0">
                <div
                  className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold ${avatarColor(c.userEmail)}`}
                >
                  {avatarInitials(c.userEmail)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                    <span className="font-mono text-[13px] font-bold underline decoration-border underline-offset-4">
                      {emailToHandle(c.userEmail)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground uppercase">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground/90">{c.body}</p>
                  <div className="flex items-center gap-6 mt-3">
                    <button
                      type="button"
                      onClick={() => handleVote(c, 1)}
                      className="flex items-center gap-1.5 group"
                      aria-label="Like"
                    >
                      <Heart
                        className={`h-4 w-4 transition-colors ${
                          c.userVote === 1
                            ? "text-rose-500 fill-rose-500"
                            : "text-muted-foreground/60 group-hover:text-rose-500"
                        }`}
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">{c.score}</span>
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
                      aria-label="Reply"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span className="font-mono text-[11px]">0</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {comments.length > 0 && (
          <button
            type="button"
            className="w-full mt-8 py-3 border border-border text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:bg-muted transition-colors"
          >
            Load older discussions
          </button>
        )}
      </section>

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
