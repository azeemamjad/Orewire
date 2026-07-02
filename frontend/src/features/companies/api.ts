import { API_BASE, authFetch } from '@/lib/api-client';

export interface Company {
  id: number;
  exchange: string | null;
  name: string;
  ticker: string | null;
  sedar_ticker: string | null;
  market_cap: number | null;
  total_float: number | null;
  has_gold: number;
  has_silver: number;
  has_copper: number;
  sector: string | null;
  listing_date: string | null;
  region: string | null;
  commodities?: string[];
  continents?: string[];
  country?: string | null;
  status?: string | null;
  description?: string | null;
  website?: string | null;
  headquarters?: string | null;
  transfer_agent?: string | null;
  phone?: string | null;
  shares_outstanding?: number | null;
  profile_source?: string | null;
}

export interface CompanyFilters {
  markets: string[];
  commodities: string[];
  continents: string[];
  countries: string[];
  statuses: string[];
}

export async function fetchCompanyFilters(): Promise<CompanyFilters> {
  const res = await fetch(`${API_BASE}/companies/filters`);
  if (!res.ok) throw new Error(`Failed to fetch filters: ${res.status}`);
  return res.json();
}

export interface MarketData {
  price: number | null;
  change_pct: number | null;
  change_abs: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  sector: string | null;
  country: string | null;
  description: string | null;
  perf_week: number | null;
  perf_month: number | null;
  perf_ytd: number | null;
  perf_year: number | null;
  recommend: number | null;
  currency: string | null;
  price_52_week_high: number | null;
  price_52_week_low: number | null;
  source?: 'tradingview' | 'yahoo';
  error?: string;
}

export interface CompanyFundamentals {
  market_cap: number | null;
  market_cap_currency: string | null;
  shares_outstanding: number | null;
  avg_volume_30d: number | null;
  isin: string | null;
  cusip: string | null;
  currency: string | null;
}

export interface CompanyInstrumentSymbol {
  id: number;
  exchange: string | null;
  ticker: string;
  tv_symbol: string;
  label: string | null;
  is_default: boolean;
  sort_order: number;
}

export interface CompanyDetail extends Company {
  symbols?: CompanyInstrumentSymbol[];
  symbol_flagged_at?: string | null;
  symbol_flagged_reason?: string | null;
  marketData: MarketData | null;
  fundamentals: CompanyFundamentals | null;
  filings: { id: number; filing_type: string | null; commodity: string | null; created_at: string; verdict: string | null; summary: string | null }[];
}

export interface PaginatedCompanies {
  data: Company[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export async function fetchCompanies(params: {
  page?: number;
  limit?: number;
  search?: string;
  exchange?: string;
  commodity?: string;
  continent?: string;
  country?: string;
  status?: string;
}): Promise<PaginatedCompanies> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.exchange && params.exchange !== 'All') qs.set('exchange', params.exchange);
  if (params.commodity) qs.set('commodity', params.commodity);
  if (params.continent) qs.set('continent', params.continent);
  if (params.country) qs.set('country', params.country);
  if (params.status) qs.set('status', params.status);

  const res = await fetch(`${API_BASE}/companies?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch companies: ${res.status}`);
  return res.json();
}

export async function fetchCompany(idOrSlug: number | string): Promise<CompanyDetail> {
  const res = await fetch(`${API_BASE}/companies/${idOrSlug}`);
  if (!res.ok) throw new Error(`Failed to fetch company: ${res.status}`);
  return res.json();
}

export interface InsiderOwner {
  insider_name: string;
  title: string | null;
  total_shares: number | null;
  percent_ownership: number | null;
  last_transaction: string | null;
  last_transaction_date: string | null;
}

export interface InsiderTransaction {
  insider_name: string;
  title: string | null;
  transaction_type: string | null;
  shares: number | null;
  price: number | null;
  transaction_date: string | null;
  total_holdings_after: number | null;
}

export interface CompanyInsiders {
  registered: boolean;
  ownershipTotal: number;
  transactionsTotal: number;
  ownership: InsiderOwner[];
  transactions: InsiderTransaction[];
}

export async function fetchCompanyInsiders(companyId: number): Promise<CompanyInsiders> {
  const res = await authFetch(`${API_BASE}/companies/${companyId}/insiders`);
  if (!res.ok) return { registered: false, ownershipTotal: 0, transactionsTotal: 0, ownership: [], transactions: [] };
  return res.json();
}

export interface CompanySnapshot {
  paragraphs: string[];
  keyPoints: string[];
  body?: string;
  generatedAt: string;
  sourcesMeta?: Record<string, unknown>;
  stale?: boolean;
  model?: string | null;
}

export type CompanySnapshotStatus = "ready" | "generating" | "empty";

export interface CompanySnapshotResponse {
  status: CompanySnapshotStatus;
  needsRegen?: boolean;
  snapshot: CompanySnapshot | null;
}

export async function fetchCompanySnapshot(companyId: number): Promise<CompanySnapshotResponse> {
  const res = await fetch(`${API_BASE}/companies/${companyId}/snapshot`);
  if (!res.ok) {
    return { status: "empty", snapshot: null };
  }
  const data = await res.json();
  return {
    status: data.status || (data.snapshot ? "ready" : "empty"),
    needsRegen: data.needsRegen,
    snapshot: data.snapshot ?? null,
  };
}

export interface CompanyPerson {
  id: number;
  name: string;
  role_code: string | null;
  title: string | null;
  age: number | null;
  since_year: number | null;
  kind: "manager" | "director";
  source: string;
  updated_at: string;
}

export interface CompanyProfileResponse {
  company: {
    id: number;
    exchange: string | null;
    ticker: string | null;
    name: string;
    description: string | null;
    website: string | null;
    headquarters: string | null;
    transfer_agent: string | null;
    phone: string | null;
    shares_outstanding: number | null;
    profile_source: string | null;
    ms_slug: string | null;
    profile_scraped_at: string | null;
  };
  people: CompanyPerson[];
}

export async function fetchCompanyProfile(id: number): Promise<CompanyProfileResponse> {
  const res = await fetch(`${API_BASE}/companies/${id}/profile`);
  if (!res.ok) throw new Error(`Failed to fetch company profile: ${res.status}`);
  return res.json();
}

export function companySlug(exchange: string | null, ticker: string | null): string {
  const ex = (exchange || "").toUpperCase().replace("-", "");
  const tk = (ticker || "").toUpperCase();
  if (ex && tk) return `${ex}-${tk}`;
  return tk || "unknown";
}

export async function fetchCompanyExchanges(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/companies/exchanges`);
  if (!res.ok) throw new Error(`Failed to fetch exchanges: ${res.status}`);
  return res.json();
}

export interface Discussion {
  id: number;
  companyId: number;
  userId: number;
  userEmail: string;
  body: string;
  score: number;
  userVote: number;
  createdAt: string;
}

export async function fetchDiscussions(companyId: number): Promise<Discussion[]> {
  const res = await authFetch(`${API_BASE}/discussions/${companyId}`);
  if (!res.ok) throw new Error(`Failed to fetch discussions: ${res.status}`);
  return res.json();
}

export async function postDiscussion(companyId: number, body: string): Promise<Discussion> {
  const res = await authFetch(`${API_BASE}/discussions/${companyId}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to post: ${res.status}`);
  return data as Discussion;
}

export async function voteDiscussion(companyId: number, commentId: number, vote: number): Promise<{ score: number; userVote: number }> {
  const res = await authFetch(`${API_BASE}/discussions/${companyId}/${commentId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ vote }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to vote: ${res.status}`);
  return data;
}
