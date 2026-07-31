const GA_ID = String(import.meta.env.VITE_GA_MEASUREMENT_ID || "G-W5EY5J3B1W").trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

let loaded = false;

function ensureGtag(): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  }
}

/** Load gtag.js only after the user accepts analytics cookies. */
export function loadGoogleAnalytics(): void {
  if (typeof window === "undefined" || !GA_ID) return;

  ensureGtag();
  window[`ga-disable-${GA_ID}`] = false;

  if (loaded || document.getElementById("ga-gtag")) {
    loaded = true;
    window.gtag?.("consent", "update", { analytics_storage: "granted" });
    window.gtag?.("config", GA_ID);
    return;
  }

  window.gtag("js", new Date());
  window.gtag("consent", "default", { analytics_storage: "granted" });
  window.gtag("config", GA_ID);

  const script = document.createElement("script");
  script.id = "ga-gtag";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
  loaded = true;
}

/** Stop analytics collection after the user turns consent off in settings. */
export function disableGoogleAnalytics(): void {
  if (typeof window === "undefined" || !GA_ID) return;
  window[`ga-disable-${GA_ID}`] = true;
  ensureGtag();
  window.gtag?.("consent", "update", { analytics_storage: "denied" });
}

export function getGaMeasurementId(): string {
  return GA_ID;
}
