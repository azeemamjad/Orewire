import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  ArrowUpRight, ArrowDownRight, Bell, Plus, Check,
  ThumbsUp, ThumbsDown, MessageSquare, X,
} from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import Footer from "@/components/site/Footer";
import TradingViewChart from "@/components/site/TradingViewChart";
import {
  fetchIndexes, fetchIndexDiscussions, postIndexDiscussion, voteDiscussion,
  checkWatchlist, addToWatchlist, removeFromWatchlist,
  login as apiLogin, register as apiRegister,
  type IndexSpot, type Discussion,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

// TradingView symbols: ETFs resolve on AMEX; indices use a curated mapping.
const INDEX_TV: Record<string, string> = {
  GDXJ: "AMEX:GDXJ",
  GDX: "AMEX:GDX",
  URA: "AMEX:URA",
  COPX: "AMEX:COPX",
  SIL: "AMEX:SIL",
  LIT: "AMEX:LIT",
  PICK: "AMEX:PICK",
  XGD: "TSX:XGD",
  SPX: "SP:SPX",
  VIX: "TVC:VIX",
  XJO: "ASX:XJO",
  XMM: "ASX:XMM",
  TSX: "TSX:TSX",
  TSXV: "TSX:JX",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now"; if (mins < 60) return `${mins}m`; const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`; return `${Math.floor(hrs / 24)}d`;
}
function emailToHandle(email: string): string { return "@" + email.split("@")[0]; }

const IndexDetail = () => {
  const { slug } = useParams();
  const key = (slug || "TSXV").toUpperCase();

  const { data } = useQuery({ queryKey: ["indexes"], queryFn: fetchIndexes, staleTime: 30 * 60 * 1000 });
  const index = data?.items?.find((c: IndexSpot) => c.key === key);
  const price = index?.price ?? null;
  const changePct = index?.change_pct ?? null;
  const label = index?.label ?? key;
  const about = index?.about ?? `Market index ${key}.`;
  const currency = index?.currency ?? "USD";
  const isUp = (changePct ?? 0) >= 0;
  const changeAbs = price && changePct ? +(price * changePct / 100).toFixed(2) : null;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} ET`;

  const [inWatchlist, setInWatchlist] = useState(false);
  useEffect(() => { checkWatchlist("index", key).then(setInWatchlist); }, [key]);
  const toggleWatch = async () => {
    try {
      if (inWatchlist) { await removeFromWatchlist("index", key); setInWatchlist(false); }
      else { await addToWatchlist("index", key); setInWatchlist(true); }
    } catch { /* skip */ }
  };

  const tvSymbol = INDEX_TV[key] || null;

  const simOpen = price ? +(price * (1 - (changePct || 0) / 100 * 0.3)).toFixed(2) : null;
  const simHigh = price ? +(price * 1.005).toFixed(2) : null;
  const simLow = price ? +(price * 0.995).toFixed(2) : null;
  const simPrevClose = price && changeAbs !== null ? +(price - changeAbs).toFixed(2) : null;
  const trendColor = isUp ? "hsl(var(--up))" : "hsl(var(--down))";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <MarketStrip />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <nav className="text-xs text-muted-foreground mb-4 font-mono">
          <Link to="/" className="hover:text-foreground">Home</Link><span className="mx-2">/</span>
          <span>Indexes</span><span className="mx-2">/</span><span className="text-foreground">{key}</span>
        </nav>

        <header className="border-b border-border pb-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="font-mono text-sm px-2 py-1 bg-foreground text-background rounded-sm">{key}</span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground font-mono uppercase">Index</span>
              </div>
              <h1 className="font-display text-4xl md:text-5xl tracking-tight">{label}</h1>
              {price !== null && (
                <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-3xl font-semibold">{price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</span>
                  {changePct !== null && (
                    <span className={`font-mono text-sm flex items-center gap-1 ${isUp ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"}`}>
                      {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      {changeAbs !== null && `${isUp ? "+" : ""}${changeAbs.toFixed(2)}`} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
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
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="space-y-1.5 p-6 pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
                <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
                {tvSymbol && <span className="font-mono text-[11px] text-muted-foreground">{tvSymbol}</span>}
              </div>
              <div className="p-6 pt-0">
                <TradingViewChart symbol={tvSymbol} />
              </div>
            </div>

            <section>
              <h2 className="font-display text-2xl tracking-tight mb-4 pb-2 border-b border-border">About {key}</h2>
              <p className="text-sm leading-relaxed text-foreground/90">{about}</p>
            </section>

            <IndexDiscussion indexKey={key} />
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="border border-border bg-surface rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Key data</h3>
              <div className="space-y-2.5 text-sm">
                {simPrevClose !== null && <div className="flex justify-between"><span className="text-muted-foreground">Previous close</span><span className="font-mono font-medium">{simPrevClose.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>}
                {simOpen !== null && <div className="flex justify-between"><span className="text-muted-foreground">Open</span><span className="font-mono font-medium">{simOpen.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>}
                {simHigh !== null && <div className="flex justify-between"><span className="text-muted-foreground">Day high</span><span className="font-mono font-medium">{simHigh.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>}
                {simLow !== null && <div className="flex justify-between"><span className="text-muted-foreground">Day low</span><span className="font-mono font-medium">{simLow.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span className="font-mono font-medium">{currency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-mono font-medium">Index</span></div>
              </div>
            </div>
            <div className="border border-border bg-surface rounded-lg p-5">
              <h3 className="font-display text-base font-bold mb-3">Why it matters</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Index performance gives you a top-down view of the sector. A rising junior mining index typically signals risk-on appetite and capital rotation into exploration plays.
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

const IndexDiscussion = ({ indexKey }: { indexKey: string }) => {
  const { isAuthenticated } = useAuth();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingPost, setPendingPost] = useState(false);

  const { data: comments = [], refetch } = useQuery({
    queryKey: ["index-discussions", indexKey],
    queryFn: () => fetchIndexDiscussions(indexKey),
  });

  const submitComment = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await postIndexDiscussion(indexKey, text.trim());
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
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Share an insight on ${indexKey}...`} maxLength={2000} className="flex-1 bg-background border border-border px-3 h-9 text-sm outline-none focus:border-accent" />
            <button type="submit" disabled={posting || !text.trim()} className="px-4 h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 disabled:opacity-50">Post</button>
          </form>
        </div>
        {comments.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-muted-foreground">No comments yet. Be the first to discuss {indexKey}.</div>
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

export default IndexDetail;
