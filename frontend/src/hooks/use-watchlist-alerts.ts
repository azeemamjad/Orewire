import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getAuthToken, onAuthChange } from "@/lib/api";
import { pollItemAlerts, resetItemAlertCursor, startItemAlertsPolling } from "@/lib/watchlist-alerts";

/**
 * Polls the API for in-app alerts on items where the user pressed Set alert.
 */
export function useWatchlistAlerts() {
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) return;
    return startItemAlertsPolling();
  }, [isAuthenticated, loading]);

  useEffect(() => {
    const unsub = onAuthChange(() => {
      if (getAuthToken()) {
        void pollItemAlerts();
      } else {
        resetItemAlertCursor();
      }
    });
    return unsub;
  }, []);
}
