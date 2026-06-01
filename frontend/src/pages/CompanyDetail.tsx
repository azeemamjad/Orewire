import { useParams, Link } from "react-router-dom";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Globe,
  Newspaper,
  Clock,
  ChevronRight,
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
  Activity,
  ChartLine,
  ChartCandlestick,
} from "lucide-react";
import { fetchCompany, fetchCompanyProfile, fetchDiscussions, postDiscussion, voteDiscussion, fetchCompanyNews, fetchMarketHistory, login as apiLogin, register as apiRegister, companySlug, type CompanyPerson, type Discussion, type NewsItem, type MarketHistoryPoint } from "@/lib/api";
import { NewsArticleCard, getNewsSeverity, getNewsTags } from "@/components/site/NewsArticleCard";
import { useAuth } from "@/hooks/use-auth";
import { useState, useMemo, useEffect } from "react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import Footer from "@/components/site/Footer";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Bar, Cell } from "recharts";

import { checkWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/api";

const verdictPill: Record<string, string> = {
  Noteworthy: "bg-noteworthy text-noteworthy-foreground",
  Watch: "bg-watch text-watch-foreground",
  Routine: "bg-routine text-routine-foreground",
};

type ChartPeriod = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "All";

const periodDays: Record<ChartPeriod, number> = {
  "1m": 1, "5m": 1, "15m": 1, "30m": 1, "1h": 1, "4h": 1,
  "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180, "YTD": 150, "1Y": 365, "5Y": 1825, "All": 2500,
};

interface ChartPoint {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  isUp: boolean;
  wickRange: [number, number];
  bodyRange: [number, number];
}

function formatDateLabel(t: Date, period: ChartPeriod): string {
  const isIntraday = ["1m", "5m", "15m", "30m", "1h", "4h"].includes(period);
  if (isIntraday) {
    return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  }
  if (periodDays[period] <= 7) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${dayNames[t.getDay()]} ${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }
  if (periodDays[period] <= 365) {
    return `${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[t.getMonth()]} '${String(t.getFullYear()).slice(2)}`;
}

function generateChartData(price: number, period: ChartPeriod): ChartPoint[] {
  const points: ChartPoint[] = [];
  const now = new Date();
  const isIntraday = ["1m", "5m", "15m", "30m", "1h", "4h"].includes(period);
  const intervalMinutes: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };

  let count: number;
  let stepMs: number;

  if (isIntraday) {
    const mins = intervalMinutes[period] || 60;
    count = Math.floor((6.5 * 60) / mins);
    stepMs = mins * 60 * 1000;
  } else {
    const days = periodDays[period];
    count = Math.max(30, Math.min(days, 90));
    stepMs = (days / count) * 24 * 60 * 60 * 1000;
  }

  let p = price * (0.65 + Math.random() * 0.2);
  const drift = (price - p) / count;
  const volatility = price * 0.025;

  for (let i = 0; i < count; i++) {
    const t = new Date(now.getTime() - (count - i) * stepMs);
    const noise = (Math.random() - 0.45) * price * 0.04;
    const open = p;
    p += drift + noise;
    p = Math.max(p, price * 0.4);
    const close = p;
    const high = Math.max(open, close) + Math.random() * volatility;
    const low = Math.min(open, close) - Math.random() * volatility;
    const isUp = close >= open;

    points.push({
      date: formatDateLabel(t, period),
      price: parseFloat(close.toFixed(3)),
      open: parseFloat(open.toFixed(3)),
      high: parseFloat(high.toFixed(3)),
      low: parseFloat(Math.max(low, 0).toFixed(3)),
      close: parseFloat(close.toFixed(3)),
      isUp,
      wickRange: [parseFloat(Math.max(low, 0).toFixed(3)), parseFloat(high.toFixed(3))],
      bodyRange: isUp ? [parseFloat(open.toFixed(3)), parseFloat(close.toFixed(3))] : [parseFloat(close.toFixed(3)), parseFloat(open.toFixed(3))],
    });
  }

  const lastOpen = p;
  const isUp = price >= lastOpen;
  const high = Math.max(lastOpen, price) + Math.random() * volatility;
  const low = Math.max(Math.min(lastOpen, price) - Math.random() * volatility, 0);
  points.push({
    date: formatDateLabel(now, period),
    price,
    open: parseFloat(lastOpen.toFixed(3)),
    high: parseFloat(high.toFixed(3)),
    low: parseFloat(low.toFixed(3)),
    close: price,
    isUp,
    wickRange: [parseFloat(low.toFixed(3)), parseFloat(high.toFixed(3))],
    bodyRange: isUp ? [parseFloat(lastOpen.toFixed(3)), price] : [price, parseFloat(lastOpen.toFixed(3))],
  });
  return points;
}

const CandlestickBar = (props: any) => {
  const { x, width, payload } = props;
  if (!payload) return null;
  const { wickRange, bodyRange, isUp } = payload;
  const yScale = props.yAxis?.scale || props.background?.yAxis?.scale;
  if (!yScale) return null;

  const color = isUp ? "hsl(var(--up))" : "hsl(var(--down))";
  const wickX = x + width / 2;
  const wickTop = yScale(wickRange[1]);
  const wickBottom = yScale(wickRange[0]);
  const bodyTop = yScale(bodyRange[1]);
  const bodyBottom = yScale(bodyRange[0]);
  const bodyH = Math.max(bodyBottom - bodyTop, 1);

  return (
    <g>
      <line x1={wickX} y1={wickTop} x2={wickX} y2={wickBottom} stroke={color} strokeWidth={1} />
      <rect x={x} y={bodyTop} width={width} height={bodyH} fill={color} />
    </g>
  );
};

type ChartStyle = "area" | "line" | "candles";

const mainPeriods: ChartPeriod[] = ["1D", "1W", "1M", "3M", "1Y", "All"];

const PriceChart = ({ price, historyPoints }: { price: number; historyPoints?: MarketHistoryPoint[] }) => {
  const [period, setPeriod] = useState<ChartPeriod>("3M");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("area");
  const [showMore, setShowMore] = useState(false);

  const chartData = useMemo(() => {
    const points = historyPoints || [];
    const mapped = points
      .map((p) => {
        if (p.close == null || p.open == null || p.high == null || p.low == null) return null;
        const t = new Date(p.ts);
        const label = formatDateLabel(t, period);
        const isUp = p.close >= p.open;
        return {
          date: label,
          price: parseFloat(p.close.toFixed(3)),
          open: parseFloat(p.open.toFixed(3)),
          high: parseFloat(p.high.toFixed(3)),
          low: parseFloat(Math.max(p.low, 0).toFixed(3)),
          close: parseFloat(p.close.toFixed(3)),
          isUp,
          wickRange: [parseFloat(Math.max(p.low, 0).toFixed(3)), parseFloat(p.high.toFixed(3))] as [number, number],
          bodyRange: (isUp
            ? [parseFloat(p.open.toFixed(3)), parseFloat(p.close.toFixed(3))]
            : [parseFloat(p.close.toFixed(3)), parseFloat(p.open.toFixed(3))]) as [number, number],
        };
      })
      .filter(Boolean) as ChartPoint[];
    if (mapped.length > 1) return mapped;
    return generateChartData(price, period);
  }, [price, period, historyPoints]);

  const minPrice = Math.min(...chartData.map((d) => d.low));
  const maxPrice = Math.max(...chartData.map((d) => d.high));
  const padding = (maxPrice - minPrice) * 0.1 || 0.01;

  const isMainPeriod = mainPeriods.includes(period);

  const selectPeriod = (p: ChartPeriod) => {
    setPeriod(p);
    setShowMore(false);
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="space-y-1.5 p-6 pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 relative">
            {mainPeriods.map((p) => (
              <button
                key={p}
                onClick={() => selectPeriod(p)}
                className={`text-[11px] font-mono px-2.5 py-1 rounded-sm transition-colors ${
                  period === p
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setShowMore(!showMore)}
              className={`text-[11px] font-mono px-2 py-1 rounded-sm flex items-center gap-0.5 transition-colors ${
                !isMainPeriod
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {!isMainPeriod ? period : "More"}
              <ChevronDown className="h-3 w-3" />
            </button>

            {showMore && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-md shadow-lg p-3 w-48">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Intraday</div>
                  <div className="grid grid-cols-3 gap-1 mb-3">
                    {(["1m", "5m", "15m", "30m", "1h", "4h"] as ChartPeriod[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => selectPeriod(p)}
                        className={`text-[11px] font-mono px-2 py-1.5 rounded-sm transition-colors text-center ${
                          period === p
                            ? "bg-background text-foreground shadow-sm border border-border"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Extended</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(["6M", "YTD", "5Y"] as ChartPeriod[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => selectPeriod(p)}
                        className={`text-[11px] font-mono px-2 py-1.5 rounded-sm transition-colors text-center ${
                          period === p
                            ? "bg-background text-foreground shadow-sm border border-border"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Chart style selector */}
          <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
            <button
              title="Area"
              aria-label="Area"
              onClick={() => setChartStyle("area")}
              className={`p-1.5 rounded-sm transition-colors ${chartStyle === "area" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Activity className="h-3.5 w-3.5" />
            </button>
            <button
              title="Line"
              aria-label="Line"
              onClick={() => setChartStyle("line")}
              className={`p-1.5 rounded-sm transition-colors ${chartStyle === "line" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ChartLine className="h-3.5 w-3.5" />
            </button>
            <button
              title="Candles"
              aria-label="Candles"
              onClick={() => setChartStyle("candles")}
              className={`p-1.5 rounded-sm transition-colors ${chartStyle === "candles" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ChartCandlestick className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      <div className="p-6 pt-0">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            {chartStyle === "candles" ? (
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "hsl(var(--muted-foreground))" }}
                  tickLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis
                  domain={[minPrice - padding, maxPrice + padding]}
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "hsl(var(--muted-foreground))" }}
                  tickLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={48}
                  yAxisId="price"
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: "JetBrains Mono",
                  }}
                  formatter={(_v: any, name: string, props: any) => {
                    const d = props.payload;
                    if (name === "wickRange") return [`O: $${d.open.toFixed(3)} H: $${d.high.toFixed(3)} L: $${d.low.toFixed(3)} C: $${d.close.toFixed(3)}`, "OHLC"];
                    return null;
                  }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}
                />
                <Bar dataKey="wickRange" yAxisId="price" barSize={1}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.isUp ? "hsl(var(--up))" : "hsl(var(--down))"} />
                  ))}
                </Bar>
                <Bar dataKey="bodyRange" yAxisId="price" barSize={6}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.isUp ? "hsl(var(--up))" : "hsl(var(--down))"} />
                  ))}
                </Bar>
              </ComposedChart>
            ) : (
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(152, 60%, 36%)" stopOpacity={chartStyle === "line" ? 0 : 0.25} />
                    <stop offset="100%" stopColor="hsl(152, 60%, 36%)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "hsl(var(--muted-foreground))" }}
                  tickLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis
                  domain={[minPrice - padding, maxPrice + padding]}
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "hsl(var(--muted-foreground))" }}
                  tickLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: "JetBrains Mono",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(3)}`, "Price"]}
                  labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="hsl(152, 60%, 36%)"
                  strokeWidth={1.5}
                  fill={chartStyle === "line" ? "none" : "url(#priceGrad)"}
                  dot={false}
                  activeDot={{ r: 3, fill: "hsl(152, 60%, 36%)", strokeWidth: 0 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};


const placeholderOwnership = [
  { holder: "Management & Directors", shares: "74.0M", pct: "14.2%", bar: 14.2 },
  { holder: "Eric Sprott (HoldCo)", shares: "51.1M", pct: "9.8%", bar: 9.8 },
  { holder: "Institutional", shares: "117.2M", pct: "22.5%", bar: 22.5 },
  { holder: "Retail / Other", shares: "278.7M", pct: "53.5%", bar: 53.5 },
];

const placeholderInsiders = [
  { insider: "P. Donnelly", role: "CEO", date: "2026-05-12", shares: "250K", price: "C$0.39", value: "C$98K" },
  { insider: "A. Chen", role: "Director", date: "2026-05-09", shares: "100K", price: "C$0.38", value: "C$38K" },
  { insider: "Eric Sprott (HoldCo)", role: "10% Holder", date: "2026-05-08", shares: "1.50M", price: "C$0.38", value: "C$570K" },
  { insider: "M. Larkin", role: "CFO", date: "2026-04-22", shares: "75K", price: "C$0.31", value: "C$23K" },
  { insider: "R. Patel", role: "VP Exploration", date: "2026-04-15", shares: "40K", price: "C$0.29", value: "C$12K" },
];

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
  const [expandedFilingId, setExpandedFilingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["company", slug],
    queryFn: () => fetchCompany(slug!),
    enabled: !!slug,
  });

  const { data: companyHistory } = useQuery({
    queryKey: ["market-history", "company", data?.ticker, data?.exchange],
    queryFn: () => fetchMarketHistory("company", data?.ticker || "", { exchange: (data?.exchange || "").toUpperCase().replace("-", "") }),
    enabled: !!data?.ticker && !!data?.exchange,
    refetchInterval: 30 * 60 * 1000,
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
          {md && md.price !== null && (
            <PriceChart price={md.price} historyPoints={companyHistory?.points} />
          )}

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

        {/* News */}
        <CompanyNewsSection name={data.name} ticker={data.ticker || undefined} exchange={data.exchange || undefined} />

        {/* Filings */}
        {data.filings.length > 0 && (
          <Section icon={<Globe className="w-4 h-4" />} title="Filings">
            <ul className="divide-y divide-border">
              {data.filings.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedFilingId((prev) => (prev === f.id ? null : f.id))}
                    className="w-full text-left px-5 py-3.5 hover:bg-background/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {f.verdict && (
                        <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest font-bold rounded-full ${verdictPill[f.verdict] || "bg-surface text-muted-foreground"}`}>
                          {f.verdict}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(f.created_at).toLocaleDateString("en-CA")}
                      </span>
                      <span className="font-mono text-xs font-bold text-foreground/80 uppercase">
                        {f.filing_type || "Filing"}
                      </span>
                      <ChevronDown className={`ml-auto w-3.5 h-3.5 text-muted-foreground transition-transform ${expandedFilingId === f.id ? "rotate-180" : ""}`} />
                    </div>
                    <p className={`text-sm text-foreground/70 ${expandedFilingId === f.id ? "" : "line-clamp-2"}`}>
                      {f.summary || "No summary available"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Ownership */}
        <Section icon={<Users className="w-4 h-4" />} title="Ownership">
          <table className="w-full text-sm">
            <thead>
              <tr className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left px-5 py-2 font-medium">Holder</th>
                <th className="text-right py-2 font-medium">Shares</th>
                <th className="text-right py-2 font-medium">% Out</th>
                <th className="text-left px-5 py-2 font-medium">Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {placeholderOwnership.map((o) => (
                <tr key={o.holder}>
                  <td className="px-5 py-2.5 font-medium">{o.holder}</td>
                  <td className="py-2.5 text-right font-mono">{o.shares}</td>
                  <td className="py-2.5 text-right font-mono">{o.pct}</td>
                  <td className="px-5 py-2.5">
                    <div className="w-full bg-border h-2.5">
                      <div className="bg-primary h-2.5" style={{ width: `${o.bar}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Recent Insider Transactions */}
        <Section icon={<UserCheck className="w-4 h-4" />} title="Recent Insider Transactions">
          <table className="w-full text-sm">
            <thead>
              <tr className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left px-5 py-2 font-medium">Insider</th>
                <th className="text-left py-2 font-medium">Role</th>
                <th className="text-left py-2 font-medium">Date</th>
                <th className="text-right py-2 font-medium">Shares</th>
                <th className="text-right py-2 font-medium">Price</th>
                <th className="text-right px-5 py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {placeholderInsiders.map((ins) => (
                <tr key={ins.insider + ins.date}>
                  <td className="px-5 py-2.5 font-medium">{ins.insider}</td>
                  <td className="py-2.5 text-muted-foreground">{ins.role}</td>
                  <td className="py-2.5 font-mono text-muted-foreground">{ins.date}</td>
                  <td className="py-2.5 text-right font-mono">{ins.shares}</td>
                  <td className="py-2.5 text-right font-mono">{ins.price}</td>
                  <td className="px-5 py-2.5 text-right font-mono font-bold text-[hsl(var(--up))]">{ins.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-2 border-t border-border">
            <span className="font-mono text-[10px] text-muted-foreground">Source: SEDI insider reports · last 90 days</span>
          </div>
        </Section>

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

const CompanyNewsSection = ({ name, ticker, exchange }: { name: string; ticker?: string; exchange?: string }) => {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ["company-news", name, ticker],
    queryFn: ({ pageParam }) =>
      fetchCompanyNews(name, ticker, exchange, { limit: NEWS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 30 * 60 * 1000,
  });
  const newsItems = data?.pages.flatMap((p) => p.items) ?? [];
  const hasMore = !!hasNextPage;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border flex items-center gap-2">
        <Newspaper className="h-4 w-4" />
        News Releases
      </h2>
      {isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading news…</div>
      ) : newsItems.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">No recent news found.</div>
      ) : (
        <div className="space-y-3">
          {newsItems.map((n, i) => (
            <NewsArticleCard
              key={`${n.link}-${i}`}
              title={n.title}
              summary={n.summary}
              source={n.source}
              timeAgo={n.timeAgo}
              link={n.link}
              severity={getNewsSeverity(n.sentiment, n.title)}
              tags={getNewsTags(n.title, n.commodity)}
            />
          ))}
          {hasMore && (
            <div className="pt-6 pb-2 flex justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="group inline-flex items-center gap-2 border border-border bg-card px-5 h-10 text-xs font-mono uppercase tracking-[0.18em] text-foreground/80 hover:text-accent-foreground hover:bg-accent hover:border-accent disabled:opacity-50 disabled:hover:bg-card disabled:hover:text-foreground/80 disabled:hover:border-border transition-all shadow-sm hover:shadow"
              >
                {isFetchingNextPage ? (
                  <>
                    <span className="w-3 h-3 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                    Loading
                  </>
                ) : (
                  <>
                    Show {NEWS_PAGE_SIZE} more
                    <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover:translate-y-0.5" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="h-8" />
    </section>
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
