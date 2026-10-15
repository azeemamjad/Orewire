import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import SiteLayout from "@/layouts/SiteLayout";
import {
  fetchCompanies,
  fetchCommodities,
  fetchCurrencies,
  fetchIndexes,
  fetchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  reorderWatchlist,
  companySlug,
  guestWatchlistFullMessage,
  WatchlistLimitError,
  GUEST_WATCHLIST_LIMIT,
  WATCHLIST_LIMIT,
  type Company,
  type WatchlistItem,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useSignupModal } from "@/hooks/use-signup-modal";
import {
  addGuestWatchlist,
  removeGuestWatchlist,
  reorderGuestWatchlist,
  useGuestWatchlist,
} from "@/features/watchlist/guest-watchlist";
import { formatTickerLabel, normalizeExchange } from "@/components/site/FeedRow";

import { API_BASE } from '@/lib/api-client';
import {
  commodityApiKeyFromSlug,
  COMMODITY_SLUG_LABELS,
} from "@/lib/commodity-slugs";

/**
 * Watchlist — restyled to the Lovable export's watchlist page
 * (src/pages/Watchlist.tsx), keeping OreWire's own data layer untouched.
 *
 * What was taken from the export, and what was not:
 *
 *  TAKEN (visual): the dense row grid
 *    [order] TICKER EXCH COMPANY PRICE CHG$ CHG% VOLUME CAP TAGS [del]
 *  with the export's exact type treatment — mono tabular figures for every
 *  number, `font-display` bold company name, `text-[10px]` uppercase mono
 *  exchange, boxed commodity/geo tags, a muted uppercase column header, mono
 *  up/down arrows on the change cells, the dashed empty-state card and the
 *  two-column add-company result grid.
 *
 *  TAKEN (behaviour): the two watchlist caps. The header reports `{n}/{limit}`
 *  and the add path refuses past it, with the export's copy:
 *    - signed in — 20 companies, enforced server-side by
 *      Server/routes/api/watchlist.js, which answers 409
 *      `{ error, code: "watchlist_limit_reached", limit }` and is toasted here
 *      as "Your watchlist is full (20). Remove a company to add another."
 *    - signed out — 10 companies in localStorage
 *      (@/features/watchlist/guest-watchlist), with the export's guest copy
 *      "Your free watchlist is full (10). Sign up to add more." and the queued
 *      company replayed after sign-in by @/hooks/use-signup-modal.
 *
 *  NOT TAKEN:
 *   - Supabase. The export reads/writes `watchlist_items` through
 *     `supabase.from(...)` and pulls quotes from a bundled `@/data/companies`
 *     module. This page keeps `fetchWatchlist` / `addToWatchlist` /
 *     `removeFromWatchlist` / `reorderWatchlist` and the per-row
 *     `/market/quote/:exch/:ticker` query exactly as they were.
 *   - The alerts column. The export's `WatchItem` carries `alerts_enabled` and
 *     it renders an email-alert toggle in every row; our `WatchlistItem` type
 *     has no such field, so there is nothing to bind a toggle to here. See the
 *     note on `CardRow`.
 *   - The invented figures in the export's copy ("14,238 filings", "2,417
 *     juniors", "+38% median 90-day move", "47 min"). No hard-coded number is
 *     copied; every value rendered below comes from the API (10 and 20 are the
 *     caps this page actually applies, not marketing figures).
 *   - The signed-out sign-in gate. The export let a visitor keep a local list,
 *     so the gate is replaced by the guest list rather than sitting in front of
 *     it. Everything else about the page is unchanged.
 *
 * House conventions the earlier ports established are applied here: every list
 * is a `card-surface` container with `divide-y divide-border` rows (never
 * stacked floating cards), tickers are monospace `TSX-V: AUR` via
 * `formatTickerLabel`, the brand is "OreWire", and move colours use the
 * `text-up` / `text-down` tokens rather than raw HSL.
 */

const COMMODITY_SLUG_TO_LABEL: Record<string, string> = {
  ...COMMODITY_SLUG_LABELS,
  SLVR: "Silver",
  COPR: "Copper",
  LITH: "Lithium",
  NICK: "Nickel",
  PLAT: "Platinum",
  PALL: "Palladium",
};

