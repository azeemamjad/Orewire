import { disableGoogleAnalytics, loadGoogleAnalytics } from "@/lib/google-analytics";

const STORAGE_KEY = "orewire.cookie_consent";
const CONSENT_EVENT = "orewire-cookie-consent";

export type CookieConsentChoice = "accepted" | "necessary";

export function isCookieConsentChoice(value: unknown): value is CookieConsentChoice {
  return value === "accepted" || value === "necessary";
}

export function getCookieConsent(): CookieConsentChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isCookieConsentChoice(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist locally and apply analytics if accepted. Does not hit the API. */
export function setCookieConsent(choice: CookieConsentChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* ignore */
  }
  applyCookieConsent(choice);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
  }
}

export function applyCookieConsent(choice: CookieConsentChoice | null): void {
  if (choice === "accepted") loadGoogleAnalytics();
  else disableGoogleAnalytics();
}

export function analyticsAllowed(): boolean {
  return getCookieConsent() === "accepted";
}

export function onCookieConsentChange(handler: (choice: CookieConsentChoice) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (isCookieConsentChoice(detail)) handler(detail);
  };
  window.addEventListener(CONSENT_EVENT, listener);
  return () => window.removeEventListener(CONSENT_EVENT, listener);
}

// If they already accepted on a previous visit, start GA immediately.
if (typeof window !== "undefined" && getCookieConsent() === "accepted") {
  applyCookieConsent("accepted");
}
