import { API_BASE, authFetch } from '@/lib/api-client';
import { getAuthToken, getRefreshToken } from '@/features/auth/api';

/**
 * Watchlist caps — the export's `WATCHLIST_LIMIT` (20) and
 * `GUEST_WATCHLIST_LIMIT` (10) from orewire2 src/hooks/useSignupModal.tsx.
 *
 * 20 is enforced server-side in Server/routes/api/watchlist.js; the constant
 * here exists for the `{n}/{limit}` header count and for the fallback copy if a
 * response ever omits the limit. 10 is enforced locally by
 * src/features/watchlist/guest-watchlist.ts.
 */
export const WATCHLIST_LIMIT = 20;
export const GUEST_WATCHLIST_LIMIT = 10;
/** Machine-readable code the add endpoint returns when the cap is reached. */
export const WATCHLIST_LIMIT_CODE = 'watchlist_limit_reached';

/** The server's human copy for a capped add, reproduced if a reply omits it. */
export function watchlistFullMessage(limit: number = WATCHLIST_LIMIT): string {
  return `Your watchlist is full (${limit}). Remove a company to add another.`;
}

/** The guest equivalent — the export's `Your free watchlist is full (10). Sign up to add more.` */
export function guestWatchlistFullMessage(limit: number = GUEST_WATCHLIST_LIMIT): string {
  return `Your free watchlist is full (${limit}). Sign up to add more.`;
}

/**
 * Thrown by `addToWatchlist` when the server refuses an add because the
 * signed-in watchlist is at the cap. `message` is the server's copy verbatim,
 * so callers toast it unchanged.
 */
export class WatchlistLimitError extends Error {
  readonly code = WATCHLIST_LIMIT_CODE;
  readonly limit: number;

  constructor(message: string, limit: number) {
    super(message);
    this.name = 'WatchlistLimitError';
    this.limit = limit;
  }
}

export interface WatchlistItem {
  id: number;
  itemType: string;
  itemKey: string;
  companyId: number | null;
  companyName: string | null;
  ticker: string | null;
  exchange: string | null;
  marketCap: number | null;
  commodities?: string[];
  continents?: string[];
  country?: string | null;
  sortOrder?: number | null;
  createdAt: string;
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const res = await authFetch(`${API_BASE}/watchlist`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

export async function reorderWatchlist(ids: number[]): Promise<void> {
  const res = await authFetch(`${API_BASE}/watchlist/reorder`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Failed to reorder watchlist");
}

export type WatchlistAlertType = "news" | "filing" | "insider" | "market";

export interface WatchlistAlert {
  type: WatchlistAlertType;
  id: string;
  at: string;
  href: string;
  companyId?: number;
  companyName?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  title?: string;
  filingType?: string | null;
  verdict?: string | null;
  insiderName?: string;
  insiderTitle?: string | null;
  transactionType?: string | null;
  shares?: number | null;
  itemType?: string;
  itemKey?: string;
  label?: string;
  price?: number;
  changePct?: number;
}

export async function fetchWatchlistAlerts(since: string): Promise<{ alerts: WatchlistAlert[]; serverTime: string }> {
  const qs = new URLSearchParams({ since });
  const res = await authFetch(`${API_BASE}/watchlist/alerts?${qs.toString()}`);
  if (!res.ok) return { alerts: [], serverTime: new Date().toISOString() };
  const data = await res.json();
  return { alerts: data.alerts || [], serverTime: data.serverTime || new Date().toISOString() };
}

export async function addToWatchlist(itemType: string, itemKey: string, companyId?: number): Promise<void> {
  const res = await authFetch(`${API_BASE}/watchlist`, {
    method: 'POST',
    body: JSON.stringify({ itemType, itemKey, companyId }),
  });
  if (res.ok) return;

  /* The cap rejection is a 409 carrying `{ error, code, limit }` (see
     Server/routes/api/watchlist.js). Surface it as its own error type so the
     UI can toast the server's copy instead of a generic failure. */
  let payload: { error?: unknown; code?: unknown; limit?: unknown } | null = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (payload?.code === WATCHLIST_LIMIT_CODE) {
    const limit = typeof payload.limit === 'number' ? payload.limit : WATCHLIST_LIMIT;
    const message = typeof payload.error === 'string' && payload.error ? payload.error : watchlistFullMessage(limit);
    throw new WatchlistLimitError(message, limit);
  }
  throw new Error('Failed to add to watchlist');
}

export async function removeFromWatchlist(itemType: string, itemKey: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/watchlist/${itemType}/${itemKey}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove from watchlist');
}

export async function checkWatchlist(itemType: string, itemKey: string): Promise<boolean> {
  if (!getAuthToken() && !getRefreshToken()) return false;
  try {
    const res = await authFetch(`${API_BASE}/watchlist/check/${itemType}/${itemKey}`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.watched;
  } catch { return false; }
}

export async function checkItemAlert(itemType: string, itemKey: string): Promise<boolean> {
  if (!getAuthToken() && !getRefreshToken()) return false;
  try {
    const res = await authFetch(`${API_BASE}/watchlist/alert/check/${itemType}/${itemKey}`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.alertsEnabled === true;
  } catch {
    return false;
  }
}

export async function setItemAlert(
  itemType: string,
  itemKey: string,
  companyId: number | undefined,
  enabled: boolean,
): Promise<void> {
  const res = await authFetch(`${API_BASE}/watchlist/alert`, {
    method: "POST",
    body: JSON.stringify({ itemType, itemKey, companyId, enabled }),
  });
  if (!res.ok) throw new Error("Failed to update alert");
}