const CURRENCY_LABELS: Record<string, { name: string; subtitle: string }> = {
  USDCAD: { name: "USD / CAD", subtitle: "" },
  AUDUSD: { name: "AUD / USD", subtitle: "" },
  CADAUD: { name: "CAD / AUD", subtitle: "" },
  DXY:    { name: "DXY",       subtitle: "US Dollar Index" },
};

const INDEX_LABELS: Record<string, string> = {
  TSX: "S&P/TSX Composite",
  TSXV: "TSX Venture Composite",
  TSXMINE: "S&P/TSX Global Mining",
  XAU: "Philadelphia Gold & Silver",
  HUI: "NYSE Arca Gold BUGS",
  GDX: "VanEck Gold Miners ETF",
  GDXJ: "VanEck Junior Gold Miners",
  COPX: "Global X Copper Miners ETF",
  URA: "Global X Uranium ETF",
  LIT: "Global X Lithium ETF",
};

function fmtIndexPrice(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "-";
  return `$${n.toFixed(Math.abs(n) < 1 ? 3 : 2)}`;
}

function fmtChgAbs(n: number | null | undefined, price: number | null | undefined) {
  if (n == null) return "-";
  const d = price != null && Math.abs(price) < 1 ? 3 : 2;
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(d)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtVol(n: number | null | undefined) {
  if (n == null) return "-";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

function fmtMcap(n: number | null | undefined) {
  if (n == null) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n.toFixed(0)}`;
}

function normalizeExchangeForTv(ex: string | null): string | null {
  if (!ex) return null;
  return ex.toUpperCase().replace("-", "");
}

// Absolute change derived from price + percent change (these feeds only give %).
function deriveChangeAbs(price: number | null | undefined, pct: number | null | undefined): number | null {
  if (price == null || pct == null) return null;
  return price - price / (1 + pct / 100);
}

/**
 * The export's column header: a muted uppercase mono strip inside the card,
 * separated from the rows by a single rule rather than sitting in its own box.
 * Columns 4–8 (price … market cap) are right-aligned, as in the export.
 *
 * The `pr-12` reserves the trailing actions track (the delete button, which is
 * absolutely positioned in each row and therefore outside the grid), so the
 * last label lines up with the column it names. The tenth track is the tags
 * line, which the rows drop onto a second grid line, so it takes no label.
 */
const RIGHT_ALIGNED_COLUMNS = new Set([3, 4, 5, 6, 7]);

const ColumnHeader = ({ labels }: { labels: string[] }) => (
  <div className="hidden md:grid md:grid-cols-[44px_92px_56px_minmax(140px,1fr)_84px_88px_76px_80px_minmax(120px,220px)] items-center gap-3 pl-4 pr-12 py-2.5 bg-muted/40 border-b border-border font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
    <div />
    {labels.map((l, i) => (
      // Index in the key: the spot lists deliberately pass blank labels for the
      // columns they have no data for, so the labels are not unique.
      <div key={`${i}-${l}`} className={RIGHT_ALIGNED_COLUMNS.has(i) ? "text-right" : ""}>{l}</div>
    ))}
  </div>
);

/** Section heading that introduces each `card-surface` list (Companies, Indexes, …). */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2 first:mt-0">
    {children}
  </h2>
);

/**
 * One watchlist row, shaped like the export's grid row.
 *
 * The row opens `href` when clicked, exactly as the export's row div does with
 * `nav(...)`, plus Enter/Space for keyboard users. The export used a stretched
 * overlay anchor for this; that is not possible here, because an absolutely
 * positioned element is still a grid item as far as auto-placement is
 * concerned — it consumes a track and pushes the following cells onto a second
 * row, adding ~20px to every row. The company name is a real `<Link>` instead,
 * so the row still exposes a genuine link target, and the reorder / remove
 * controls sit at `z-10` and stop propagation so they never navigate.
 *
 * `metrics` are passed as pre-formatted strings because the three list types
 * format their numbers differently (company quotes vs. spot prices vs. index
 * levels) while the row itself only cares about layout.
 */
type CardRowProps = {
  href: string;
  /** Navigates to the row's detail page — used by the row click and Enter. */
  onOpen: () => void;
  /** Screen-reader name for the row, e.g. `TSX-V: SCZ`. */
  openLabel: string;
  /** Prefix for the reorder buttons' labels, e.g. `Reorder TSX-V: SCZ`. */
  orderLabel: string;
  orderPrev: string;
  orderNext: string;
  onMovePrev: () => void;
  onMoveNext: () => void;
  isFirst: boolean;
  isLast: boolean;
  ticker: string;
  exchange: string | null;
  name: string;
  price: string;
  changeAbs: string;
  changePct: string;
  volume: string;
  marketCap: string;
  tags: string[];
  onRemove: () => void;
  removeLabel: string;
};

const CardRow = ({
  href,
  onOpen,
  openLabel,
  orderLabel,
  orderPrev,
  orderNext,
  onMovePrev,
  onMoveNext,
  isFirst,
  isLast,
  ticker,
  exchange,
  name,
  price,
  changeAbs,
  changePct,
  volume,
  marketCap,
  tags,
  onRemove,
  removeLabel,
}: CardRowProps) => {
  const up = !changePct.startsWith("-") && changePct !== "-";
  const flat = changePct === "-";
  const moveColor = flat ? "text-muted-foreground" : up ? "text-up" : "text-down";
  const tickerLabel = formatTickerLabel(ticker, exchange);

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open ${openLabel}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group relative grid cursor-pointer grid-cols-1 md:grid-cols-[44px_92px_56px_minmax(140px,1fr)_84px_88px_76px_80px_minmax(120px,220px)] md:auto-rows-[20px] items-center gap-x-3 gap-y-2 md:gap-y-1 pl-4 pr-12 py-3 md:py-2.5 hover:bg-muted/40 focus-visible:bg-muted/40 transition-colors"
    >
      {/* Reorder — the export's stacked chevrons, kept as real buttons. */}
      <div className="relative z-10 flex md:flex-col items-center justify-start gap-1 md:gap-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMovePrev(); }}
          disabled={isFirst}
          aria-label={`${orderLabel} — ${orderPrev}`}
          title={orderPrev}
          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveNext(); }}
          disabled={isLast}
          aria-label={`${orderLabel} — ${orderNext}`}
          title={orderNext}
          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Ticker — monospace, `TSX-V: AUR`. */}
      <span className="min-w-0 font-mono text-[13px] font-bold truncate group-hover:underline">{tickerLabel || "-"}</span>

      {/* Exchange, as its own small column exactly as the export lays it out. */}
      <span className="min-w-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground truncate">
        {normalizeExchange(exchange) || "—"}
      </span>

      {/* Company — the row's real link target. */}
      <Link
        to={href}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 font-display font-bold text-[15px] leading-tight truncate hover:underline"
      >
        {name}
      </Link>

      {/* Price / change / volume / cap — mono, tabular, right-aligned as a block. */}
      <span className="min-w-0 md:text-right font-mono text-[13px] font-semibold tabular-nums">{price}</span>
      <span className={`min-w-0 md:text-right font-mono text-[13px] tabular-nums ${moveColor}`}>{changeAbs}</span>
      <span className={`min-w-0 md:text-right font-mono text-[13px] font-semibold tabular-nums inline-flex md:justify-end items-center gap-0.5 ${moveColor}`}>
        {!flat && (up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
        {changePct}
      </span>
      <span className="min-w-0 md:text-right font-mono text-[12px] text-muted-foreground tabular-nums">{volume}</span>
      <span className="min-w-0 md:text-right font-mono text-[13px] tabular-nums">{marketCap}</span>

      {/* Commodity / geography tags — the export's boxed micro-labels, on the
          row's second grid line. The delete button and the company link are
          both grid items too, so the nine data columns already fill the first
          line; the tags take the one after it rather than displacing a column.
          Clipped rather than wrapped so a longer tag list cannot change the
          row's height. */}
      <div className="flex items-center gap-1 min-w-0 overflow-hidden md:col-start-9 md:row-start-2">
        {tags.map((t) => (
          <span key={t} className="text-[10px] font-mono uppercase border border-border px-1.5 py-0.5 leading-none text-muted-foreground whitespace-nowrap shrink-0">
            {t}
          </span>
        ))}
      </div>

      {/* Remove — outside the grid flow, centred in the reserved actions
          column, and the last child so it cannot displace the cells above. */}
      <div className="md:absolute md:right-4 md:top-1/2 md:-translate-y-1/2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={removeLabel}
          title={removeLabel}
          className="p-1.5 text-muted-foreground hover:text-down transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/** Shared wrapper so every list is the same `card-surface` + `divide-y` container.
 *
 * The nine-column row needs ~1120px to lay out; below that the card scrolls
 * horizontally rather than letting the later columns collapse into nothing, and
 * `overflow-hidden` moves to this outer element so the `overflow-x-auto` below
 * can actually scroll instead of being clipped.
 */
const CardList = ({ children }: { children: React.ReactNode }) => (
  <div className="card-surface overflow-x-auto">
    <div className="divide-y divide-border md:min-w-[1120px]">{children}</div>
  </div>
);

const Watchlist = () => {
  const { isAuthenticated, loading } = useAuth();
  const { openSignup } = useSignupModal();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showResults, setShowResults] = useState(false);

  // Guests keep their list in localStorage; the server list is only fetched
  // for a session. Both are `WatchlistItem[]`, so every row below is shared.
  const guestItems = useGuestWatchlist();

  // Unchanged: same query keys, same endpoints, same params.
  const { data: serverItems = [], refetch } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
    enabled: isAuthenticated && !loading,
  });

  const items: WatchlistItem[] = isAuthenticated ? serverItems : guestItems;
  const limit = isAuthenticated ? WATCHLIST_LIMIT : GUEST_WATCHLIST_LIMIT;

  /* The guest list is already reactive, so only the server list needs a refetch
     — and refetch() would bypass `enabled` and 401 for a signed-out visitor. */
  const refresh = () => {
    if (isAuthenticated) refetch();
  };

  const { data: commodityData } = useQuery({
    queryKey: ["commodities"],
    queryFn: fetchCommodities,
    staleTime: 30 * 60 * 1000,
  });

  const commodityByKey = useMemo(() => {
    const map = new Map<string, { price: number | null; change_pct: number | null; unit: string }>();
    commodityData?.items?.forEach(c => map.set(c.key, { price: c.price, change_pct: c.change_pct, unit: c.unit }));
    return map;
  }, [commodityData]);

  const { data: currencyData } = useQuery({
    queryKey: ["currencies"],
    queryFn: fetchCurrencies,
    staleTime: 30 * 60 * 1000,
  });

  const currencyByKey = useMemo(() => {
    const map = new Map<string, { price: number | null; change_pct: number | null; subtitle: string | null }>();
    currencyData?.items?.forEach(c => map.set(c.key, { price: c.price, change_pct: c.change_pct, subtitle: c.subtitle }));
    return map;
  }, [currencyData]);

  const { data: indexData } = useQuery({
    queryKey: ["indexes"],
    queryFn: fetchIndexes,
    staleTime: 30 * 60 * 1000,
  });

  const indexByKey = useMemo(() => {
    const map = new Map<string, { price: number | null; change_pct: number | null; label: string; currency: string | null }>();
    indexData?.items?.forEach(idx => map.set(idx.key, {
      price: idx.price,
      change_pct: idx.change_pct,
      label: idx.label,
      currency: idx.currency,
    }));
    return map;
  }, [indexData]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Unchanged: same search endpoint and the same limit/page params. Enabled for
  // guests too — the search is how a signed-out visitor fills a local list.
  const { data: searchData } = useQuery({
    queryKey: ["watchlist-search", debounced],
    queryFn: () => fetchCompanies({ search: debounced, limit: 8, page: 1 }),
    enabled: debounced.length > 0,
  });

  const results = useMemo<Company[]>(() => searchData?.data ?? [], [searchData]);
  const companyItems = items.filter(i => i.itemType === "company");
  const commodityItems = items.filter(i => i.itemType === "commodity");
  const indexItems = items.filter(i => i.itemType === "index");
  const currencyItems = items.filter(i => i.itemType === "currency");
  const isEmpty = companyItems.length === 0 && commodityItems.length === 0 && indexItems.length === 0 && currencyItems.length === 0;

  if (loading) {
    return (
      <SiteLayout className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
      </SiteLayout>
    );
  }

  /* The signed-out gate is gone: a visitor without a session now gets the
     export's local guest list (GUEST_WATCHLIST_LIMIT companies, saved on the
     device) instead of a wall, and only the counters and the sign-up nudge
     below differ between the two modes. */
  const handleAddCompany = async (c: Company) => {
    const itemKey = String(c.id);
    const already = items.some(i => i.itemType === "company" && i.itemKey === itemKey);
    const label = formatTickerLabel(c.ticker, c.exchange) || c.name;

    /* Guest: keep it on the device, up to GUEST_WATCHLIST_LIMIT. At the cap the
       export queues the company for after sign-in (its `openSignup({ action })`)
       and says why — the queued add is replayed by @/hooks/use-signup-modal. */
    if (!isAuthenticated) {
      const result = addGuestWatchlist({
        companyId: c.id,
        companyName: c.name,
        ticker: c.ticker,
        exchange: c.exchange,
        marketCap: c.market_cap,
        commodities: c.commodities,
        continents: c.continents,
        country: c.country,
      });
      if (result === "full") {
        openSignup({ context: "watchlist", ticker: label });
        toast.message(guestWatchlistFullMessage(GUEST_WATCHLIST_LIMIT));
        return;
      }
      if (result === "duplicate" || already) return;
      toast.success(`${label} added to your watchlist`);
      setSearch("");
      return;
    }

    if (already) return;
    try {
      await addToWatchlist("company", itemKey, c.id);
      refresh();
      toast.success(`${label} added to your watchlist`);
      setSearch("");
    } catch (err) {
      /* The server's cap rejection carries the export's exact copy. */
      toast.error(
        err instanceof WatchlistLimitError
          ? err.message
          : `Could not add ${label} to your watchlist`,
      );
    }
  };

  const handleRemove = async (itemType: string, itemKey: string) => {
    if (!isAuthenticated) {
      removeGuestWatchlist(itemKey);
      return;
    }
    try {
      await removeFromWatchlist(itemType, itemKey);
      refresh();
    } catch { /* skip */ }
  };

  return (
    <SiteLayout className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header — the export's eyebrow / display headline / muted standfirst,
          plus its `{n}/{limit}` counter and, for guests, its "saved on this
          device" line and "Sign up free to add more companies" link. */}
      <section className="border-b border-border bg-card">
        <div className="container-page section-y">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Your list</div>
              <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">Watchlist</h1>
              <p className="text-muted-foreground mt-2 max-w-xl">
                {isAuthenticated
                  ? "Track the juniors, indexes, commodities and currencies you care about. Synced to your account."
                  : `Free for up to ${limit} companies, saved on this device.`}
              </p>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mt-3">
                <span className={companyItems.length >= limit ? "text-down" : undefined}>
                  {companyItems.length}/{limit}
                </span>{" "}
                companies
                {isAuthenticated && (
                  <>
                    <span className="mx-1.5">·</span>{indexItems.length} indexes
                    <span className="mx-1.5">·</span>{commodityItems.length} commodities
                    <span className="mx-1.5">·</span>{currencyItems.length} currencies
                  </>
                )}
              </p>
              {!isAuthenticated && (
                <p className="text-sm text-muted-foreground mt-2">
                  <Link to="/register?redirect=/watchlist" className="underline text-foreground">Sign up free</Link>{" "}
                  to add more companies and get email alerts.
                </p>
              )}
            </div>
            <button
              onClick={() => { setShowResults(true); setTimeout(() => document.getElementById("watchlist-search-input")?.focus(), 50); }}
              className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-11 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" /> Add company
            </button>
          </div>
        </div>
      </section>

      <main className="flex-1">
        <div className="container-page section-y space-y-6">
          {/* Add-company search — the export's card with a two-column result grid. */}
          <div className="card-surface">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                id="watchlist-search-input"
                type="text"
                placeholder="Search company name or ticker..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setShowResults(true); }}
                onFocus={() => setShowResults(true)}
                className="w-full pl-11 pr-4 h-12 bg-transparent text-sm outline-none"
              />
            </div>
            {showResults && debounced && results.length > 0 && (
              <div className="border-t border-border grid sm:grid-cols-2 gap-px bg-border">
                {results.map((c) => {
                  const already = items.some(i => i.itemType === "company" && i.itemKey === String(c.id));
                  return (
                    <button key={c.id} disabled={already} onClick={() => handleAddCompany(c)}
                      className="bg-card text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-bold">
                          {formatTickerLabel(c.ticker, c.exchange) || "-"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{c.name}</div>
                      </div>
                      <Plus className="w-4 h-4 text-accent shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Companies. */}
          {companyItems.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Companies</SectionLabel>
              <CompaniesList
                items={companyItems}
                onRemove={handleRemove}
                refetch={refresh}
                onReorder={isAuthenticated ? undefined : (rows) => reorderGuestWatchlist(rows.map((r) => r.itemKey))}
              />
            </section>
          )}

          {/* Commodities. */}
          {commodityItems.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Commodities</SectionLabel>
              <SpotList
                nameHeader="Name"
                priceHeader="Spot price"
                onRemove={handleRemove}
                refetch={refresh}
                rows={commodityItems.map((it) => {
                  const slug = it.itemKey.toUpperCase();
                  const apiKey = commodityApiKeyFromSlug(slug);
                  const data = commodityByKey.get(apiKey);
                  const price = data?.price ?? null;
                  const abs = deriveChangeAbs(price, data?.change_pct);
                  return {
                    id: it.id,
                    itemType: "commodity",
                    itemKey: it.itemKey,
                    symbol: slug,
                    exchange: null,
                    name: COMMODITY_SLUG_TO_LABEL[slug] || slug,
                    nameSuffix: data?.unit ? `/ ${data.unit}` : null,
                    href: `/market/commodity/${slug}`,
                    changePct: data?.change_pct ?? null,
                    priceText: price != null ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "-",
                    changeAbsText: abs != null ? `${abs >= 0 ? "+" : "-"}$${Math.abs(abs).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "-",
                  };
                })}
              />
            </section>
          )}

          {/* Indexes. */}
          {indexItems.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Indexes</SectionLabel>
              <SpotList
                nameHeader="Index"
                priceHeader="Level"
                onRemove={handleRemove}
                refetch={refresh}
                rows={indexItems.map((it) => {
                  const slug = it.itemKey.toUpperCase();
                  const data = indexByKey.get(slug);
                  const price = data?.price ?? null;
                  const abs = deriveChangeAbs(price, data?.change_pct);
                  return {
                    id: it.id,
                    itemType: "index",
                    itemKey: it.itemKey,
                    symbol: slug,
                    exchange: null,
                    name: data?.label || INDEX_LABELS[slug] || slug,
                    nameSuffix: null,
                    href: `/market/index/${slug}`,
                    changePct: data?.change_pct ?? null,
                    priceText: price != null ? `${fmtIndexPrice(price)}${data?.currency ? ` ${data.currency}` : ""}` : "-",
                    changeAbsText: abs != null ? `${abs >= 0 ? "+" : "-"}${fmtIndexPrice(Math.abs(abs))}` : "-",
                  };
                })}
              />
            </section>
          )}

          {/* Currencies. */}
          {currencyItems.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Currencies</SectionLabel>
              <SpotList
                nameHeader="Pair"
                priceHeader="Rate"
                onRemove={handleRemove}
                refetch={refresh}
                rows={currencyItems.map((it) => {
                  const slug = it.itemKey.toUpperCase();
                  const data = currencyByKey.get(slug);
                  const meta = CURRENCY_LABELS[slug];
                  const price = data?.price ?? null;
                  const abs = deriveChangeAbs(price, data?.change_pct);
                  return {
                    id: it.id,
                    itemType: "currency",
                    itemKey: it.itemKey,
                    symbol: slug,
                    exchange: null,
                    name: meta?.name || slug,
                    nameSuffix: meta?.subtitle || data?.subtitle || null,
                    href: `/market/currency/${slug}`,
                    changePct: data?.change_pct ?? null,
                    priceText: price != null ? price.toFixed(4) : "-",
                    changeAbsText: abs != null ? `${abs >= 0 ? "+" : "-"}${Math.abs(abs).toFixed(4)}` : "-",
                  };
                })}
              />
            </section>
          )}

          {/* Empty state — the export's dashed card. */}
          {isEmpty && (
            <div className="border border-dashed border-border bg-card/50 p-12 text-center">
              <p className="font-display text-lg font-bold mb-2">Your watchlist is empty</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {isAuthenticated ? (
                  <>
                    Search for a company above, or use <span className="font-semibold text-foreground">Watchlist</span> on
                    any company, index, commodity or currency page.
                  </>
                ) : (
                  <>
                    Search for a company above, or use <span className="font-semibold text-foreground">Watchlist</span> on
                    any company page. Your first {GUEST_WATCHLIST_LIMIT} companies are saved on this device — no account
                    needed.
                  </>
                )}
              </p>
            </div>
          )}

          {items.length > 0 && (
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Use the arrows to reorder · click a row to open it · trash removes it
            </p>
          )}
        </div>
      </main>
    </SiteLayout>
  );
};

