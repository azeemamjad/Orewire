import { useEffect, useState } from "react";
import { GUEST_WATCHLIST_LIMIT, WATCHLIST_LIMIT, type WatchlistItem } from "@/features/watchlist/api";

/**
 * Guest watchlist — the anonymous, device-local watchlist.
 *
 * Ported from the Lovable export:
 *   - src/hooks/useSignupModal.tsx — the two caps and the storage key
 *     (`orewire:guest-watchlist`). The caps themselves are declared in
 *     src/features/watchlist/api.ts, next to the endpoint that enforces the
 *     20, and imported here.
 *   - src/hooks/useWatchlist.tsx — `readGuest` / `writeGuest`, the
 *     `orewire:guest-watchlist-change` event, and the guest branch of `add()`
 *     (at the cap it opens the signup modal and toasts "Your free watchlist is
 *     full (10). Sign up to add more.").
 *
 * The export's version was Supabase-backed for signed-in users; here the guest
 * list is purely local and the signed-in list stays on /api/watchlist, so the
 * only thing that crosses over on sign-in is the merge in
 * src/hooks/use-signup-modal.tsx.
 *
 * Every localStorage access is wrapped: Safari private mode and hardened
 * browsers throw on `localStorage` reads and writes, and a watchlist is never
 * worth breaking a page render over. A throwing browser degrades to an empty,
 * non-persisting guest list — the same list the app had before this feature.
 *
 * A stored entry is a `WatchlistItem` — the same interface GET /api/watchlist
 * returns, filled in from the company search result — so the /watchlist rows
 * are rendered by the same components for guests and signed-in users, and the
 * sign-in merge is a straight hand-off.
 */

/** Same key the export used, so a browser that saw the export keeps its list. */
export const GUEST_WATCHLIST_KEY = "orewire:guest-watchlist";
const GUEST_WATCHLIST_EVENT = "orewire:guest-watchlist-change";

function isWatchlistItem(value: unknown): value is WatchlistItem {
  if (!value || typeof value !== "object") return false;
  const it = value as Partial<WatchlistItem>;
  return typeof it.itemKey === "string" && it.itemKey.length > 0;
}

/** Normalized position is re-derived on every read, so a stale `sortOrder` in
 *  storage can never leave gaps or repeats in the rendered order. */
function withPositions(list: WatchlistItem[]): WatchlistItem[] {
  return list.map((it, i) => ({ ...it, sortOrder: i }));
}

export function readGuestWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(GUEST_WATCHLIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return withPositions(parsed.filter(isWatchlistItem));
  } catch {
    return [];
  }
}

export function writeGuestWatchlist(list: WatchlistItem[] | null): void {
  try {
    if (list && list.length) localStorage.setItem(GUEST_WATCHLIST_KEY, JSON.stringify(withPositions(list)));
    else localStorage.removeItem(GUEST_WATCHLIST_KEY);
  } catch {
    /* storage unavailable — the in-memory list stays correct for this page view */
  }
  emitGuestWatchlistChange();
}

function emitGuestWatchlistChange(): void {
  try {
    window.dispatchEvent(new Event(GUEST_WATCHLIST_EVENT));
  } catch {
    /* no window (SSR / tests) */
  }
}

