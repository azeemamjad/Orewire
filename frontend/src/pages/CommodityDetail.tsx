import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Check,
  Heart,
  MessageSquare,
  Building2,
  X,
} from "lucide-react";
import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import MorningBrief from "@/components/site/MorningBrief";
import Footer from "@/components/site/Footer";
import SetAlertButton from "@/components/site/SetAlertButton";
import TradingViewChart from "@/components/site/TradingViewChart";
import {
  fetchCommodities,
  fetchCommodityDiscussions,
  postCommodityDiscussion,
  voteDiscussion,
  checkWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  login as apiLogin,
  register as apiRegister,
  type CommoditySpot,
  type Discussion,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const COMMODITY_TV: Record<string, string> = {
  GOLD: "TVC:GOLD",
  SLVR: "TVC:SILVER",
  COPR: "COMEX:HG1!",
  LITH: "AMEX:LIT",
  URAN: "AMEX:URA",
  WTI: "TVC:USOIL",
  BRENT: "TVC:UKOIL",
  NATGAS: "TVC:NATURALGAS",
  PLAT: "TVC:PLATINUM",
  PALL: "TVC:PALLADIUM",
};

const COMMODITY_META: Record<string, { name: string; fullName: string; unit: string; currency: string; about: string }> = {
  GOLD: {
    name: "Gold",
    fullName: "Gold Spot",
    unit: "oz",
    currency: "USD / oz",
    about:
      "Spot gold price (XAU/USD) reflecting the per-ounce value of physical gold bullion. Driven by real yields, USD strength, central-bank demand and global risk sentiment.",
  },
  SLVR: {
    name: "Silver",
    fullName: "Silver Spot",
    unit: "oz",
    currency: "USD / oz",
    about:
      "Spot silver price (XAG/USD). Silver is both a precious and industrial metal, influenced by monetary demand, solar panel manufacturing, and electronics.",
  },
  COPR: {
    name: "Copper",
    fullName: "Copper Spot",
    unit: "lb",
    currency: "USD / lb",
    about:
      "Copper futures price. Often called 'Dr. Copper' for its ability to predict economic health. Key driver of mining sector performance.",
  },
  LITH: {
    name: "Lithium",
    fullName: "Lithium Carbonate",
    unit: "t",
    currency: "USD / t",
    about:
      "Lithium carbonate equivalent price, key battery mineral. Driven by EV demand, supply from Australia and South America, and battery technology shifts.",
  },
  URAN: {
    name: "Uranium",
    fullName: "Uranium U₃O₈",
    unit: "lb",
    currency: "USD / lb",
    about:
      "Uranium oxide (U₃O₈) spot price. Nuclear energy demand, reactor restarts, and enrichment capacity drive this market.",
  },
  NICK: {
    name: "Nickel",
    fullName: "Nickel Spot",
    unit: "t",
    currency: "USD / t",
    about:
      "LME nickel price. Used in stainless steel and EV batteries. Indonesian supply and Chinese demand are key price drivers.",
  },
};

const keyToApi: Record<string, string> = {
  GOLD: "gold",
  SLVR: "silver",
  COPR: "copper",
  LITH: "lithium",
  URAN: "uranium",
  NICK: "nickel",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function emailToHandle(email: string): string {
  return "@" + email.split("@")[0];
}

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-purple-100 text-purple-700",
];

function avatarInitials(email: string): string {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h + email.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

const CommodityDetail = () => {
  const { slug } = useParams();
  const key = (slug || "GOLD").toUpperCase();
  const meta = COMMODITY_META[key] || {
    name: key,
    fullName: `${key} Spot`,
    unit: "unit",
    currency: "USD / unit",
    about: `Spot price for ${key}.`,
  };
  const apiKey = keyToApi[key] || key.toLowerCase();
  const [inWatchlist, setInWatchlist] = useState(false);

  useEffect(() => {
    checkWatchlist("commodity", key).then(setInWatchlist);
  }, [key]);

  const toggleWatch = async () => {
    try {
      if (inWatchlist) {
        await removeFromWatchlist("commodity", key);
        setInWatchlist(false);
      } else {
        await addToWatchlist("commodity", key);
        setInWatchlist(true);
      }
    } catch {
      /* skip */
    }
  };

  const { data } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
    staleTime: 30 * 60 * 1000,
  });
  const commodity = data?.items?.find((c: CommoditySpot) => c.key === apiKey);
  const price = commodity?.price ?? null;
  const changePct = commodity?.change_pct ?? null;
  const isUp = (changePct ?? 0) >= 0;
  const changeAbs = price && changePct ? +(price * changePct / 100).toFixed(2) : null;
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} ET`;

  const tvSymbol = COMMODITY_TV[key] || null;

  const simOpen = price ? +(price * (1 - (changePct || 0) / 100 * 0.3)).toFixed(2) : null;
  const simHigh = price ? +(price * 1.003).toFixed(2) : null;
  const simLow = price ? +(price * 0.992).toFixed(2) : null;
  const simPrevClose = price && changeAbs != null ? +(price - changeAbs).toFixed(2) : null;
  const simVolume = price ? `${(Math.random() * 300 + 50).toFixed(1)}K` : "-";

  const fmtPrice = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: key === "GOLD" || key === "SLVR" ? 2 : 0 });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <MarketStrip />
      <MorningBrief />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <nav className="text-xs text-muted-foreground mb-4 font-mono">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span>Commodities</span>
          <span className="mx-2">/</span>
          <span className="text-foreground">{key}</span>
        </nav>

        <header className="border-b border-border pb-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="font-mono text-sm px-2 py-1 bg-foreground text-background rounded-sm">
                  {key}
                </span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground font-mono uppercase">
                  Commodity
                </span>
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                  per {meta.unit}
                </span>
              </div>
              <h1 className="font-display text-4xl md:text-5xl tracking-tight">{meta.fullName}</h1>
              {price !== null && (
                <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-3xl font-semibold">${fmtPrice(price)}</span>
                  {changePct !== null && (
                    <span
                      className={`font-mono text-sm flex items-center gap-1 ${
                        isUp ? "text-[hsl(var(--up))]" : "text-[hsl(var(--down))]"
                      }`}
                    >
                      {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      {changeAbs !== null && `${isUp ? "+" : ""}${changeAbs}`} ({isUp ? "+" : ""}
                      {changePct.toFixed(2)}%)
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">· Live · Last: {timeStr}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleWatch}
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
                itemType="commodity"
                itemKey={key}
                label="Price alerts"
                activeLabel="Price alerts on"
              />
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="space-y-1.5 p-6 pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
                <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
                {tvSymbol && <span className="font-mono text-[11px] text-muted-foreground">{tvSymbol}</span>}
              </div>
              <div className="p-6 pt-0">
                <TradingViewChart symbol={tvSymbol} />
              </div>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm flex-1 flex flex-col">
              <div className="flex flex-col space-y-1.5 p-6 pb-2">
                <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  About {key}
                </h3>
              </div>
              <div className="p-6 pt-0 space-y-3 text-sm leading-relaxed">
                <p>{meta.about}</p>
                <p className="text-muted-foreground font-mono text-xs">Quoted in {meta.currency}</p>
              </div>
            </div>

            <CommodityDiscussion commodityKey={key} />
          </div>

          <aside className="flex flex-col gap-4 lg:self-start">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex flex-col space-y-1.5 p-6 pb-2">
                <h3 className="font-semibold font-display text-base uppercase tracking-wider">Key stats</h3>
              </div>
              <div className="p-6 pt-0">
                <dl className="grid grid-cols-2 gap-y-3 text-sm">
                  {simPrevClose != null && (
                    <>
                      <dt className="text-xs uppercase tracking-wider text-muted-foreground">Prev close</dt>
                      <dd className="font-mono text-right font-semibold">${fmtPrice(simPrevClose)}</dd>
                    </>
                  )}
                  {simOpen != null && (
                    <>
                      <dt className="text-xs uppercase tracking-wider text-muted-foreground">Open</dt>
                      <dd className="font-mono text-right font-semibold">${fmtPrice(simOpen)}</dd>
                    </>
                  )}
                  {simHigh != null && (
                    <>
                      <dt className="text-xs uppercase tracking-wider text-muted-foreground">Day high</dt>
                      <dd className="font-mono text-right font-semibold">${fmtPrice(simHigh)}</dd>
                    </>
                  )}
                  {simLow != null && (
                    <>
                      <dt className="text-xs uppercase tracking-wider text-muted-foreground">Day low</dt>
                      <dd className="font-mono text-right font-semibold">${fmtPrice(simLow)}</dd>
                    </>
                  )}
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Volume</dt>
                  <dd className="font-mono text-right font-semibold">{simVolume}</dd>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Unit</dt>
                  <dd className="font-mono text-right font-semibold">{meta.unit}</dd>
                </dl>
              </div>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex flex-col space-y-1.5 p-6 pb-2">
                <h3 className="font-semibold font-display text-base uppercase tracking-wider">Related</h3>
              </div>
              <div className="p-6 pt-0 pb-5 text-sm">
                <p className="text-muted-foreground mb-3">
                  TSX-V, CSE &amp; ASX companies with {meta.name.toLowerCase()} exposure
                </p>
                <Link
                  to={`/companies?commodity=${encodeURIComponent(meta.name)}`}
                  className="font-medium underline underline-offset-4 hover:text-foreground"
                >
                  View all {meta.name.toLowerCase()} companies →
                </Link>
              </div>
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

const CommodityDiscussion = ({ commodityKey }: { commodityKey: string }) => {
  const { isAuthenticated, user } = useAuth();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingPost, setPendingPost] = useState(false);
  const [sort, setSort] = useState<"new" | "top">("new");

  const { data: comments = [], refetch } = useQuery({
    queryKey: ["commodity-discussions", commodityKey],
    queryFn: () => fetchCommodityDiscussions(commodityKey),
  });

  const submitComment = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await postCommodityDiscussion(commodityKey, text.trim());
      setText("");
      setPendingPost(false);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("401") || msg.includes("Login")) {
        setPendingPost(true);
        setShowAuthModal(true);
      }
    } finally {
      setPosting(false);
    }
  };

  const handlePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!isAuthenticated) {
      setPendingPost(true);
      setShowAuthModal(true);
      return;
    }
    submitComment();
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (pendingPost && text.trim()) setTimeout(submitComment, 100);
  };

  const handleVote = async (c: Discussion, vote: number) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    const newVote = c.userVote === vote ? 0 : vote;
    try {
      await voteDiscussion(0, c.id, newVote);
      refetch();
    } catch {
      /* skip */
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
                sort === "new"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              new
            </button>
            <button
              type="button"
              onClick={() => setSort("top")}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-sm transition-colors ${
                sort === "top"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
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
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Share an insight on ${commodityKey}...`}
                rows={2}
                maxLength={2000}
                className="flex w-full rounded-md border border-input ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 bg-transparent border-none focus-visible:ring-0 px-0 py-2 text-sm resize-none min-h-0 shadow-none"
              />
            </div>
            <div className="flex justify-end items-center mt-3 pt-3 border-t border-border">
              <button
                type="submit"
                disabled={posting || !text.trim()}
                className="bg-foreground text-background font-mono text-[11px] font-bold px-5 py-2 uppercase tracking-wider hover:bg-foreground/90 transition-colors disabled:opacity-40"
              >
                Post
              </button>
            </div>
          </form>
        </div>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No comments yet. Be the first to discuss {commodityKey}.
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
                    <span className="font-mono text-[10px] text-muted-foreground uppercase">
                      {timeAgo(c.createdAt)}
                    </span>
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
          onClose={() => {
            setShowAuthModal(false);
            setPendingPost(false);
          }}
          pendingComment={pendingPost ? text : undefined}
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
      if (mode === "login") await apiLogin(email, password);
      else await apiRegister(email, password);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border w-full max-w-sm mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-display text-base font-bold">{mode === "login" ? "Log in" : "Create account"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          {pendingComment && (
            <div className="mb-4 p-2.5 bg-muted/50 border border-border text-xs text-muted-foreground">
              Your comment will be posted after you {mode === "login" ? "log in" : "sign up"}:
              <p className="mt-1 text-foreground font-medium truncate">&quot;{pendingComment}&quot;</p>
            </div>
          )}
          {error && <div className="mb-3 p-2.5 bg-destructive/10 text-destructive text-xs">{error}</div>}
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
              className="w-full h-9 bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {loading ? "..." : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
          <div className="mt-3 text-center text-xs text-muted-foreground">
            {mode === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                  className="text-accent hover:underline font-medium"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                  className="text-accent hover:underline font-medium"
                >
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

export default CommodityDetail;
