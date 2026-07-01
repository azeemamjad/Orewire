import { useEffect, useState } from "react";
import { getAuthToken, getAuthUser, onAuthChange, verifyAuth, type AuthUser } from "@/lib/api";

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
}

function readState(): Omit<AuthState, "loading"> {
  const token = getAuthToken();
  const user = getAuthUser();
  return { token, user, isAuthenticated: !!token };
}

function hasAnyAuth(): boolean {
  try {
    return !!(localStorage.getItem("orewire.auth.access") || localStorage.getItem("orewire.auth.refresh"));
  } catch { return false; }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() => ({ ...readState(), loading: hasAnyAuth() }));

  useEffect(() => {
    const update = () => setState(prev => ({ ...readState(), loading: prev.loading }));
    const unsub = onAuthChange(update);

    if (hasAnyAuth()) {
      verifyAuth().then(result => {
        if (!result.authenticated) {
          setState({ token: null, user: null, isAuthenticated: false, loading: false });
        } else {
          setState({ ...readState(), loading: false });
        }
      });
    } else {
      setState(prev => ({ ...prev, loading: false }));
    }

    return unsub;
  }, []);

  return state;
}
