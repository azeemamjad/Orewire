import { API_BASE } from '@/lib/api-client';

export interface InstrumentSymbol {
  id: number;
  entity_type: string;
  entity_id: number | null;
  entity_key: string | null;
  exchange: string | null;
  ticker: string;
  tv_symbol: string;
  label: string | null;
  is_default: boolean;
  sort_order: number;
}

export interface LiveTvQuote {
  price: number | null;
  change_pct: number | null;
  change_abs: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  currency: string | null;
  tv_symbol: string;
  source: string;
  updatedAt: string;
}

export type InstrumentEntityType = 'company' | 'commodity' | 'currency' | 'index';

export async function fetchInstrumentSymbols(
  entityType: InstrumentEntityType,
  entityKey: string,
): Promise<{ items: InstrumentSymbol[] }> {
  const res = await fetch(
    `${API_BASE}/market/instruments/${entityType}/${encodeURIComponent(entityKey)}/symbols`,
  );
  if (!res.ok) throw new Error(`Failed to fetch symbols: ${res.status}`);
  return res.json();
}

export async function fetchTvQuoteBySymbol(symbol: string): Promise<LiveTvQuote | null> {
  const qs = new URLSearchParams({ symbol });
  const res = await fetch(`${API_BASE}/market/quote?${qs.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.unavailable || data.price == null) return null;
  return data as LiveTvQuote;
}
