/**
 * SignupModal context — anonymous "Sign up free" entry point.
 *
 * Ported from the Lovable export (src/hooks/useSignupModal.tsx), with the
 * Supabase-backed internals removed. What is kept is the part that matters for
 * the anonymous design: the `context` (headline swap) and `ticker` the modal
 * receives, plus the `openSignup()` call sites used by the nav and by
 * AddToWatchButton.
 *
 * What was NOT ported from the export, deliberately:
 *   - `savePending()` / the guest watchlist replay. That entire flow was
 *     Supabase table writes and would need an authenticated POST to
 *     /api/watchlist after the visitor signs in. Wiring it is a product
 *     decision, not a design port, so it is left out rather than half-built.
 *   - WATCHLIST_LIMIT / GUEST_WATCHLIST_LIMIT, which only existed to cap those
 *     Supabase writes. The server enforces its own limits.
 *
 * TODO(wire): the export's flow let a signed-out visitor queue a company and
 * have it added automatically once they signed in. That is now lost: the modal
 * only carries the visitor to /register. To restore it, persist
 * OpenSignupOptions.ticker on openSignup() and replay it as
 * addToWatchlist("company", itemKey) from @/lib/api once useAuth() reports
 * isAuthenticated.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import SignupModal from "@/components/site/SignupModal";

export type SignupContext =
  | "watchlist"
  | "alert"
  | "feed"
  | "filters"
  | "insiders"
  | "history"
  | "default";

export interface OpenSignupOptions {
  context?: SignupContext;
  /** Ticker label shown in the headline, e.g. "TSX-V: SCZ". */
  ticker?: string;
}

interface SignupModalState {
  open: boolean;
  context: SignupContext;
  ticker?: string;
}

interface SignupModalApi {
  openSignup: (options?: OpenSignupOptions) => void;
}

const Ctx = createContext<SignupModalApi>({ openSignup: () => {} });

export const SignupModalProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<SignupModalState>({ open: false, context: "default" });

  const openSignup = useCallback((options: OpenSignupOptions = {}) => {
    setState({ open: true, context: options.context ?? "default", ticker: options.ticker });
  }, []);

  const api = useMemo(() => ({ openSignup }), [openSignup]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <SignupModal
        open={state.open}
        onOpenChange={(open) => setState((s) => ({ ...s, open }))}
        context={state.context}
        ticker={state.ticker}
      />
    </Ctx.Provider>
  );
};

/* The provider and its consumer hook share one context object on purpose: the
   modal's controller and its call sites are a single unit, and splitting them
   across files would only add indirection. */
// eslint-disable-next-line react-refresh/only-export-components
export const useSignupModal = () => useContext(Ctx);
