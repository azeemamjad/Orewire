import { API_BASE, authFetch } from '@/lib/api-client';

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
