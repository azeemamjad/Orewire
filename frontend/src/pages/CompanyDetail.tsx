import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Globe,
  Newspaper,
  MessageSquare,
  Users,
  UserCheck,
  Building,
  ExternalLink,
  Plus,
  Bell,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { fetchCompany } from "@/lib/api";
import { useState, useMemo } from "react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import Footer from "@/components/site/Footer";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

function generateChartData(price: number, period: ChartPeriod) {
  const points: { date: string; price: number }[] = [];
  const now = new Date();
  const isIntraday = ["1m", "5m", "15m", "30m", "1h", "4h"].includes(period);

  const intervalMinutes: Record<string, number> = {
    "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240,
  };

  let count: number;
  let stepMs: number;

  if (isIntraday) {
    const mins = intervalMinutes[period] || 60;
    const totalMins = period === "4h" ? 6.5 * 60 : 6.5 * 60;
    count = Math.floor(totalMins / mins);
    stepMs = mins * 60 * 1000;
  } else {
    const days = periodDays[period];
    count = Math.min(days, 120);
    count = Math.max(count, 30);
    stepMs = (days / count) * 24 * 60 * 60 * 1000;
  }

  let p = price * (0.65 + Math.random() * 0.2);
  const drift = (price - p) / count;

  for (let i = 0; i < count; i++) {
    const t = new Date(now.getTime() - (count - i) * stepMs);
    const noise = (Math.random() - 0.45) * price * 0.04;
    p += drift + noise;
    p = Math.max(p, price * 0.4);

    let label: string;
    if (isIntraday) {
      label = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    } else if (periodDays[period] <= 7) {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      label = `${dayNames[t.getDay()]} ${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    } else if (periodDays[period] <= 365) {
      label = `${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    } else {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      label = `${monthNames[t.getMonth()]} '${String(t.getFullYear()).slice(2)}`;
    }

    points.push({ date: label, price: parseFloat(p.toFixed(3)) });
  }

  const nowLabel = isIntraday
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  points.push({ date: nowLabel, price });
  return points;
}

const PriceChart = ({ price }: { price: number }) => {
  const [period, setPeriod] = useState<ChartPeriod>("3M");

  const chartData = useMemo(
    () => generateChartData(price, period),
    [price, period],
  );

  const minPrice = Math.min(...chartData.map((d) => d.price));
  const maxPrice = Math.max(...chartData.map((d) => d.price));
  const padding = (maxPrice - minPrice) * 0.1 || 0.01;

  const periods: ChartPeriod[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"];

  return (
    <div className="border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="font-display text-sm font-semibold">Price</span>
        <div className="flex gap-1 flex-wrap">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-[11px] font-mono font-medium transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[320px] w-full px-1 pb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152, 60%, 36%)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(152, 60%, 36%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", fill: "hsl(220, 12%, 50%)" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis
              domain={[minPrice - padding, maxPrice + padding]}
              tick={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", fill: "hsl(152, 50%, 32%)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(0, 0%, 100%)",
                border: "1px solid hsl(220, 14%, 86%)",
                borderRadius: 0,
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
              }}
              formatter={(value: number) => [`$${value.toFixed(3)}`, "Price"]}
              labelStyle={{ color: "hsl(220, 12%, 38%)", fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="hsl(152, 60%, 36%)"
              strokeWidth={1.5}
              fill="url(#priceGrad)"
              dot={false}
              activeDot={{ r: 3, fill: "hsl(152, 60%, 36%)", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const placeholderNews = [
  { source: "Globe & Mail", time: "2h ago", headline: "Scorpio Gold extends Hercules drill program after 12.4m @ 3.2 g/t Au hit" },
  { source: "Northern Miner", time: "1d ago", headline: "Junior gold M&A pace accelerates in Ontario greenstone belt" },
  { source: "Stockhouse", time: "2d ago", headline: "SCZ closes C$8.5M bought-deal financing at C$0.38" },
  { source: "Kitco", time: "4d ago", headline: "Gold above $2,800 lifts Canadian explorer index 6.2% on the week" },
];

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

const placeholderComments = [
  { user: "@ore_hunter", time: "12m", votes: 24, text: "12.4m @ 3.2 anywhere else in the camp would be a 30% day. Float is the only reason this isn't moving harder." },
  { user: "@yyz_geo", time: "1h", votes: 17, text: "Section 4200E is interesting — looks like they're chasing a high-grade shoot pluging SE. Watch the 25-12 follow-up holes." },
  { user: "@smallcap_dan", time: "3h", votes: 8, text: "Financing closes 22nd. Anyone know if Sprott took the lead order again?" },
];

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
              <button className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium border border-border bg-surface hover:bg-muted transition-colors">
                <Plus className="w-3 h-3" /> Watchlist
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
            <PriceChart price={md.price} />
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

        {/* News */}
        <Section icon={<Newspaper className="w-4 h-4" />} title="News">
          <ul className="divide-y divide-border">
            {placeholderNews.map((n, i) => (
              <li key={i} className="px-5 py-3.5">
                <div className="font-mono text-[10px] text-muted-foreground mb-1">
                  {n.source} · {n.time}
                </div>
                <p className="text-sm font-medium">{n.headline}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* Filings */}
        {data.filings.length > 0 && (
          <Section icon={<Globe className="w-4 h-4" />} title="Filings">
            <ul className="divide-y divide-border">
              {data.filings.map((f) => (
                <li key={f.id} className="px-5 py-3.5">
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
                  </div>
                  <p className="text-sm text-foreground/70 line-clamp-2">{f.summary || "No summary available"}</p>
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

        {/* Recent Insider Buying */}
        <Section icon={<UserCheck className="w-4 h-4" />} title="Recent Insider Buying">
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
        <Section icon={<MessageSquare className="w-4 h-4" />} title="Discussion">
          <div className="px-5 py-3 border-b border-border">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={`Discuss ${data.ticker || data.name}...`}
                className="flex-1 bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent"
                disabled
              />
              <button className="px-4 h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 transition-colors">
                Post
              </button>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {placeholderComments.map((c, i) => (
              <li key={i} className="px-5 py-3.5">
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <button className="hover:text-foreground"><ThumbsUp className="w-3 h-3" /></button>
                    <span className="font-mono text-[11px] font-bold">{c.votes}</span>
                    <button className="hover:text-foreground"><ThumbsDown className="w-3 h-3" /></button>
                  </div>
                  <span className="font-mono text-[11px] font-bold">{c.user}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">· {c.time}</span>
                </div>
                <p className="text-sm text-foreground/80">{c.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* About */}
        <div className="border border-border bg-surface mb-10">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="font-display text-lg font-bold">About {data.ticker || data.name}</h3>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed mb-4">
              {md?.description || `${data.name} is a ${data.sector || "mining"} company listed on the ${data.exchange || "exchange"}.`}
            </p>
            <a href="#" className="inline-flex items-center gap-1.5 text-sm text-foreground/70 hover:text-foreground">
              <Globe className="w-3.5 h-3.5" />
              <span className="underline">{data.name?.toLowerCase().replace(/\s+/g, "")}.com</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

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

const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <div className="border border-border bg-surface mb-6">
    <div className="px-5 py-3 border-b border-border flex items-center gap-2">
      {icon}
      <h3 className="font-display text-lg font-bold">{title}</h3>
    </div>
    {children}
  </div>
);

export default CompanyDetail;
