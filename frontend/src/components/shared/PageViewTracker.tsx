import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE, authFetch } from "@/lib/api-client";

const HEARTBEAT_MS = 60_000;

/**
 * Reports the signed-in user's activity to the backend:
 *  - one ping per route change (with the page path → page-visit history)
 *  - a heartbeat while the tab is open (→ "last live" presence)
 * Anonymous visitors are ignored server-side; failures are silent.
 */
export default function PageViewTracker() {
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  const ping = (path?: string) => {
    authFetch(`${API_BASE}/auth/track-live`, {
      method: "POST",
      body: JSON.stringify(path ? { path } : {}),
    }).catch(() => {
      /* tracking must never surface errors in the UI */
    });
  };

  // Page visits
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    ping(location.pathname);
  }, [location.pathname]);

  // Presence heartbeat
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") ping();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
