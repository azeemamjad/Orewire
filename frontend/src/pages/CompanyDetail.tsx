import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Globe,
  Newspaper,
  MessageSquare,
  Users,
  UserCheck,
  Building,
  ExternalLink,
} from "lucide-react";
import { fetchCompany } from "@/lib/api";
import { useEffect, useRef, useState } from "react";

const verdictPill: Record<string, string> = {
  Noteworthy: "bg-noteworthy text-noteworthy-foreground",
  Watch: "bg-watch text-watch-foreground",
  Routine: "bg-routine text-routine-foreground",
};

type ChartPeriod = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";

const TradingViewChart = ({ symbol, exchange }: { symbol: string; exchange: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<ChartPeriod>("3M");

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const tvExchange = exchange.toUpperCase().replace("-", "");
    const tvSymbol = `${tvExchange}:${symbol.toUpperCase()}`;

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      new (window as any).TradingView.widget({
        container_id: containerRef.current?.id,
        symbol: tvSymbol,
        interval:
          period === "1D"
            ? "15"
            : period === "1W"
              ? "60"
              : period === "1M"
                ? "240"
                : period === "3M"
                  ? "D"
                  : period === "1Y"
                    ? "W"
                    : "M",
        timezone: "America/Toronto",
        theme: "light",
        style: "3",
        locale: "en",
        toolbar_bg: "#f1f3f6",
        enable_publishing: false,
        hide_top_toolbar: true,
        hide_legend: false,
        withdateranges: false,
        save_image: false,
        backgroundColor: "#ffffff",
        gridColor: "#f0f0f0",
        studies: [],
        show_popup_button: false,
        autosize: true,
      });
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [symbol, exchange, period]);

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="font-display text-sm font-semibold">Price</span>
        <div className="flex gap-1">
          {(["1D", "1W", "1M", "3M", "1Y", "5Y"] as ChartPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded transition-colors ${
                period === p
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div id={`tv-chart-${symbol}`} ref={containerRef} className="h-[320px] w-full" />
    </div>
  );
};

const CompanyDetail = () => {
  const { id } = useParams();
  const companyId = parseInt(id || "0", 10);

  const { data, isLoading } = useQuery({
    queryKey: ["company", companyId],
    queryFn: () => fetchCompany(companyId),
    enabled: companyId > 0,
  });

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading company profile...</div>
      </div>
    );
  }

  const md = data.marketData;
  const isUp = md && md.change_pct !== null && md.change_pct >= 0;
  const isDown = md && md.change_pct !== null && md.change_pct < 0;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8">
        {/* Breadcrumb */}
        <div className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span>/</span>
          <Link to="/companies" className="hover:text-foreground">
            Companies
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">
            {data.exchange}:{data.ticker || data.name}
          </span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-xs font-bold px-2 py-1 bg-surface border border-border rounded">
              {data.exchange}:{data.ticker || "N/A"}
            </span>
            {data.has_gold > 0 && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                Gold
              </span>
            )}
            {md?.country && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface text-muted-foreground border border-border">
                {md.country}
              </span>
            )}
          </div>

          <h1 className="font-display text-3xl lg:text-4xl font-extrabold mb-2">
            {data.name}
          </h1>

          {md && md.price !== null && (
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-mono font-bold">
                {md.currency === "USD" ? "$" : md.currency === "CAD" || md.currency === "C$" ? "C$" : "$"}
                {md.price?.toFixed(3)}
              </span>
              {md.change_pct !== null && (
                <span
                  className={`flex items-center gap-1 font-mono text-sm font-semibold ${
                    isUp ? "text-[hsl(var(--up))]" : isDown ? "text-[hsl(var(--down))]" : "text-muted-foreground"
                  }`}
                >
                  {isUp ? (
                    <ArrowUpRight className="w-4 h-4" />
                  ) : isDown ? (
                    <ArrowDownRight className="w-4 h-4" />
                  ) : (
                    <Minus className="w-4 h-4" />
                  )}
                  {md.change_abs !== null && md.change_abs >= 0 ? "+" : ""}
                  {md.change_abs?.toFixed(3)} ({md.change_pct >= 0 ? "+" : ""}
                  {md.change_pct?.toFixed(2)}%)
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {md.currency === "USD" ? "US$" : "C$"} · Live · Delayed
              </span>
            </div>
          )}

          {md?.error && (
            <div className="text-sm text-muted-foreground mt-2">
              Price data unavailable: {md.error}
            </div>
          )}
        </div>

        {/* Chart + Stats */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 mb-10">
          {data.ticker && data.exchange && (
            <TradingViewChart symbol={data.ticker} exchange={data.exchange} />
          )}

          <div className="space-y-6">
            {/* Key Stats */}
            <div className="border border-border rounded-lg bg-surface">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Key Stats
                </h3>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <StatRow label="Volume" value={md?.volume ? md.volume.toLocaleString() : "—"} />
                <StatRow label="Avg Vol (30D)" value="—" />
                <StatRow label="Market Cap" value={data.market_cap ? `C$${(data.market_cap / 1e6).toFixed(1)}M` : "—"} />
                <StatRow label="Shares Out" value={data.total_float ? `${(data.total_float / 1e6).toFixed(1)}M` : "—"} />
                <StatRow
                  label="52W High"
                  value={md?.price_52_week_high ? `C$${md.price_52_week_high.toFixed(2)}` : "—"}
                />
                <StatRow
                  label="52W Low"
                  value={md?.price_52_week_low ? `C$${md.price_52_week_low.toFixed(2)}` : "—"}
                />
              </div>
            </div>

            {/* Identifiers */}
            <div className="border border-border rounded-lg bg-surface">
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <Building className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Identifiers
                </h3>
              </div>
              <div className="px-5 py-4">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Exchanges &amp; Symbols
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    <IdRow label={data.exchange || "—"} value={data.ticker || "—"} />
                    <IdRow label="OTCQB" value="—" />
                    <IdRow label="FRA" value="—" />
                  </tbody>
                </table>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-4 mb-2">
                  ISIN
                </div>
                <div className="font-mono text-sm text-muted-foreground">—</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-4 mb-2">
                  CUSIP
                </div>
                <div className="font-mono text-sm text-muted-foreground">—</div>
              </div>
            </div>
          </div>
        </div>

        {/* Performance */}
        {md && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
            <PerfCard label="1 Week" value={md.perf_week} />
            <PerfCard label="1 Month" value={md.perf_month} />
            <PerfCard label="YTD" value={md.perf_ytd} />
            <PerfCard label="1 Year" value={md.perf_year} />
            <div className="border border-border rounded-lg bg-surface p-4 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Sector
              </div>
              <div className="text-sm font-semibold">{md.sector || data.sector || "—"}</div>
            </div>
            <div className="border border-border rounded-lg bg-surface p-4 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Analyst
              </div>
              <div className="text-sm font-semibold">
                {md.recommend !== null
                  ? md.recommend > 0
                    ? "Buy"
                    : md.recommend < 0
                      ? "Sell"
                      : "Hold"
                  : "—"}
              </div>
            </div>
          </div>
        )}

        {/* News */}
        <Section icon={<Newspaper className="w-4 h-4" />} title="News">
          <div className="text-sm text-muted-foreground py-4">
            News feed requires an external news API integration (e.g., NewsAPI, Bing News, or
            RSS feeds).
          </div>
        </Section>

        {/* Filings */}
        {data.filings.length > 0 && (
          <Section icon={<Globe className="w-4 h-4" />} title="Filings">
            <ul className="divide-y divide-border">
              {data.filings.map((f) => (
                <li key={f.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {f.verdict && (
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest font-bold rounded-full ${
                            verdictPill[f.verdict] || "bg-surface text-muted-foreground"
                          }`}
                        >
                          {f.verdict}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(f.created_at).toLocaleDateString()}
                      </span>
                      <span className="font-mono text-xs font-bold text-foreground/80">
                        {f.filing_type || "Filing"}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/70 line-clamp-2">{f.summary || "No summary available"}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Ownership */}
        <Section icon={<Users className="w-4 h-4" />} title="Ownership">
          <div className="text-sm text-muted-foreground py-4">
            Ownership data requires SEDI (Canada) or ASX insider holdings API integration.
          </div>
        </Section>

        {/* Insider Buying */}
        <Section icon={<UserCheck className="w-4 h-4" />} title="Recent Insider Buying">
          <div className="text-sm text-muted-foreground py-4">
            Insider buying data requires SEDI insider report API integration.
          </div>
        </Section>

        {/* Discussion */}
        <Section icon={<MessageSquare className="w-4 h-4" />} title="Discussion">
          <div className="text-sm text-muted-foreground py-4">
            Discussion forum requires a comment/post database and user authentication system.
          </div>
        </Section>

        {/* About */}
        <div className="border border-border rounded-lg bg-surface mb-10">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="font-display text-lg font-bold">About {data.ticker || data.name}</h3>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed mb-4">
              {md?.description || `${data.name} is a ${data.sector || "mining"} company listed on the ${data.exchange || "exchange"}.`}
            </p>
            {md?.country && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ExternalLink className="w-3.5 h-3.5" />
                <span>
                  {md.country} · {data.sector || "Mining"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono font-medium">{value}</span>
  </div>
);

const IdRow = ({ label, value }: { label: string; value: string }) => (
  <tr>
    <td className="py-2 text-muted-foreground">{label}</td>
    <td className="py-2 text-right font-mono font-medium">{value}</td>
  </tr>
);

const PerfCard = ({ label, value }: { label: string; value: number | null }) => {
  const up = value !== null && value >= 0;
  const down = value !== null && value < 0;
  return (
    <div className="border border-border rounded-lg bg-surface p-4 text-center">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div
        className={`text-sm font-bold font-mono flex items-center justify-center gap-1 ${
          up ? "text-[hsl(var(--up))]" : down ? "text-[hsl(var(--down))]" : "text-foreground"
        }`}
      >
        {up ? <TrendingUp className="w-3 h-3" /> : down ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
        {value !== null ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—"}
      </div>
    </div>
  );
};

const Section = ({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="border border-border rounded-lg bg-surface mb-6">
    <div className="px-5 py-3 border-b border-border flex items-center gap-2">
      {icon}
      <h3 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
    </div>
    {children}
  </div>
);

export default CompanyDetail;
