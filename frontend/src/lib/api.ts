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

export async function fetchCompany(idOrSlug: number | string): Promise<CompanyDetail> {
  const res = await fetch(`${API_BASE}/companies/${idOrSlug}`);
  if (!res.ok) throw new Error(`Failed to fetch company: ${res.status}`);
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
  exchange: string;
  ticker: string;
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
    return { kind, key, exchange: opts?.exchange || "", ticker: key, intervalMs: 30 * 60 * 1000, windowMs: 24 * 60 * 60 * 1000, points: [] };
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Watchlist (DB-backed)
// ---------------------------------------------------------------------------

export interface WatchlistItem {
  id: number;
  itemType: string;
  itemKey: string;
  companyId: number | null;
  companyName: string | null;
  ticker: string | null;
  exchange: string | null;
  marketCap: number | null;
  createdAt: string;
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const res = await authFetch(`${API_BASE}/watchlist`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
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

// ---------------------------------------------------------------------------
// Auth (JWT: access + refresh)
// ---------------------------------------------------------------------------

const ACCESS_KEY  = 'orewire.auth.access';
const REFRESH_KEY = 'orewire.auth.refresh';
const USER_KEY    = 'orewire.auth.user';
const ACCESS_EXP  = 'orewire.auth.access_exp';

export interface AuthUser {
  id: number;
  email: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  twoStepEnabled?: boolean;
  emailVerified?: boolean;
  createdAt?: string;
}

export interface AuthResponse {
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
  token?: string; // backwards-compat alias for accessToken
  user?: AuthUser;
  requiresVerification?: boolean;
  requiresTwoStep?: boolean;
  email?: string;
  ok?: boolean;
  retryAfterMs?: number;
}

export interface ProfileResponse {
  user: AuthUser;
}

export function getAuthToken(): string | null {
  try { return localStorage.getItem(ACCESS_KEY); } catch { return null; }
}

function getRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}

function getAccessExp(): number {
  try { return parseInt(localStorage.getItem(ACCESS_EXP) || '0', 10); } catch { return 0; }
}

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const AUTH_EVENT = 'orewire-auth-change';

function emitAuthChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EVENT));
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
    const access = resp.accessToken || resp.token;
    if (access) localStorage.setItem(ACCESS_KEY, access);
    if (resp.refreshToken) localStorage.setItem(REFRESH_KEY, resp.refreshToken);
    if (resp.accessExpiresAt) localStorage.setItem(ACCESS_EXP, String(resp.accessExpiresAt));
    if (resp.user) localStorage.setItem(USER_KEY, JSON.stringify(resp.user));
  } catch { /* ignore */ }
  emitAuthChange();
}

export function clearAuth() {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(ACCESS_EXP);
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
  emitAuthChange();
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;

  const refresh = getRefreshToken();
  if (!refresh) return null;

  refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) { clearAuth(); return null; }
      const data: AuthResponse = await res.json();
      const access = data.accessToken || data.token;
      if (!access) { clearAuth(); return null; }
      try {
        localStorage.setItem(ACCESS_KEY, access);
        if (data.accessExpiresAt) localStorage.setItem(ACCESS_EXP, String(data.accessExpiresAt));
        if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      } catch { /* ignore */ }
      emitAuthChange();
      return access;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** Returns a valid access token, refreshing if needed. */
async function getValidAccessToken(): Promise<string | null> {
  const token = getAuthToken();
  const exp = getAccessExp();
  if (token && exp && Date.now() < exp - 30_000) return token;
  return refreshAccessToken();
}

async function authRequest(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data as AuthResponse;
}

export async function verifyAuth(): Promise<{ authenticated: boolean; user: AuthUser | null }> {
  const token = await getValidAccessToken();
  if (!token) return { authenticated: false, user: null };
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { clearAuth(); return { authenticated: false, user: null }; }
    const data = await res.json();
    if (data.authenticated && data.user) {
      try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch {}
    }
    return data;
  } catch {
    return { authenticated: false, user: null };
  }
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const resp = await authRequest('/login', { email, password });
  setAuth(resp);
  return resp;
}

