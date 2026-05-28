import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  ArrowUpRight, ArrowDownRight, Bell, Plus, Check, ChevronDown,
  Activity, ChartLine, ChartCandlestick, ThumbsUp, ThumbsDown, MessageSquare, X,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Bar, Cell } from "recharts";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import Footer from "@/components/site/Footer";
import {
  fetchCurrencies, fetchCurrencyDiscussions, postCurrencyDiscussion, voteDiscussion,
  fetchMarketHistory,
  checkWatchlist, addToWatchlist, removeFromWatchlist,
  login as apiLogin, register as apiRegister,
  type CurrencySpot, type Discussion,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const CURRENCY_META: Record<string, { name: string; fullName: string; quote: string; about: string }> = {
  USDCAD: { name: "USD/CAD", fullName: "US Dollar / Canadian Dollar", quote: "CAD", about: "USD/CAD spot — the loonie pair, sensitive to crude oil, BoC vs Fed policy spreads and risk-on/off flows. Key for Canadian-listed miner valuations." },
  AUDUSD: { name: "AUD/USD", fullName: "Australian Dollar / US Dollar", quote: "USD", about: "AUD/USD spot — the Aussie pair, driven by commodity prices (iron ore, copper, gold), China growth, and RBA vs Fed policy. Critical for ASX-listed miner economics." },
  CADAUD: { name: "CAD/AUD", fullName: "Canadian Dollar / Australian Dollar", quote: "AUD", about: "CAD/AUD cross — tracks the relative strength of two commodity currencies. Useful for comparing TSX-V vs ASX miner valuations." },
  DXY:    { name: "DXY",     fullName: "US Dollar Index",                quote: "Index", about: "DXY — US Dollar Index measuring USD strength against a basket of major currencies (EUR, JPY, GBP, CAD, SEK, CHF). Inversely correlated with gold and most commodities." },
};

type ChartPeriod = "1D" | "1W" | "1M" | "3M" | "1Y" | "All";
type ChartStyle = "area" | "line" | "candles";
const mainPeriods: ChartPeriod[] = ["1D", "1W", "1M", "3M", "1Y", "All"];
const periodDays: Record<ChartPeriod, number> = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365, "All": 2500 };

interface ChartPoint { date: string; price: number; open: number; high: number; low: number; close: number; isUp: boolean; wickRange: [number, number]; bodyRange: [number, number]; }

function generateChartData(price: number, period: ChartPeriod): ChartPoint[] {
  const points: ChartPoint[] = [];
  const now = new Date();
  const days = periodDays[period];
  const count = Math.max(30, Math.min(days, 90));
  const stepMs = (days / count) * 24 * 60 * 60 * 1000;
  let p = price * (0.96 + Math.random() * 0.03);
  const drift = (price - p) / count;
  const vol = price * 0.004;
  for (let i = 0; i < count; i++) {
    const t = new Date(now.getTime() - (count - i) * stepMs);
    const open = p; p += drift + (Math.random() - 0.45) * price * 0.006; p = Math.max(p, price * 0.85);
    const close = p; const high = Math.max(open, close) + Math.random() * vol; const low = Math.max(Math.min(open, close) - Math.random() * vol, 0); const isUp = close >= open;
    const label = days <= 365 ? `${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}` : `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][t.getMonth()]} '${String(t.getFullYear()).slice(2)}`;
    points.push({ date: label, price: +close.toFixed(4), open: +open.toFixed(4), high: +high.toFixed(4), low: +Math.max(low, 0).toFixed(4), close: +close.toFixed(4), isUp, wickRange: [+Math.max(low, 0).toFixed(4), +high.toFixed(4)], bodyRange: isUp ? [+open.toFixed(4), +close.toFixed(4)] : [+close.toFixed(4), +open.toFixed(4)] });
  }
  const nowLabel = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  points.push({ date: nowLabel, price, open: +p.toFixed(4), high: +(price + Math.random() * vol).toFixed(4), low: +Math.max(p - Math.random() * vol, 0).toFixed(4), close: price, isUp: price >= p, wickRange: [+Math.max(p - Math.random() * vol, 0).toFixed(4), +(price + Math.random() * vol).toFixed(4)], bodyRange: price >= p ? [+p.toFixed(4), price] : [price, +p.toFixed(4)] });
  return points;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now"; if (mins < 60) return `${mins}m`; const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`; return `${Math.floor(hrs / 24)}d`;
}
function emailToHandle(email: string): string { return "@" + email.split("@")[0]; }

