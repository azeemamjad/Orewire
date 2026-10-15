/**
 * SignupModal context — anonymous "Sign up free" entry point, plus the
 * "queue while signed out, replay after sign-in" flow.
 *
 * Ported from the Lovable export (src/hooks/useSignupModal.tsx), with the
 * Supabase-backed internals removed. What is kept is the part that matters for
 * the anonymous design: the `context` (headline swap) and `ticker` the modal
 * receives, and the `openSignup()` call sites used by the nav, by
 * AddToWatchButton and by the watchlist stars.
 *
 * The export's two sign-in hand-offs are now wired (this was the file's
 * TODO(wire)):
 *
 *   1. Pending action. `openSignup({ context: "watchlist", ticker })` from a
 *      signed-out visitor stores `{ label, itemKey, ticker, exchange }` under
 *      the export's `orewire:pending-action` key; once `useAuth()` reports a
 *      session the company is POSTed to /api/watchlist through
 *      `addToWatchlist()` and the toast names the company. Only the "watchlist"
 *      context queues — the export also queued an "alert" action, which has no
 *      equivalent single call here, so that one still just carries the visitor
 *      to the signup modal.
 *   2. Guest watchlist merge. A signed-out visitor can keep up to
 *      GUEST_WATCHLIST_LIMIT (10) companies locally
 *      (src/features/watchlist/guest-watchlist.ts). On sign-in those are merged
 *      into the account watchlist, stopping at WATCHLIST_LIMIT (20); whatever
 *      does not fit is reported rather than silently dropped.
 *
 * Both hand-offs run once per sign-in. The export navigated to /watchlist when
 * it replayed a pending action; this app navigates on its own `?redirect=`
 * after login, so the replay toasts with a "View" action instead of stealing
 * that navigation.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SignupModal from "@/components/site/SignupModal";
import { useAuth } from "@/features/auth/hooks";
import { addToWatchlist, fetchWatchlist, watchlistFullMessage, WATCHLIST_LIMIT, type WatchlistItem } from "@/lib/api";
import {
  clearGuestWatchlist,
  companyFingerprint,
  isReplayableTickerLabel,
  parseTickerLabel,
  planWatchlistMerge,
  readGuestWatchlist,
  tickerLabelToItemKey,
  writeGuestWatchlist,
} from "@/features/watchlist/guest-watchlist";

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

/** A company a signed-out visitor asked for, waiting for a session. */
interface PendingAction {
  type: "watchlist";
  /** Label as the modal headline shows it, e.g. "TSX-V: SCZ". */
  label: string;
  /** `item_key` for POST /api/watchlist, e.g. "TSXVSCZ". */
  itemKey: string;
  ticker: string;
  exchange: string;
}

const PENDING_KEY = "orewire:pending-action";

function readPendingAction(): PendingAction | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAction> | null;
    if (!parsed || parsed.type !== "watchlist" || typeof parsed.itemKey !== "string" || !parsed.itemKey) return null;
    return {
      type: "watchlist",
      label: typeof parsed.label === "string" ? parsed.label : parsed.itemKey,
      itemKey: parsed.itemKey,
      ticker: typeof parsed.ticker === "string" ? parsed.ticker : "",
      exchange: typeof parsed.exchange === "string" ? parsed.exchange : "",
    };
  } catch {
    return null;
  }
}

function writePendingAction(action: PendingAction | null): void {
  try {
    if (action) localStorage.setItem(PENDING_KEY, JSON.stringify(action));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

const Ctx = createContext<SignupModalApi>({ openSignup: () => {} });

export const SignupModalProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<SignupModalState>({ open: false, context: "default" });
  const { isAuthenticated, loading } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  /* Reset on sign-out so a later sign-in replays again. */
  const replayedForSession = useRef(false);

  const openSignup = useCallback((options: OpenSignupOptions = {}) => {
    if (options.context === "watchlist" && options.ticker && isReplayableTickerLabel(options.ticker)) {
      const { exchange, ticker } = parseTickerLabel(options.ticker);
      writePendingAction({
        type: "watchlist",
        label: options.ticker,
        itemKey: tickerLabelToItemKey(options.ticker),
        ticker,
        exchange,
      });
    }
    setState({ open: true, context: options.context ?? "default", ticker: options.ticker });
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      replayedForSession.current = false;
      return;
    }
    if (replayedForSession.current) return;
    replayedForSession.current = true;

    let cancelled = false;

    (async () => {
      const guest = readGuestWatchlist();
      const pending = readPendingAction();
      if (!guest.length && !pending) return;

      let server: WatchlistItem[] = [];
      try {
        server = await fetchWatchlist();
      } catch {
        /* offline: leave both queues untouched so the next sign-in retries */
        return;
      }
      if (cancelled) return;

      const companies = server.filter((it) => it.itemType === "company");
      const haveKeys = new Set(companies.map((it) => it.itemKey));
      const haveCompanies = new Set(companies.map((it) => companyFingerprint(it.ticker, it.exchange)));

      /* Merge the guest list, stopping at the cap. */
      const { toAdd, skipped } = planWatchlistMerge(companies, guest, WATCHLIST_LIMIT);
      const skippedCount = skipped.length;

      const failed: WatchlistItem[] = [];
      let added = 0;
      for (const item of toAdd) {
        try {
          await addToWatchlist("company", item.itemKey, item.companyId ?? undefined);
          haveKeys.add(item.itemKey);
          haveCompanies.add(companyFingerprint(item.ticker, item.exchange));
          added += 1;
        } catch {
          failed.push(item);
        }
        if (cancelled) return;
      }

      /* Keep anything that failed (network, 5xx) so it can be retried; the
         entries that did not fit are reported below instead of being kept. */
      if (failed.length) writeGuestWatchlist(failed);
      else clearGuestWatchlist();

      if (added > 0) toast.success("Your saved companies were added to your account watchlist.");
      if (skippedCount > 0) {
        toast.message(
          `${skippedCount} saved ${skippedCount === 1 ? "company was" : "companies were"} skipped — ${watchlistFullMessage(WATCHLIST_LIMIT)}`,
        );
      }

      /* Replay the queued signed-out add. */
      if (pending) {
        const alreadyOnList =
          haveKeys.has(pending.itemKey) ||
          (!!pending.ticker && haveCompanies.has(companyFingerprint(pending.ticker, pending.exchange)));

        if (alreadyOnList) {
          writePendingAction(null);
          toast.success(`${pending.label} is already on your watchlist.`);
        } else if (companies.length + added >= WATCHLIST_LIMIT) {
          writePendingAction(null);
          toast.error(watchlistFullMessage(WATCHLIST_LIMIT));
        } else {
          try {
            await addToWatchlist("company", pending.itemKey);
            writePendingAction(null);
            setState((s) => (s.open ? { ...s, open: false } : s));
            toast.success(`${pending.label} added to your watchlist`, {
              action: { label: "View", onClick: () => navigate("/watchlist") },
            });
          } catch {
            /* keep the pending action for a later attempt */
          }
        }
      }

      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, loading, navigate, queryClient]);

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
