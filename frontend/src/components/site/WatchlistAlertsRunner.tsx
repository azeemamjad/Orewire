import { useWatchlistAlerts } from "@/hooks/use-watchlist-alerts";

/** Polls Set-alert items into the bell menu (not the whole watchlist). */
const WatchlistAlertsRunner = () => {
  useWatchlistAlerts();
  return null;
};

export default WatchlistAlertsRunner;