const CurrencyDetail = () => {
  const { slug } = useParams();
  const key = (slug || "USDCAD").toUpperCase();
  const meta = CURRENCY_META[key] || { name: key, fullName: key, quote: "", about: `Spot rate for ${key}.` };

  const { data } = useQuery({ queryKey: ["currencies"], queryFn: fetchCurrencies, staleTime: 30 * 60 * 1000 });
  const currency = data?.items?.find((c: CurrencySpot) => c.key === key);
  const price = currency?.price ?? null;
  const changePct = currency?.change_pct ?? null;
  const isUp = (changePct ?? 0) >= 0;
  const changeAbs = price && changePct ? +(price * changePct / 100).toFixed(4) : null;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} ET`;

  const [inWatchlist, setInWatchlist] = useState(false);
  useEffect(() => { checkWatchlist("currency", key).then(setInWatchlist); }, [key]);
  const toggleWatch = async () => {
    try {
      if (inWatchlist) { await removeFromWatchlist("currency", key); setInWatchlist(false); }
      else { await addToWatchlist("currency", key); setInWatchlist(true); }
    } catch { /* skip */ }
  };

  const [period, setPeriod] = useState<ChartPeriod>("3M");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("area");
  const [showMore, setShowMore] = useState(false);
  const { data: historyData } = useQuery({
    queryKey: ["market-history", "currency", key],
    queryFn: () => fetchMarketHistory("currency", key),
    enabled: !!price,
    refetchInterval: 30 * 60 * 1000,
  });
  const chartData = useMemo(() => {
    const points = historyData?.points || [];
    const mapped = points
      .map((p) => {
        if (p.close == null || p.open == null || p.high == null || p.low == null) return null;
        const t = new Date(p.ts);
        const label = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
        const isUp = p.close >= p.open;
        return {
          date: label,
          price: +p.close.toFixed(4),
          open: +p.open.toFixed(4),
          high: +p.high.toFixed(4),
          low: +Math.max(p.low, 0).toFixed(4),
          close: +p.close.toFixed(4),
          isUp,
          wickRange: [+Math.max(p.low, 0).toFixed(4), +p.high.toFixed(4)] as [number, number],
          bodyRange: (isUp ? [+p.open.toFixed(4), +p.close.toFixed(4)] : [+p.close.toFixed(4), +p.open.toFixed(4)]) as [number, number],
        };
      })
      .filter(Boolean) as ChartPoint[];
    if (mapped.length > 1) return mapped;
    return price ? generateChartData(price, period) : [];
  }, [historyData?.points, price, period]);
  const minP = chartData.length ? Math.min(...chartData.map(d => d.low)) : 0;
  const maxP = chartData.length ? Math.max(...chartData.map(d => d.high)) : 0;
  const pad = (maxP - minP) * 0.1 || 0.001;

  const simOpen = price ? +(price * (1 - (changePct || 0) / 100 * 0.3)).toFixed(4) : null;
  const simHigh = price ? +(price * 1.0015).toFixed(4) : null;
  const simLow = price ? +(price * 0.9985).toFixed(4) : null;
  const simPrevClose = price && changeAbs !== null ? +(price - changeAbs).toFixed(4) : null;
  const trendColor = isUp ? "hsl(var(--up))" : "hsl(var(--down))";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <MarketStrip />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <nav className="text-xs text-muted-foreground mb-4 font-mono">
          <Link to="/" className="hover:text-foreground">Home</Link><span className="mx-2">/</span>
          <span>Currencies</span><span className="mx-2">/</span><span className="text-foreground">{key}</span>
        </nav>

        <header className="border-b border-border pb-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="font-mono text-sm px-2 py-1 bg-foreground text-background rounded-sm">{key}</span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground font-mono uppercase">Currency</span>
              </div>
              <h1 className="font-display text-4xl md:text-5xl tracking-tight">{meta.fullName}</h1>
              {price !== null && (
                <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-3xl font-semibold">{price.toFixed(4)} {meta.quote}</span>
                  {changePct !== null && (
                    <span className={`font-mono text-sm flex items-center gap-1 ${isUp ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                      {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      {changeAbs !== null && `${isUp ? "+" : ""}${changeAbs.toFixed(4)}`} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">· Live · Last: {timeStr}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={toggleWatch}
                className={`inline-flex items-center gap-2 text-sm font-medium h-9 rounded-md px-3 border transition-colors ${
                  inWatchlist ? "border-[hsl(var(--up))] bg-[hsl(var(--up))]/10 text-[hsl(var(--up))]" : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {inWatchlist ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {inWatchlist ? "Watching" : "Watchlist"}
              </button>
              <button className="inline-flex items-center gap-2 text-sm font-medium h-9 rounded-md px-3 bg-foreground text-background hover:bg-foreground/90">
                <Bell className="w-4 h-4" /> Set alert
              </button>
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Chart */}
            {price !== null && chartData.length > 0 && (
              <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
                <div className="space-y-1.5 p-6 pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 relative">
                      {mainPeriods.map((p) => (
                        <button key={p} onClick={() => { setPeriod(p); setShowMore(false); }} className={`text-[11px] font-mono px-2.5 py-1 rounded-sm transition-colors ${period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{p}</button>
                      ))}
                      <button onClick={() => setShowMore(!showMore)} className="text-[11px] font-mono px-2 py-1 rounded-sm flex items-center gap-0.5 text-muted-foreground hover:text-foreground">More<ChevronDown className="h-3 w-3" /></button>
                      {showMore && (
                        <><div className="fixed inset-0 z-40" onClick={() => setShowMore(false)} />
                        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-md shadow-lg p-3 w-40">
                          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Intraday</div>
                          <div className="grid grid-cols-3 gap-1">
                            {(["1D", "1W", "1M"] as ChartPeriod[]).map((p) => (
                              <button key={p} onClick={() => { setPeriod(p); setShowMore(false); }} className={`text-[11px] font-mono px-2 py-1.5 rounded-sm text-center ${period === p ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"}`}>{p}</button>
                            ))}
                          </div>
                        </div></>
                      )}
                    </div>
                    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
                      <button title="Area" onClick={() => setChartStyle("area")} className={`p-1.5 rounded-sm ${chartStyle === "area" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Activity className="h-3.5 w-3.5" /></button>
                      <button title="Line" onClick={() => setChartStyle("line")} className={`p-1.5 rounded-sm ${chartStyle === "line" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><ChartLine className="h-3.5 w-3.5" /></button>
                      <button title="Candles" onClick={() => setChartStyle("candles")} className={`p-1.5 rounded-sm ${chartStyle === "candles" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><ChartCandlestick className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
                <div className="p-6 pt-0">
                  <div className="h-[360px]">
                    <ResponsiveContainer width="100%" height="100%">
                      {chartStyle === "candles" ? (
                        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} tickLine={{ stroke: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={50} />
                          <YAxis domain={[minP - pad, maxP + pad]} tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} tickLine={{ stroke: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v.toFixed(4)} width={70} yAxisId="price" />
                          <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11, fontFamily: "monospace" }} formatter={(_v: any, name: string, props: any) => { const d = props.payload; if (name === "wickRange") return [`O:${d.open} H:${d.high} L:${d.low} C:${d.close}`, "OHLC"]; return null; }} />
                          <Bar dataKey="wickRange" yAxisId="price" barSize={1}>{chartData.map((d, i) => <Cell key={i} fill={d.isUp ? "hsl(var(--up))" : "hsl(var(--down))"} />)}</Bar>
                          <Bar dataKey="bodyRange" yAxisId="price" barSize={6}>{chartData.map((d, i) => <Cell key={i} fill={d.isUp ? "hsl(var(--up))" : "hsl(var(--down))"} />)}</Bar>
                        </ComposedChart>
                      ) : (
                        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <defs><linearGradient id="mkt-fx" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={trendColor} stopOpacity={chartStyle === "line" ? 0 : 0.35} /><stop offset="100%" stopColor={trendColor} stopOpacity={0} /></linearGradient></defs>
                          <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} tickLine={{ stroke: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={50} />
                          <YAxis domain={[minP - pad, maxP + pad]} tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }} tickLine={{ stroke: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => v.toFixed(4)} width={70} />
                          <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11, fontFamily: "monospace" }} formatter={(value: number) => [value.toFixed(4), "Rate"]} />
                          <Area type="monotone" dataKey="price" stroke={trendColor} strokeWidth={1.75} fill="url(#mkt-fx)" fillOpacity={0.6} dot={false} activeDot={{ r: 3, fill: trendColor, strokeWidth: 0 }} />
                        </AreaChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            <section>
              <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border">About {key}</h2>
              <p className="text-sm leading-relaxed text-foreground/90">{meta.about}</p>
            </section>

            <CurrencyDiscussion currencyKey={key} />
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="border border-border bg-surface rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Key data</h3>
              <div className="space-y-2.5 text-sm">
                {simPrevClose !== null && <div className="flex justify-between"><span className="text-muted-foreground">Previous close</span><span className="font-mono font-medium">{simPrevClose.toFixed(4)}</span></div>}
                {simOpen !== null && <div className="flex justify-between"><span className="text-muted-foreground">Open</span><span className="font-mono font-medium">{simOpen.toFixed(4)}</span></div>}
                {simHigh !== null && <div className="flex justify-between"><span className="text-muted-foreground">Day high</span><span className="font-mono font-medium">{simHigh.toFixed(4)}</span></div>}
                {simLow !== null && <div className="flex justify-between"><span className="text-muted-foreground">Day low</span><span className="font-mono font-medium">{simLow.toFixed(4)}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Quote</span><span className="font-mono font-medium">{meta.quote || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-mono font-medium">FX Spot</span></div>
              </div>
            </div>
            <div className="border border-border bg-surface rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Why it matters</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                FX moves directly affect mining company revenues — most miners price in USD but report in local currency. A weaker CAD or AUD boosts margins for TSX/ASX-listed producers.
              </p>
            </div>
          </aside>
        </div>

        <p className="text-xs text-muted-foreground mt-10 leading-relaxed border-t border-border pt-4">
          Orewire market data is provided for informational purposes only and may be delayed. Not investment advice.
        </p>
      </main>
      <Footer />
    </div>
  );
};

const CurrencyDiscussion = ({ currencyKey }: { currencyKey: string }) => {
  const { isAuthenticated } = useAuth();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingPost, setPendingPost] = useState(false);

  const { data: comments = [], refetch } = useQuery({
    queryKey: ["currency-discussions", currencyKey],
    queryFn: () => fetchCurrencyDiscussions(currencyKey),
  });

  const submitComment = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await postCurrencyDiscussion(currencyKey, text.trim());
      setText(""); setPendingPost(false); refetch();
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("Login")) { setPendingPost(true); setShowAuthModal(true); }
    } finally { setPosting(false); }
  };

  const handlePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!isAuthenticated) { setPendingPost(true); setShowAuthModal(true); return; }
    submitComment();
  };

  const handleAuthSuccess = () => { setShowAuthModal(false); if (pendingPost && text.trim()) setTimeout(submitComment, 100); };

  const handleVote = async (c: Discussion, vote: number) => {
    if (!isAuthenticated) { setShowAuthModal(true); return; }
    const newVote = c.userVote === vote ? 0 : vote;
    try { await voteDiscussion(0, c.id, newVote); refetch(); } catch { /* skip */ }
  };

  return (
    <>
      <section className="border border-border bg-surface">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          <h3 className="font-display text-lg font-bold">Discussion</h3>
        </div>
        <div className="px-5 py-3 border-b border-border">
          <form onSubmit={handlePost} className="flex gap-2">
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Share an insight on ${currencyKey}...`} maxLength={2000} className="flex-1 bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent" />
            <button type="submit" disabled={posting || !text.trim()} className="px-4 h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 disabled:opacity-50">Post</button>
          </form>
        </div>
        {comments.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-muted-foreground">No comments yet. Be the first to discuss {currencyKey}.</div>
        ) : (
          <ul className="divide-y divide-border">
            {comments.map((c) => (
              <li key={c.id} className="px-5 py-3.5">
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <button onClick={() => handleVote(c, 1)} className={`hover:text-foreground ${c.userVote === 1 ? "text-[hsl(var(--up))]" : ""}`}><ThumbsUp className="w-3 h-3" /></button>
                    <span className="font-mono text-[11px] font-bold">{c.score}</span>
                    <button onClick={() => handleVote(c, -1)} className={`hover:text-foreground ${c.userVote === -1 ? "text-[hsl(var(--down))]" : ""}`}><ThumbsDown className="w-3 h-3" /></button>
                  </div>
                  <span className="font-mono text-[11px] font-bold">{emailToHandle(c.userEmail)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">· {timeAgo(c.createdAt)}</span>
                </div>
                <p className="text-sm text-foreground/80">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAuthModal && (
        <AuthModal onSuccess={handleAuthSuccess} onClose={() => { setShowAuthModal(false); setPendingPost(false); }} pendingComment={pendingPost ? text : undefined} />
      )}
    </>
  );
};

const AuthModal = ({ onSuccess, onClose, pendingComment }: { onSuccess: () => void; onClose: () => void; pendingComment?: string }) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!email || !password) return; setError(""); setLoading(true);
    try { if (mode === "login") await apiLogin(email, password); else await apiRegister(email, password); onSuccess(); }
    catch (err: any) { setError(err.message || "Something went wrong"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border w-full max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-display text-base font-bold">{mode === "login" ? "Log in" : "Create account"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">
          {pendingComment && <div className="mb-4 p-2.5 bg-muted/50 border border-border text-xs text-muted-foreground">Your comment will be posted after you {mode}:<p className="mt-1 text-foreground font-medium truncate">"{pendingComment}"</p></div>}
          {error && <div className="mb-3 p-2.5 bg-destructive/10 text-destructive text-xs">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-3">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required className="w-full bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required minLength={6} className="w-full bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent" />
            <button type="submit" disabled={loading} className="w-full h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 disabled:opacity-50">{loading ? "..." : mode === "login" ? "Log in" : "Create account"}</button>
          </form>
          <div className="mt-3 text-center text-xs text-muted-foreground">
            {mode === "login" ? <>Don't have an account? <button onClick={() => { setMode("register"); setError(""); }} className="text-accent hover:underline font-medium">Sign up</button></> : <>Already have an account? <button onClick={() => { setMode("login"); setError(""); }} className="text-accent hover:underline font-medium">Log in</button></>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CurrencyDetail;
