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
  X,
} from "lucide-react";
import SiteLayout from "@/layouts/SiteLayout";
import SetAlertButton from "@/components/site/SetAlertButton";
import TradingViewChart from "@/components/site/TradingViewChart";
import MarketNewsFeedSection from "@/components/site/MarketNewsFeedSection";
import {
  fetchCommodity,
  fetchCommodityDiscussions,
  postCommodityDiscussion,
  voteDiscussion,
  checkWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  login as apiLogin,
  register as apiRegister,
  type Discussion,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import SymbolPicker from "@/features/markets/components/SymbolPicker";
import { useInstrumentSymbols } from "@/hooks/use-instrument-symbols";
import { useLiveQuote } from "@/hooks/use-live-quote";
import { formatEmpty } from "@/lib/display";

const COMMODITY_TV: Record<string, string> = {
  GOLD: "TVC:GOLD",
  SLVR: "TVC:SILVER",
  COPR: "COMEX:HG1!",
  LITH: "AMEX:LIT",
  URAN: "AMEX:URA",
  NICK: "TVC:NICKEL",
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

function fmtVol(n: number | null | undefined): string {
  if (n == null) return formatEmpty(null);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function ccyPrefix(currency: string | null | undefined): string {
  if (!currency || currency === "USD") return "$";
  if (currency === "AUD") return "A$";
  if (currency === "CAD") return "C$";
  return "$";
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

  const { symbols, selectedTvSymbol, setSelectedTvSymbol } = useInstrumentSymbols("commodity", apiKey);
  const { data: liveQuote } = useLiveQuote(selectedTvSymbol);
  const fallbackTv = COMMODITY_TV[key] || null;
  const chartTvSymbol = selectedTvSymbol || fallbackTv;

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

  const { data: commodity, isLoading } = useQuery({
    queryKey: ["commodity", apiKey],
    queryFn: () => fetchCommodity(apiKey),
    staleTime: 5 * 60 * 1000,
  });

  const price = liveQuote?.price ?? commodity?.price ?? null;
  const changePct = liveQuote?.change_pct ?? commodity?.change_pct ?? null;
  const changeAbs = liveQuote?.change_abs ?? commodity?.change_abs ?? null;
  const displayOpen = liveQuote?.open ?? commodity?.open ?? null;
  const displayHigh = liveQuote?.high ?? commodity?.high ?? null;
  const displayLow = liveQuote?.low ?? commodity?.low ?? null;
  const displayVolume = liveQuote?.volume ?? commodity?.volume ?? null;
  const isUp = (changePct ?? 0) >= 0;
  const isDown = changePct != null && changePct < 0;
  const priceCcy = ccyPrefix(liveQuote?.currency ?? commodity?.currency);
  const providerLabel = commodity?.provider === "yahoo" ? "Yahoo Finance" : "TradingView";
  const prevClose =
    price != null && changeAbs != null ? +(price - changeAbs).toFixed(key === "GOLD" || key === "SLVR" ? 2 : 4) : null;

  const fmtPrice = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: key === "GOLD" || key === "SLVR" ? 1 : 2 });
  const px = (n: number | null | undefined) => (n != null ? `${priceCcy}${fmtPrice(n)}` : formatEmpty(null));

  return (
    <SiteLayout morningBrief>
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
              {isLoading ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading quote…</p>
              ) : price !== null ? (
                <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-3xl font-semibold">{px(price)}</span>
                  {changePct != null && (
                    <span
                      className={`font-mono text-sm flex items-center gap-1 ${
                        isUp ? "text-[hsl(var(--up))]" : isDown ? "text-[hsl(var(--down))]" : "text-muted-foreground"
                      }`}
                    >
                      {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      {changeAbs != null &&
                        `${changeAbs >= 0 ? "+" : "-"}${fmtPrice(Math.abs(changeAbs))}`}
                      {" "}({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">
                    · {providerLabel} · Delayed · Day change vs prior close
                  </span>
                </div>
              ) : null}
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
          <div className="lg:col-span-2">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm h-full flex flex-col">
              <div className="space-y-1.5 p-6 pb-3 flex flex-col gap-2 shrink-0">
                <div className="flex flex-row items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
                  {chartTvSymbol && (
                    <span className="font-mono text-[11px] text-muted-foreground">{chartTvSymbol}</span>
                  )}
                </div>
                <SymbolPicker
                  symbols={symbols}
                  selectedTvSymbol={selectedTvSymbol}
                  onSelect={setSelectedTvSymbol}
                />
              </div>
              <div className="p-6 pt-0 flex-1 min-h-0">
                <TradingViewChart symbol={chartTvSymbol} />
              </div>
            </div>
          </div>

          <aside className="lg:col-span-1 flex flex-col gap-6">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex flex-col space-y-1.5 p-6 pb-2">
                <h3 className="font-semibold font-display text-base uppercase tracking-wider">Key stats</h3>
              </div>
              <div className="p-6 pt-0">
                <dl className="grid grid-cols-2 gap-y-3 text-sm">
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Prev close</dt>
                  <dd className="font-mono text-right font-semibold">{px(prevClose)}</dd>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Open</dt>
                  <dd className="font-mono text-right font-semibold">{px(displayOpen)}</dd>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Day high</dt>
                  <dd className="font-mono text-right font-semibold">{px(displayHigh)}</dd>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Day low</dt>
                  <dd className="font-mono text-right font-semibold">{px(displayLow)}</dd>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Volume</dt>
                  <dd className="font-mono text-right font-semibold">{fmtVol(displayVolume)}</dd>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Unit</dt>
                  <dd className="font-mono text-right font-semibold">{meta.unit}</dd>
                </dl>
              </div>
            </div>

            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex flex-col space-y-1.5 p-6 pb-3">
                <h3 className="font-semibold tracking-tight font-display text-lg">About {meta.fullName}</h3>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground pt-1">
                  Quoted in {meta.currency}
                </p>
              </div>
              <div className="p-6 pt-0">
                <p className="text-sm leading-relaxed text-foreground/90">{meta.about}</p>
              </div>
            </div>
          </aside>
        </div>

        <MarketNewsFeedSection keyword={meta.name} title={`${meta.fullName} in the news`} />

        <div className="mt-4">
          <CommodityDiscussion commodityKey={key} />
        </div>

        <p className="text-xs text-muted-foreground mt-10 leading-relaxed border-t border-border pt-4">
          Orewire market data is provided for informational purposes only and may be delayed. Not investment advice.
        </p>
      </main>
    </SiteLayout>
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
      <section>
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
