import { useEffect, useState } from "react";
import { getAuthToken, getAuthUser, onAuthChange, type AuthUser } from "@/lib/api";

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
}

function readState(): AuthState {
  const token = getAuthToken();
  const user = getAuthUser();
  return { token, user, isAuthenticated: !!token };
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() => readState());

  useEffect(() => {
    const update = () => setState(readState());
    update();
    return onAuthChange(update);
  }, []);

  return state;
}