// ---------------------------------------------------------------------------
// Company watchlist list — live quote columns + up/down reordering.
// ---------------------------------------------------------------------------

const CompaniesList = ({
  items,
  onRemove,
  refetch,
  onReorder,
}: {
  items: WatchlistItem[];
  onRemove: (itemType: string, itemKey: string) => void;
  refetch: () => void;
  /** Replaces the server reorder call — the guest list reorders locally. */
  onReorder?: (rows: WatchlistItem[]) => void | Promise<void>;
}) => {
  const [rows, setRows] = useState<WatchlistItem[]>(items);

  // Resync from server whenever the fetched list changes (after add/remove/reorder).
  useEffect(() => { setRows(items); }, [items]);

  // Unchanged: same optimistic swap, same PUT /watchlist/reorder payload.
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const prev = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next); // optimistic
    try {
      if (onReorder) await onReorder(next);
      else await reorderWatchlist(next.map((r) => r.id));
      refetch();
    } catch {
      setRows(prev); // revert on failure
    }
  };

  return (
    <CardList>
      <ColumnHeader labels={["Ticker", "Exch", "Company", "Price", "Chg $", "Chg %", "Volume", "Mkt Cap"]} />
      {rows.map((it, i) => (
        <CompanyRow
          key={it.id}
          it={it}
          isFirst={i === 0}
          isLast={i === rows.length - 1}
          onMove={(dir) => move(i, dir)}
          onRemove={() => onRemove("company", it.itemKey)}
        />
      ))}
    </CardList>
  );
};

