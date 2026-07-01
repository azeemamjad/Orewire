import { API_BASE } from '@/lib/api-client';

export async function subscribeMorningBriefing(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/briefing/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || 'Subscribe failed');
}