export async function register(a: string, b: string, c?: string, d?: string, e?: string): Promise<AuthResponse> {
  // Backwards compatible:
  // register(email, password)
  // register(firstName, lastName, email, password)
  // register(firstName, lastName, username, email, password)
  const isFiveArg = !!(c && d && e);
  const isFourArg = !!(c && d && !e);
  const firstName = isFiveArg || isFourArg ? a : "User";
  const lastName = isFiveArg || isFourArg ? b : "Member";
  const username = isFiveArg ? c : (isFourArg ? `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || "user" : "user");
  const email = isFiveArg ? d! : (isFourArg ? c! : a);
  const password = isFiveArg ? e! : (isFourArg ? d! : b);
  const resp = await authRequest('/register', { firstName, lastName, username, email, password });
  if (resp.accessToken || resp.token) setAuth(resp);
  return resp;
}

export async function verifyRegistrationOtp(email: string, otp: string): Promise<AuthResponse> {
  const resp = await authRequest('/verify-otp', { email, otp });
  setAuth(resp);
  return resp;
}

export async function resendOtp(email: string, purpose: "register" | "reset_password" | "login_2fa" = "register"): Promise<AuthResponse> {
  return authRequest('/resend-otp', { email, purpose });
}

export async function verifyLoginOtp(email: string, otp: string): Promise<AuthResponse> {
  const resp = await authRequest('/verify-login-otp', { email, otp });
  setAuth(resp);
  return resp;
}

export async function forgotPassword(email: string): Promise<AuthResponse> {
  return authRequest('/forgot-password', { email });
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<AuthResponse> {
  return authRequest('/reset-password', { email, otp, newPassword });
}

export async function logout(): Promise<void> {
  const refresh = getRefreshToken();
  clearAuth();
  if (!refresh) return;
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  }).catch(() => undefined);
}

export async function fetchProfile(): Promise<ProfileResponse> {
  const res = await authFetch(`${API_BASE}/auth/profile`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to fetch profile: ${res.status}`);
  return data as ProfileResponse;
}

export async function updateProfile(input: { firstName: string; lastName: string; username: string }): Promise<ProfileResponse> {
  const res = await authFetch(`${API_BASE}/auth/profile`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to update profile: ${res.status}`);
  const current = getAuthUser();
  if (data?.user) setAuth({ user: { ...current, ...data.user } });
  return data as ProfileResponse;
}

export async function updateTwoStep(enabled: boolean): Promise<ProfileResponse> {
  const res = await authFetch(`${API_BASE}/auth/profile/two-step`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to update 2-step: ${res.status}`);
  const current = getAuthUser();
  if (data?.user) setAuth({ user: { ...current, ...data.user } });
  return data as ProfileResponse;
}

// ---------------------------------------------------------------------------
// Discussions
// ---------------------------------------------------------------------------

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

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    h['Authorization'] = `Bearer ${token}`;
    h['x-auth-token']  = token; // backwards-compat for any code still using it
  }
  return h;
}

