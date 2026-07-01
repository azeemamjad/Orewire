import { API_BASE } from '@/lib/api-client';

export async function submitContactMessage(payload: {
  name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
}): Promise<{ ok: boolean; id: number }> {
  const res = await fetch(`${API_BASE}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed to send message');
  return data as { ok: boolean; id: number };
}
