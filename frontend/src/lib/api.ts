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
}): Promise<Filing[]> {
  const params = new URLSearchParams();
  if (filters?.verdict && filters.verdict !== 'All') {
    params.set('verdict', filters.verdict.toLowerCase());
  }
  if (filters?.exchange && filters.exchange !== 'All') {
    params.set('exchange', filters.exchange);
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
}): Promise<PaginatedCompanies> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.exchange && params.exchange !== 'All') qs.set('exchange', params.exchange);

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