/**
 * fetch wrapper that auto-refreshes the access token on 401 and retries once.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token = await getValidAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-auth-token']  = token;
  }
  let res = await fetch(input, { ...init, headers });
  if (res.status === 401 && getRefreshToken()) {
    token = await refreshAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-auth-token']  = token;
      res = await fetch(input, { ...init, headers });
    }
  }
  if (res.status === 401) clearAuth();
  return res;
}

export async function fetchDiscussions(companyId: number): Promise<Discussion[]> {
  const res = await authFetch(`${API_BASE}/discussions/${companyId}`);
  if (!res.ok) throw new Error(`Failed to fetch discussions: ${res.status}`);
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

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  link: string;
  pubDate: string;
  timeAgo: string;
  commodity: string | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  ticker?: string | null;
}

export interface NewsFeedResponse {
  items: NewsItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export async function fetchNewsFeed(params?: { page?: number; limit?: number }): Promise<NewsFeedResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  const res = await fetch(`${API_BASE}/news/feed${query ? `?${query}` : ""}`);
  if (!res.ok) {
    return {
      items: [],
      pagination: { page: params?.page || 1, limit: params?.limit || 12, total: 0, totalPages: 1, hasNext: false, hasPrev: false },
    };
  }
  const data = await res.json();
  return {
    items: data.items || [],
    pagination: data.pagination || {
      page: params?.page || 1,
      limit: params?.limit || 12,
      total: data.items?.length || 0,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  };
}

export async function fetchCompanyNews(name: string, ticker?: string, exchange?: string): Promise<NewsItem[]> {
  const params = new URLSearchParams();
  if (ticker) params.set('ticker', ticker);
  if (exchange) params.set('exchange', exchange);
  const res = await fetch(`${API_BASE}/news/company/${encodeURIComponent(name)}?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
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

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface JobListing {
  id: number;
  companyName: string;
  ticker: string | null;
  title: string;
  location: string;
  contactEmail: string;
  description: string;
  salary: string | null;
  discipline: string | null;
  jobType: string;
  tags: string[];
  promoted: boolean;
  status: string;
  timeAgo: string;
  createdAt: string;
}

export async function fetchJobs(filters?: { search?: string; discipline?: string; type?: string }): Promise<JobListing[]> {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.discipline && filters.discipline !== 'All') params.set('discipline', filters.discipline);
  if (filters?.type && filters.type !== 'All') params.set('type', filters.type);
  const res = await fetch(`${API_BASE}/jobs?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.jobs || [];
}

export async function postJob(job: {
  companyName: string;
  ticker?: string;
  title: string;
  location: string;
  contactEmail: string;
  description?: string;
}): Promise<JobListing> {
  const res = await authFetch(`${API_BASE}/jobs`, {
    method: 'POST',
    body: JSON.stringify(job),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to post job: ${res.status}`);
  return data as JobListing;
}

// ---------------------------------------------------------------------------
// Job Applications
// ---------------------------------------------------------------------------

export interface JobApplication {
  id: number;
  jobId: number;
  userId: number | null;
  name: string;
  email: string;
  phone: string | null;
  resumeUrl: string | null;
  coverLetter: string | null;
  expectedSalary: string | null;
  website: string | null;
  status: string;
  timeAgo: string;
  createdAt: string;
}

export interface JobWithApplications {
  jobId: number;
  jobTitle: string;
  companyName: string;
  jobLocation: string;
  jobStatus: string;
  applications: JobApplication[];
}

export async function updateJobStatus(jobId: number, status: 'active' | 'private'): Promise<JobListing> {
  const res = await authFetch(`${API_BASE}/jobs/${jobId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed: ${res.status}`);
  return data as JobListing;
}

export async function deleteJob(jobId: number): Promise<void> {
  const res = await authFetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Failed: ${res.status}`);
  }
}

export async function applyToJob(jobId: number, data: {
  name: string;
  email?: string;
  phone?: string;
  resumeUrl?: string;
  coverLetter?: string;
  expectedSalary?: string;
  website?: string;
}): Promise<JobApplication> {
  const res = await authFetch(`${API_BASE}/applications/${jobId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result?.error || `Failed to apply: ${res.status}`);
  return result as JobApplication;
}

export async function fetchMyJobApplications(): Promise<JobWithApplications[]> {
  const res = await authFetch(`${API_BASE}/applications/my-jobs`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.jobs || [];
}

export interface MyApplication {
  applicationId: number;
  status: string;
  appliedAt: string;
  timeAgo: string;
  jobId: number;
  jobTitle: string;
  companyName: string;
  jobLocation: string;
  ticker: string | null;
  salary: string | null;
}

export async function fetchMyApplications(): Promise<MyApplication[]> {
  const res = await authFetch(`${API_BASE}/applications/my-applied`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.applications || [];
}

export async function updateApplicationStatus(appId: number, status: string): Promise<JobApplication> {
  const res = await authFetch(`${API_BASE}/applications/${appId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to update: ${res.status}`);
  return data as JobApplication;
}