const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export type Verdict = 'Noteworthy' | 'Watch' | 'Routine';
export type Exchange = 'TSX' | 'TSX-V' | 'CSE' | 'ASX';
export type Commodity = 'Gold' | 'Copper' | 'Silver' | 'Lithium' | 'Uranium';

export interface Filing {
  id: number;
  ticker: string;
  company: string;
  exchange: string;
  filingType: string;
  verdict: Verdict | null;
  commodity: Commodity | null;
  time: string;
  summary: string;
}

export interface FilingStats {
  companies: number;
  filings: number;
  analyzed: number;
  noteworthy: number;
  watch: number;
  routine: number;
}

interface RawFiling {
  id: number;
  company_name: string;
  exchange: string | null;
  filing_type: string | null;
  pdf_filename: string;
  analyzed: number;
  status: string;
  created_at: string;
  verdict: Verdict | null;
  ticker_summary: string | null;
  summary: string | null;
  verdict_reason: string | null;
}

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHrs < 24) return `${diffHrs} hr${diffHrs > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

function mapFiling(raw: RawFiling): Filing {
  const tickerMatch = raw.ticker_summary?.match(/^([A-Z]+)/);
  return {
    id: raw.id,
    ticker: tickerMatch?.[1] || raw.company_name.substring(0, 3).toUpperCase(),
    company: raw.company_name,
    exchange: normalizeExchange(raw.exchange),
    filingType: raw.filing_type || 'Filing',
    verdict: raw.verdict,
    commodity: inferCommodity(raw.summary || ''),
    time: getTimeAgo(raw.created_at),
    summary: raw.summary || raw.verdict_reason || 'Analysis pending...',
  };
}

function normalizeExchange(ex: string | null): string {
  if (!ex) return 'TSX-V';
  const upper = ex.toUpperCase();
  if (upper === 'TSX') return 'TSX';
  if (upper.includes('TSXV') || upper.includes('TSX-V')) return 'TSX-V';
  if (upper.includes('CSE')) return 'CSE';
  if (upper.includes('ASX')) return 'ASX';
  return ex;
}

function inferCommodity(summary: string): Commodity | null {
  const s = summary.toLowerCase();
  if (/\b(gold|au|g\/t)\b/i.test(s)) return 'Gold';
  if (/\b(silver|ag)\b/i.test(s)) return 'Silver';
  if (/\b(copper|cu|cu eq|copper equivalent)\b/i.test(s)) return 'Copper';
  if (/\b(lithium|li|spodumene)\b/i.test(s)) return 'Lithium';
  if (/\b(uranium|u3o8|u₃o₈)\b/i.test(s)) return 'Uranium';
  return 'Gold';
}

export async function fetchFilings(filters?: {
  exchange?: string;
  verdict?: string;
  commodity?: string;
  limit?: number;
}): Promise<Filing[]> {
  const params = new URLSearchParams();
  if (filters?.verdict && filters.verdict !== 'All') {
    params.set('verdict', filters.verdict.toLowerCase());
  }
  if (filters?.exchange && filters.exchange !== 'All') {
    params.set('exchange', filters.exchange);
  }
  if (filters?.limit) {
    params.set('limit', String(filters.limit));
  }

  const res = await fetch(`${API_BASE}/filings?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch filings: ${res.status}`);
  const data: RawFiling[] = await res.json();

  let filings = data.map(mapFiling);

  if (filters?.commodity && filters.commodity !== 'All') {
    filings = filings.filter(f => f.commodity === filters.commodity);
  }

  return filings;
}

export async function fetchStats(): Promise<FilingStats> {
  const res = await fetch(`${API_BASE}/filings/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

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
  error?: string;
}

export interface CompanyDetail extends Company {
  marketData: MarketData | null;
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

export async function fetchCompany(id: number): Promise<CompanyDetail> {
  const res = await fetch(`${API_BASE}/companies/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch company: ${res.status}`);
  return res.json();
}

export async function fetchCompanyExchanges(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/companies/exchanges`);
  if (!res.ok) throw new Error(`Failed to fetch exchanges: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

export interface MoverItem {
  ticker: string;
  name: string;
  exchange: string;
  price: number | null;
  change_pct: number | null;
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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'orewire.auth.token';
const USER_KEY = 'orewire.auth.user';

export interface AuthUser {
  id: number;
  email: string;
}

export interface AuthResponse {
  token: string;
  user?: AuthUser;
}

export function getAuthToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const AUTH_EVENT = 'orewire-auth-change';

function emitAuthChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
}

export function onAuthChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(AUTH_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(AUTH_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function setAuth(resp: AuthResponse) {
  try {
    localStorage.setItem(TOKEN_KEY, resp.token);
    if (resp.user) localStorage.setItem(USER_KEY, JSON.stringify(resp.user));
  } catch { /* ignore */ }
  emitAuthChange();
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
  emitAuthChange();
}

async function authRequest(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data as AuthResponse;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const resp = await authRequest('/login', { email, password });
  setAuth(resp);
  return resp;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const resp = await authRequest('/register', { email, password });
  setAuth(resp);
  return resp;
}

export async function logout(): Promise<void> {
  const token = getAuthToken();
  clearAuth();
  if (!token) return;
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'x-auth-token': token },
  }).catch(() => undefined);
}