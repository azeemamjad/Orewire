import { fetchWatchlistAlerts, type WatchlistAlert } from "@/lib/api";
import { addNotification } from "@/lib/notifications";

const WATERMARK_KEY = "orewire-item-alerts-watermark";
const SEEN_KEY = "orewire-item-alerts-seen";
const MAX_SEEN = 500;
const POLL_MS = 3 * 60 * 1000;

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  const arr = [...seen].slice(-MAX_SEEN);
  localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
}

function getWatermark(): string | null {
  try {
    return localStorage.getItem(WATERMARK_KEY);
  } catch {
    return null;
  }
}

function setWatermark(iso: string) {
  localStorage.setItem(WATERMARK_KEY, iso);
}

/** Call when user enables Set alert so past items are not flooded in. */
export function bumpItemAlertWatermark() {
  setWatermark(new Date().toISOString());
}

function fmtTicker(ticker: string | null | undefined, exchange: string | null | undefined): string {
  const tk = ticker || "-";
  const ex = exchange ? exchange.toUpperCase() : "";
  return ex ? `${ex}:${tk}` : tk;
}

function alertToNotification(alert: WatchlistAlert): { id: string; title: string; body: string; href: string; createdAt: string } {
  if (alert.type === "market") {
    const label = alert.label || alert.itemKey || "Market";
    const pct = alert.changePct ?? 0;
    const sign = pct >= 0 ? "+" : "";
    return {
      id: alert.id,
      title: `Major move · ${label}`,
      body: `${sign}${pct.toFixed(2)}% today`,
      href: alert.href,
      createdAt: alert.at,
    };
  }

  const label = fmtTicker(alert.ticker, alert.exchange);
  const name = alert.companyName || label;

  if (alert.type === "news") {
    return {
      id: alert.id,
      title: `News · ${label}`,
      body: alert.title || `New headline for ${name}`,
      href: alert.href,
      createdAt: alert.at,
    };
  }

  if (alert.type === "filing") {
    const type = alert.filingType || "Filing";
    const verdict = alert.verdict ? ` · ${alert.verdict}` : "";
    return {
      id: alert.id,
      title: `New filing · ${label}`,
      body: `${type}${verdict}`,
      href: alert.href,
      createdAt: alert.at,
    };
  }

  const who = alert.insiderName || "Insider";
  const tx = (alert.transactionType || "transaction").replace(/_/g, " ");
  const shares =
    alert.shares != null ? ` · ${Number(alert.shares).toLocaleString()} shares` : "";
  return {
    id: alert.id,
    title: `Insider trade · ${label}`,
    body: `${who} - ${tx}${shares}`,
    href: alert.href,
    createdAt: alert.at,
  };
}

let polling = false;

export async function pollItemAlerts(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    let since = getWatermark();
    if (!since) {
      setWatermark(new Date().toISOString());
      return;
    }

    const { alerts, serverTime } = await fetchWatchlistAlerts(since);
    if (!alerts.length) {
      setWatermark(serverTime);
      return;
    }

    const seen = loadSeen();

    for (const alert of alerts) {
      if (seen.has(alert.id)) continue;
      seen.add(alert.id);
      addNotification(alertToNotification(alert));
    }

    saveSeen(seen);
    setWatermark(serverTime);
  } catch {
    /* network / auth - retry on next interval */
  } finally {
    polling = false;
  }
}

export function resetItemAlertCursor() {
  localStorage.removeItem(WATERMARK_KEY);
  localStorage.removeItem(SEEN_KEY);
}

export function startItemAlertsPolling(): () => void {
  const run = () => {
    void pollItemAlerts();
  };
  run();
  const id = window.setInterval(run, POLL_MS);
  return () => window.clearInterval(id);
}

/** @deprecated use pollItemAlerts */
export const pollWatchlistAlerts = pollItemAlerts;
/** @deprecated use resetItemAlertCursor */
export const resetWatchlistAlertCursor = resetItemAlertCursor;
/** @deprecated use startItemAlertsPolling */
export const startWatchlistAlertsPolling = startItemAlertsPolling;
