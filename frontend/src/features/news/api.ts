import { API_BASE } from '@/lib/api-client';

export type Verdict = 'Noteworthy' | 'Watch' | 'Routine' | 'Extraction failed' | 'Company mismatch';
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

export interface PaginatedFilings {
  items: Filing[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export async function fetchFilingsPage(params: {
  page: number;
  limit?: number;
  verdict?: string;
  companyId?: number;
  exchange?: string;
  search?: string;
  commodity?: string;
}): Promise<PaginatedFilings> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.verdict && params.verdict !== 'All') {
    qs.set('verdict', params.verdict.toLowerCase());
  }
  if (params.companyId) qs.set('company_id', String(params.companyId));
  if (params.exchange && params.exchange !== 'All') qs.set('exchange', params.exchange);
  if (params.search) qs.set('search', params.search);
  if (params.commodity && params.commodity !== 'All') qs.set('commodity', params.commodity);

  const res = await fetch(`${API_BASE}/filings?${qs.toString()}`);
  if (!res.ok) {
    return {
      items: [],
      pagination: { page: params.page, limit: params.limit || 10, total: 0, totalPages: 1, hasNext: false, hasPrev: false },
    };
  }
  const data: { items: RawFiling[]; pagination: PaginatedFilings['pagination'] } = await res.json();
  return {
    items: (data.items || []).map(mapFiling),
    pagination: data.pagination || { page: params.page, limit: params.limit || 10, total: data.items?.length || 0, totalPages: 1, hasNext: false, hasPrev: false },
  };
}

export async function fetchStats(): Promise<FilingStats> {
  const res = await fetch(`${API_BASE}/filings/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

export interface FilingDetail {
  id: number;
  ticker: string;
  company: string;
  exchange: string;
  filingType: string;
  verdict: Verdict | null;
  commodity: Commodity | null;
  time: string;
  pdfFilename: string | null;
  sourceUrl: string | null;
  summary: string;
  verdictReason: string | null;
  keyFacts: string | null;
  context: string | null;
  gradeCommentary: string | null;
  whatToWatch: string | null;
  resourceEstimate: string | null;
}

interface RawFilingDetail {
  id: number;
  company_name: string;
  exchange: string | null;
  filing_type: string | null;
  pdf_filename: string | null;
  source_url: string | null;
  commodity: string | null;
  created_at: string;
  analysis: {
    ticker_summary: string | null;
    summary: string | null;
    verdict: string | null;
    verdict_reason: string | null;
    key_facts: string | null;
    context: string | null;
    grade_commentary: string | null;
    what_to_watch: string | null;
    resource_estimate: string | null;
  } | null;
}

export function filingDocumentUrl(id: string | number): string {
  return `${API_BASE}/filings/${id}/document`;
}

export async function fetchFiling(id: string | number): Promise<FilingDetail | null> {
  const res = await fetch(`${API_BASE}/filings/${id}`);
  if (!res.ok) return null;
  const raw: RawFilingDetail = await res.json();
  const a = raw.analysis;
  const tickerMatch = a?.ticker_summary?.match(/^([A-Z]+)/);
  const verdict = a?.verdict ? (a.verdict.charAt(0).toUpperCase() + a.verdict.slice(1)) as Verdict : null;
  return {
    id: raw.id,
    ticker: tickerMatch?.[1] || raw.company_name.substring(0, 3).toUpperCase(),
    company: raw.company_name,
    exchange: normalizeExchange(raw.exchange),
    filingType: raw.filing_type || 'Filing',
    verdict,
    commodity: raw.commodity ? (raw.commodity as Commodity) : inferCommodity(a?.summary || ''),
    time: getTimeAgo(raw.created_at),
    pdfFilename: raw.pdf_filename,
    sourceUrl: raw.source_url || null,
    summary: a?.summary || a?.verdict_reason || 'Analysis pending...',
    verdictReason: a?.verdict_reason || null,
    keyFacts: a?.key_facts || null,
    context: a?.context || null,
    gradeCommentary: a?.grade_commentary || null,
    whatToWatch: a?.what_to_watch || null,
    resourceEstimate: a?.resource_estimate || null,
  };
}

export interface NewsItem {
  id?: number;
  title: string;
  summary: string;
  description?: string | null;
  source: string;
  link: string;
  pubDate: string;
  timeAgo: string;
  commodity: string | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  ticker?: string | null;
  companyId?: number | null;
  company?: string | null;
  exchange?: string | null;
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

export async function fetchNewsFeed(params?: {
  page?: number;
  limit?: number;
  origin?: 'google' | 'rss';
  companyLinked?: boolean;
  companyId?: number;
  exchange?: string;
  search?: string;
  commodity?: string;
  sentiment?: string;
  severity?: string;
}): Promise<NewsFeedResponse> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.origin) qs.set("origin", params.origin);
  if (params?.companyLinked) qs.set("companyLinked", "1");
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.exchange && params.exchange !== "All") qs.set("exchange", params.exchange);
  if (params?.search) qs.set("search", params.search);
  if (params?.commodity && params.commodity !== "All") qs.set("commodity", params.commodity);
  if (params?.sentiment && params.sentiment !== "All") qs.set("sentiment", params.sentiment);
  if (params?.severity && params.severity !== "All") qs.set("severity", params.severity);
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

export async function fetchNewsItem(slug: string): Promise<NewsItem | null> {
  if (!slug) return null;
  const params = new URLSearchParams();
  params.set('link', slug);
  const res = await fetch(`${API_BASE}/news/item?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.item ?? null;
}

export interface CompanyNewsResponse {
  items: NewsItem[];
  hasMore: boolean;
  nextOffset: number | null;
}

export async function fetchCompanyNews(
  name: string,
  opts: {
    companyId?: number;
    ticker?: string;
    exchange?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<CompanyNewsResponse> {
  const params = new URLSearchParams();
  if (opts.companyId) params.set("companyId", String(opts.companyId));
  if (opts.ticker) params.set("ticker", opts.ticker);
  if (opts.exchange) params.set("exchange", opts.exchange);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const res = await fetch(`${API_BASE}/news/company/${encodeURIComponent(name)}?${params.toString()}`);
  if (!res.ok) return { items: [], hasMore: false, nextOffset: null };
  const data = await res.json();
  return { items: data.items || [], hasMore: !!data.hasMore, nextOffset: data.nextOffset ?? null };
}
