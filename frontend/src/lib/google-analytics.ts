const GA_ID = String(import.meta.env.VITE_GA_MEASUREMENT_ID || "G-W5EY5J3B1W").trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let loaded = false;

/** Load gtag.js only after the user accepts analytics cookies. */
export function loadGoogleAnalytics(): void {
  if (typeof window === "undefined" || !GA_ID || loaded) return;
  if (document.getElementById("ga-gtag")) {
    loaded = true;
    return;
  }

  window.dataLayer = window.dataLayer || [];
  // gtag expects Arguments object pushed to dataLayer (official snippet style)
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);

  const script = document.createElement("script");
  script.id = "ga-gtag";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(script);
  loaded = true;
}

export function getGaMeasurementId(): string {
  return GA_ID;
}
