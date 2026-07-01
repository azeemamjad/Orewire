import { API_BASE, authFetch } from '@/lib/api-client';
import { getAuthToken, getRefreshToken } from '@/features/auth/api';

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
  if (!res.ok) throw new Error('Failed to add to watchlist');
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
