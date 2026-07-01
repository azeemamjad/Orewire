import { API_BASE, authFetch } from '@/lib/api-client';
import type { Discussion } from '@/features/companies/api';

export interface MoverItem {
  ticker: string;
  name: string;
  exchange: string;
  price: number | null;
  change_pct: number | null;
  market_cap: number | null;
  volume: number | null;
  perf_ytd: number | null;
}

export interface MoversResponse {
  exchange: string;
  updatedAt: string;
  gainers: MoverItem[];
  losers: MoverItem[];
}

export async function fetchMovers(opts?: { exchange?: string; limit?: number }): Promise<MoversResponse> {
  const qs = new URLSearchParams();
  qs.set('exchange', opts?.exchange ?? 'ALL');
  qs.set('limit', String(opts?.limit ?? 10));
  const res = await fetch(`${API_BASE}/market/movers?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch movers: ${res.status}`);
  return res.json();
}

export interface CommoditySpot {
  key: string;
  label: string;
  unit: string;
  price: number | null;
  change_pct: number | null;
  change_abs?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  currency?: string | null;
  source?: string | null;
  provider?: string | null;
}

export interface CommodityDetailSpot extends CommoditySpot {
  updatedAt: string;
  history_symbol: string | null;
}

export interface CommodityHistoryPoint {
  t: number;
  date: string;
  label: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface CommoditiesResponse {
  updatedAt: string;
  items: CommoditySpot[];
}

export async function fetchCommodities(): Promise<CommoditiesResponse> {
  const res = await fetch(`${API_BASE}/market/commodities`);
  if (!res.ok) throw new Error(`Failed to fetch commodities: ${res.status}`);
  return res.json();
}

export async function fetchCommodity(key: string): Promise<CommodityDetailSpot> {
  const res = await fetch(`${API_BASE}/market/commodities/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Failed to fetch commodity: ${res.status}`);
  return res.json();
}

export async function fetchCommodityHistory(
  key: string,
  range: string,
): Promise<{ range: string; symbol: string | null; points: CommodityHistoryPoint[] }> {
  const qs = new URLSearchParams({ range });
  const res = await fetch(`${API_BASE}/market/commodities/${encodeURIComponent(key)}/history?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch commodity history: ${res.status}`);
  return res.json();
}

export interface CurrencySpot {
  key: string;
  label: string;
  subtitle: string | null;
  price: number | null;
  change_pct: number | null;
}

export interface CurrenciesResponse {
  updatedAt: string;
  items: CurrencySpot[];
}

export async function fetchCurrencies(): Promise<CurrenciesResponse> {
  const res = await fetch(`${API_BASE}/market/currencies`);
  if (!res.ok) throw new Error(`Failed to fetch currencies: ${res.status}`);
  return res.json();
}

export interface IndexSpot {
  key: string;
  label: string;
  about: string;
  price: number | null;
  change_pct: number | null;
  currency: string | null;
}

export interface IndexesResponse {
  updatedAt: string;
  items: IndexSpot[];
}

export async function fetchIndexes(): Promise<IndexesResponse> {
  const res = await fetch(`${API_BASE}/market/indexes`);
  if (!res.ok) throw new Error(`Failed to fetch indexes: ${res.status}`);
  return res.json();
}

export interface MarketHistoryPoint {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface MarketHistoryResponse {
  kind: string;
  key: string;
  symbol?: string;
  intervalMs: number;
  windowMs: number;
  points: MarketHistoryPoint[];
}

export async function fetchMarketHistory(
  kind: "company" | "commodity" | "currency" | "index",
  key: string,
  opts?: { exchange?: string },
): Promise<MarketHistoryResponse> {
  const qs = new URLSearchParams();
  if (opts?.exchange) qs.set("exchange", opts.exchange);
  const res = await fetch(`${API_BASE}/market/history/${kind}/${encodeURIComponent(key)}${qs.toString() ? `?${qs.toString()}` : ""}`);
  if (!res.ok) {
    return { kind, key, intervalMs: 30 * 60 * 1000, windowMs: 24 * 60 * 60 * 1000, points: [] };
  }
  return res.json();
}

export async function fetchCommodityDiscussions(commodityKey: string): Promise<Discussion[]> {
  const res = await authFetch(`${API_BASE}/discussions/commodity/${commodityKey}`);
  if (!res.ok) return [];
  return res.json();
}

export async function postCommodityDiscussion(commodityKey: string, body: string): Promise<Discussion> {
  const res = await authFetch(`${API_BASE}/discussions/commodity/${commodityKey}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to post: ${res.status}`);
  return data as Discussion;
}

export async function fetchCurrencyDiscussions(currencyKey: string): Promise<Discussion[]> {
  const res = await authFetch(`${API_BASE}/discussions/currency/${currencyKey}`);
  if (!res.ok) return [];
  return res.json();
}

export async function postCurrencyDiscussion(currencyKey: string, body: string): Promise<Discussion> {
  const res = await authFetch(`${API_BASE}/discussions/currency/${currencyKey}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to post: ${res.status}`);
  return data as Discussion;
}

export async function fetchIndexDiscussions(indexKey: string): Promise<Discussion[]> {
  const res = await authFetch(`${API_BASE}/discussions/index/${indexKey}`);
  if (!res.ok) return [];
  return res.json();
}

export async function postIndexDiscussion(indexKey: string, body: string): Promise<Discussion> {
  const res = await authFetch(`${API_BASE}/discussions/index/${indexKey}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to post: ${res.status}`);
  return data as Discussion;
}
