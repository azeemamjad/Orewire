import { API_BASE, authFetch } from '@/lib/api-client';

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
  company?: string | null;
  twoStepEnabled?: boolean;
  emailVerified?: boolean;
  createdAt?: string;
  mustChangePassword?: boolean;
  briefingEnabled?: boolean;
  watchlistAlertsEnabled?: boolean;
}

export interface AuthResponse {
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
  token?: string;
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

export function getRefreshToken(): string | null {
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

export async function register(
  firstNameOrEmail: string,
  lastNameOrPassword: string,
  username?: string,
  email?: string,
  password?: string,
  company?: string,
): Promise<AuthResponse> {
  const isLegacy = firstNameOrEmail.includes('@') && !username;
  const body = isLegacy
    ? {
        firstName: 'User',
        lastName: 'Member',
        username:
          firstNameOrEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'user',
        email: firstNameOrEmail,
        password: lastNameOrPassword,
      }
    : {
        firstName: firstNameOrEmail,
        lastName: lastNameOrPassword,
        username: username!,
        email: email!,
        password: password!,
        company: company?.trim() || undefined,
      };
  const resp = await authRequest('/register', body);
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
  const current = getAuthUser();
  if (data?.user && current) setAuth({ user: { ...current, ...data.user } });
  return data as ProfileResponse;
}

export async function updateProfile(input: {
  firstName: string;
  lastName: string;
  username: string;
  company?: string;
}): Promise<ProfileResponse> {
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

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/auth/change-password`, {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to change password: ${res.status}`);
  const current = getAuthUser();
  if (current) setAuth({ user: { ...current, mustChangePassword: false } });
}

export async function updateNotifications(input: {
  briefingEnabled?: boolean;
  watchlistAlertsEnabled?: boolean;
}): Promise<{ briefingEnabled: boolean; watchlistAlertsEnabled: boolean }> {
  const res = await authFetch(`${API_BASE}/auth/profile/notifications`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to update notifications: ${res.status}`);
  const current = getAuthUser();
  if (current) setAuth({ user: { ...current, briefingEnabled: data.briefingEnabled, watchlistAlertsEnabled: data.watchlistAlertsEnabled } });
  return data;
}