/** Fires on same-tab writes and on other tabs' writes to the same key. */
export function onGuestWatchlistChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === GUEST_WATCHLIST_KEY) handler();
  };
  window.addEventListener(GUEST_WATCHLIST_EVENT, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(GUEST_WATCHLIST_EVENT, handler);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live view of the guest list for the current tab. */
export function useGuestWatchlist(): WatchlistItem[] {
  const [items, setItems] = useState<WatchlistItem[]>(() => readGuestWatchlist());
  useEffect(() => {
    const sync = () => setItems(readGuestWatchlist());
    sync();
    return onGuestWatchlistChange(sync);
  }, []);
  return items;
}

export type GuestAddResult = "added" | "duplicate" | "full";

/**
 * Add one company to the guest list. Returns why it did or did not land, so the
 * caller can pick the toast copy ("full" is the export's
 * `Your free watchlist is full (10). Sign up to add more.`).
 *
 * `itemKey` follows the /watchlist page's own convention — the company id as a
 * string — because that is what `addToWatchlist("company", String(c.id), c.id)`
 * posts once the visitor signs in, so the merged row is the same row.
 */
export function addGuestWatchlist(input: {
  companyId: number;
  companyName: string;
  ticker?: string | null;
  exchange?: string | null;
  marketCap?: number | null;
  commodities?: string[];
  continents?: string[];
  country?: string | null;
}): GuestAddResult {
  const list = readGuestWatchlist();
  const itemKey = String(input.companyId);
  if (list.some((it) => it.itemKey === itemKey)) return "duplicate";
  if (list.length >= GUEST_WATCHLIST_LIMIT) return "full";

  writeGuestWatchlist([
    ...list,
    {
      id: input.companyId,
      itemType: "company",
      itemKey,
      companyId: input.companyId,
      companyName: input.companyName,
      ticker: input.ticker ?? null,
      exchange: input.exchange ?? null,
      marketCap: input.marketCap ?? null,
      commodities: input.commodities ?? [],
      continents: input.continents ?? [],
      country: input.country ?? null,
      sortOrder: list.length,
      createdAt: new Date().toISOString(),
    },
  ]);
  return "added";
}

export function removeGuestWatchlist(itemKey: string): void {
  writeGuestWatchlist(readGuestWatchlist().filter((it) => it.itemKey !== itemKey));
}

/** Persist a new local order. Keys the caller left out keep their relative order. */
export function reorderGuestWatchlist(orderedItemKeys: string[]): void {
  const list = readGuestWatchlist();
  const byKey = new Map(list.map((it) => [it.itemKey, it]));
  const ordered = orderedItemKeys.map((k) => byKey.get(k)).filter((it): it is WatchlistItem => !!it);
  const mentioned = new Set(orderedItemKeys);
  writeGuestWatchlist([...ordered, ...list.filter((it) => !mentioned.has(it.itemKey))]);
}

/** Drop the whole guest list — used once it has been merged into an account. */
export function clearGuestWatchlist(): void {
  writeGuestWatchlist(null);
}

/**
 * `TICKER-EXCHANGE`, upper-cased. The two key conventions this app writes
 * (`String(companyId)` from the watchlist page and `EXCHANGE+TICKER` from
 * AddToWatchButton) are not interchangeable, so a company is also recognised by
 * its ticker + exchange pair when deciding what is already on a list.
 */
export function companyFingerprint(ticker?: string | null, exchange?: string | null): string {
  return `${(ticker || "").trim().toUpperCase()}-${(exchange || "").trim().toUpperCase()}`;
}

/**
 * Split a guest list into the part that fits an account watchlist and the part
 * that does not. Pure, so the sign-in merge in @/hooks/use-signup-modal and its
 * tests share one definition of "what fits":
 *
 *   - anything already on the account list (by item key or ticker+exchange) is
 *     neither added nor reported — it is simply already there;
 *   - the rest is added while there is room under `limit`;
 *   - whatever is left over is returned as `skipped`, so the caller can say so
 *     instead of dropping it silently.
 */
export function planWatchlistMerge(
  existing: WatchlistItem[],
  guest: WatchlistItem[],
  limit: number = WATCHLIST_LIMIT,
): { toAdd: WatchlistItem[]; skipped: WatchlistItem[] } {
  const haveKeys = new Set(existing.map((it) => it.itemKey));
  const haveCompanies = new Set(existing.map((it) => companyFingerprint(it.ticker, it.exchange)));
  const missing = guest.filter(
    (it) => !haveKeys.has(it.itemKey) && !haveCompanies.has(companyFingerprint(it.ticker, it.exchange)),
  );
  const room = Math.max(0, limit - existing.length);
  return { toAdd: missing.slice(0, room), skipped: missing.slice(room) };
}

/* -------------------------------------------------------------------------
   Ticker labels
   ------------------------------------------------------------------------- */

/**
 * `"TSX-V: SCZ"` → `{ exchange: "TSX-V", ticker: "SCZ" }`.
 * The inverse of `formatTickerLabel` (@/components/site/FeedRow). A label with
 * no colon is treated as a bare ticker.
 */
export function parseTickerLabel(label: string): { exchange: string; ticker: string } {
  const raw = (label || "").trim();
  const sep = raw.indexOf(":");
  if (sep === -1) return { exchange: "", ticker: raw };
  return { exchange: raw.slice(0, sep).trim(), ticker: raw.slice(sep + 1).trim() };
}

/**
 * `"TSX-V: SCZ"` → `"TSXVSCZ"` — the `item_key` convention
 * `AddToWatchButton`'s `toItemKey(market, ticker)` produces.
 *
 * Our `OpenSignupOptions.ticker` is a display label, not a structured ticker, so
 * a queued "add to watchlist" click has to rebuild the key from it. The guards
 * in `use-signup-modal.tsx` keep the CompanyDetail fallback label
 * (`"this company"`, used when a company has no ticker) out of the queue.
 */
export function tickerLabelToItemKey(label: string): string {
  return (label || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when a label is a real ticker label and can be replayed as an add. */
export function isReplayableTickerLabel(label: string): boolean {
  const { ticker } = parseTickerLabel(label);
  return !!ticker && !/\s/.test(ticker) && ticker.length <= 8;
}
