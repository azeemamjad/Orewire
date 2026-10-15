import { useState } from "react";
import { Mail, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/features/auth/hooks";

/**
 * NewsletterBar — slim "Morning Brief" strip shown above the nav to anonymous
 * visitors only.
 *
 * Design ported from the Lovable export (src/components/site/NewsletterBar.tsx).
 *
 * Behaviour change: the export called `sendMagicLink()` from its SignupModal,
 * i.e. supabase.auth.signInWithOtp. That endpoint does not exist here and no
 * equivalent is invented, so the submit is a local confirmation only and the
 * real wiring is marked TODO(wire) below.
 *
 * The "signed out only" guard is preserved: it uses OreWire's own useAuth()
 * (@/features/auth/hooks) instead of the export's Supabase-backed hook.
 */

const NewsletterBar = () => {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const { isAuthenticated, loading } = useAuth();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    /* TODO(wire): no public newsletter/briefing subscribe endpoint exists in
       Server/routes/. The authenticated opt-in already ships as
       updateNotifications({ briefingEnabled }) in @/features/auth/api and is
       used by the profile screen; wire this bar to a public equivalent when one
       is added, then drop the local-only confirmation below. */
    setDone(true);
    setEmail("");
  };

  if (loading || isAuthenticated) return null;

  return (
    <div className="bg-background border-b border-border">
      <div className="container-page min-h-14 py-2.5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2.5 text-[13px] text-foreground/80 min-w-0">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-accent/15 shrink-0">
            <Mail className="w-3.5 h-3.5 text-accent" />
          </span>
          <span className="truncate">
            <span className="font-semibold text-foreground">Morning Brief</span>
            <span className="text-muted-foreground hidden sm:inline">, get a daily market summary everyday to your inbox</span>
          </span>
        </div>
        {done ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-mono text-[hsl(var(--up))]">
            <Check className="w-4 h-4" /> Check your inbox to confirm
          </span>
        ) : (
          <form
            onSubmit={onSubmit}
            className="flex items-center h-9 rounded-lg border border-border bg-card overflow-hidden focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 transition-colors"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@firm.com"
              className="h-full w-36 sm:w-56 bg-transparent pl-3 pr-2 text-[13px] outline-none placeholder:text-muted-foreground/70"
            />
            <button
              type="submit"
              className="h-full inline-flex items-center gap-1 px-4 text-[12px] font-semibold bg-foreground text-background hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Subscribe <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default NewsletterBar;