/**
 * A company row. Quotes still come from the same per-row
 * `/market/quote/:exchange/:ticker` query with the same key and params, and the
 * same 5-minute staleTime — only the presentation changed.
 */
const CompanyRow = ({
  it,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  it: WatchlistItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const navigate = useNavigate();
  const exForTv = normalizeExchangeForTv(it.exchange);
  const enabled = !!(exForTv && it.ticker);
  const { data: quote } = useQuery({
    queryKey: ["watchlist-row-quote", exForTv, it.ticker],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/market/quote/${exForTv}/${it.ticker}`);
      if (!res.ok) return null;
      return res.json() as Promise<{
        price: number | null;
        change_pct: number | null;
        change_abs: number | null;
        volume: number | null;
      }>;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const price = quote?.price ?? null;
  const changeAbs = quote?.change_abs ?? null;
  const volume = quote?.volume ?? null;
  const commodities = it.commodities ?? [];
  const geo = [it.country, ...(it.continents ?? [])].filter(Boolean) as string[];
  // One commodity + the primary country. The export prints two commodity tags
  // and a continent here; the tag column is the one field with no fixed width,
  // so this is the slice that still fits on one line.
  const tags = [...commodities.slice(0, 1), ...geo.slice(0, 1)];

  return (
    <CardRow
      href={`/company/${companySlug(it.exchange, it.ticker)}`}
      onOpen={() => navigate(`/company/${companySlug(it.exchange, it.ticker)}`)}
      openLabel={`${formatTickerLabel(it.ticker, it.exchange) || it.companyName || "company"} on OreWire`}
      orderLabel={`Reorder ${formatTickerLabel(it.ticker, it.exchange)}`}
      orderPrev="Move up"
      orderNext="Move down"
      onMovePrev={() => onMove(-1)}
      onMoveNext={() => onMove(1)}
      isFirst={isFirst}
      isLast={isLast}
      ticker={it.ticker || ""}
      exchange={it.exchange}
      name={it.companyName || "-"}
      price={fmtPrice(price)}
      changeAbs={fmtChgAbs(changeAbs, price)}
      changePct={fmtPct(quote?.change_pct)}
      volume={fmtVol(volume)}
      marketCap={fmtMcap(it.marketCap)}
      tags={tags}
      onRemove={onRemove}
      removeLabel={`Remove ${formatTickerLabel(it.ticker, it.exchange)} from watchlist`}
    />
  );
};

// ---------------------------------------------------------------------------
// Spot watchlist list (commodities / indexes / currencies) — reorder + Chg$.
// ---------------------------------------------------------------------------

type SpotRow = {
  id: number;
  itemType: string;
  itemKey: string;
  symbol: string;
  exchange: string | null;
  name: string;
  nameSuffix: string | null;
  href: string;
  changePct: number | null;
  priceText: string;
  changeAbsText: string;
};

const SpotList = ({
  nameHeader,
  priceHeader,
  rows: incoming,
  onRemove,
  refetch,
}: {
  nameHeader: string;
  priceHeader: string;
  rows: SpotRow[];
  onRemove: (itemType: string, itemKey: string) => void;
  refetch: () => void;
}) => {
  const [rows, setRows] = useState<SpotRow[]>(incoming);

  // Resync whenever the source list / live quotes change.
  useEffect(() => { setRows(incoming); }, [incoming]);

  // Unchanged: same optimistic swap and PUT /watchlist/reorder payload.
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const prev = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next); // optimistic
    try {
      await reorderWatchlist(next.map((r) => r.id));
      refetch();
    } catch {
      setRows(prev); // revert on failure
    }
  };

  // Spot instruments have no volume / market cap / tags, so those three cells
  // stay empty — the columns are kept so every row in the app lines up on the
  // same grid. The last three labels are blank for the same reason.
  return (
    <CardList>
      <ColumnHeader labels={["Symbol", "Exch", nameHeader, priceHeader, "Chg $", "Chg %", "", ""]} />
      {rows.map((r, i) => (
        <SpotRowView
          key={r.id}
          row={r}
          isFirst={i === 0}
          isLast={i === rows.length - 1}
          onMove={(dir) => move(i, dir)}
          onRemove={() => onRemove(r.itemType, r.itemKey)}
        />
      ))}
    </CardList>
  );
};

const SpotRowView = ({
  row,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  row: SpotRow;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const navigate = useNavigate();
  return (
    <CardRow
      href={row.href}
      onOpen={() => navigate(row.href)}
      openLabel={row.name}
      orderLabel={`Reorder ${row.symbol}`}
      orderPrev="Move up"
      orderNext="Move down"
      onMovePrev={() => onMove(-1)}
      onMoveNext={() => onMove(1)}
      isFirst={isFirst}
      isLast={isLast}
      ticker={row.symbol}
      exchange={row.exchange}
      name={row.nameSuffix ? `${row.name} ${row.nameSuffix}` : row.name}
      price={row.priceText}
      changeAbs={row.changeAbsText}
      changePct={row.changePct == null ? "-" : `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%`}
      volume="-"
      marketCap="-"
      tags={[]}
      onRemove={onRemove}
      removeLabel={`Remove ${row.symbol} from watchlist`}
    />
  );
};

export default Watchlist;
