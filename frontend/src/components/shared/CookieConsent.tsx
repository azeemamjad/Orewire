import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/features/auth/hooks";
import { fetchProfile, updateCookieConsent } from "@/lib/api";
import {
  applyCookieConsent,
  getCookieConsent,
  isCookieConsentChoice,
  setCookieConsent,
  type CookieConsentChoice,
} from "@/lib/cookie-consent";

/**
 * Cookie banner for all visitors.
 * - Guest choice → localStorage
 * - Logged-in choice → localStorage + DB
 * - Accept while logged out, then login → synced to DB, banner not shown again
 */
const CookieConsent = () => {
  const { isAuthenticated, loading, user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function resolveConsent() {
      if (loading) {
        setReady(false);
        return;
      }

      const local = getCookieConsent();

      if (!isAuthenticated) {
        if (local) applyCookieConsent(local);
        if (active) {
          setVisible(local == null);
          setReady(true);
        }
        return;
      }

      // Prefer DB consent from /me when present; otherwise fetch profile.
      let dbConsent: CookieConsentChoice | null = isCookieConsentChoice(user?.cookieConsent)
        ? user.cookieConsent
        : null;

      if (!dbConsent) {
        try {
          const profile = await fetchProfile();
          if (isCookieConsentChoice(profile.user?.cookieConsent)) {
            dbConsent = profile.user.cookieConsent;
          }
        } catch {
          /* offline / profile failure — fall back to local */
        }
      }

      if (!active) return;

      if (dbConsent) {
        // DB wins for logged-in users; mirror to local so GA + future visits stay in sync
        setCookieConsent(dbConsent);
        setVisible(false);
        setReady(true);
        return;
      }

      if (local) {
        // Accepted (or necessary) before login — keep it and persist to DB
        applyCookieConsent(local);
        setVisible(false);
        setReady(true);
        updateCookieConsent(local).catch(() => undefined);
        return;
      }

      setVisible(true);
      setReady(true);
    }

    resolveConsent();
    return () => {
      active = false;
    };
  }, [isAuthenticated, loading, user?.id, user?.cookieConsent]);

  const choose = (choice: CookieConsentChoice) => {
    setCookieConsent(choice);
    setVisible(false);
    if (isAuthenticated) {
      updateCookieConsent(choice).catch(() => undefined);
    }
  };

  if (!ready || !visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[100] p-4 sm:p-5 pointer-events-none"
    >
      <div className="pointer-events-auto max-w-[1440px] mx-auto border border-border bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
        <div className="px-5 py-4 sm:px-6 sm:py-5 flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
              Cookies
            </div>
            <p className="text-sm text-foreground/85 leading-relaxed">
              We use essential cookies to run OreWire and optional cookies to analyze site usage.
              See our{" "}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-accent font-medium">
                Privacy Policy
              </Link>{" "}
              for details.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button
              type="button"
              onClick={() => choose("necessary")}
              className="h-10 px-4 border border-border bg-background hover:bg-muted text-sm font-medium transition-colors"
            >
              Necessary only
            </button>
            <button
              type="button"
              onClick={() => choose("accepted")}
              className="h-10 px-5 bg-accent text-accent-foreground hover:opacity-90 text-sm font-semibold transition-opacity"
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsent;
