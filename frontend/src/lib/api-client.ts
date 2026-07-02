function resolveApiBase(): string {
  const explicit = import.meta.env.VITE_API_URL;
  if (explicit && String(explicit).trim()) {
    return String(explicit).replace(/\/$/, '');
  }
  const backend = import.meta.env.VITE_BACKEND_DOMAIN;
  if (backend && String(backend).trim()) {
    const host = String(backend).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const isLocal = /localhost|127\.0\.0\.1|^\d+\.\d+\.\d+\.\d+/.test(host);
    return `${isLocal ? 'http' : 'https'}://${host}/api`;
  }
  return 'http://localhost:3000/api';
}

export const API_BASE = resolveApiBase();

const ACCESS_KEY = 'orewire.auth.access';
const REFRESH_KEY = 'orewire.auth.refresh';
const USER_KEY = 'orewire.auth.user';
const ACCESS_EXP = 'orewire.auth.access_exp';
const AUTH_EVENT = 'orewire-auth-change';

function getAuthTokenFromStorage(): string | null {
  try { return localStorage.getItem(ACCESS_KEY); } catch { return null; }
}

function getRefreshTokenFromStorage(): string | null {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}

function getAccessExpFromStorage(): number {
  try { return parseInt(localStorage.getItem(ACCESS_EXP) || '0', 10); } catch { return 0; }
}

function clearAuthStorage(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(ACCESS_EXP);
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EVENT));
}

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;

  const refresh = getRefreshTokenFromStorage();
  if (!refresh) return null;

  refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) { clearAuthStorage(); return null; }
      const data = await res.json();
      const access = data.accessToken || data.token;
      if (!access) { clearAuthStorage(); return null; }
      try {
        localStorage.setItem(ACCESS_KEY, access);
        if (data.accessExpiresAt) localStorage.setItem(ACCESS_EXP, String(data.accessExpiresAt));
        if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      } catch { /* ignore */ }
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EVENT));
      return access;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

async function getValidAccessToken(): Promise<string | null> {
  const token = getAuthTokenFromStorage();
  const exp = getAccessExpFromStorage();
  if (token && exp && Date.now() < exp - 30_000) return token;
  return refreshAccessToken();
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
    headers['x-auth-token'] = token;
  }
  let res = await fetch(input, { ...init, headers });
  if (res.status === 401 && getRefreshTokenFromStorage()) {
    token = await refreshAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-auth-token'] = token;
      res = await fetch(input, { ...init, headers });
    }
  }
  if (res.status === 401) clearAuthStorage();
  return res;
}
