import { ArrowRight, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { googleAuthStartUrl } from "@/lib/api";
import type { SignupContext } from "@/hooks/use-signup-modal";

/**
 * SignupModal — anonymous-visitor signup dialog.
 *
 * Design ported from the Lovable export (src/components/site/SignupModal.tsx):
 * centred modal, navy #1A2332 header, off-white #F7F6F3 body, gold #C8941A
 * primary button, `context` prop that swaps the headline.
 *
 * Behaviour was rewritten because the export's two actions were both Supabase:
 *   - `supabase.auth.signInWithOtp({ email })` — a magic-link flow. OreWire has
 *     no magic-link endpoint; POST /api/auth/register requires first name, last
 *     name, username, email, password and acceptedTerms, and POST
 *     /api/auth/login verifies a password. No endpoint URL was invented; the
 *     action now hands off to the existing /register screen instead.
 *   - `lovable.auth.signInWithOAuth("google", ...)` — Lovable's hosted auth.
 *     Replaced with OreWire's own Google OAuth entry point,
 *     googleAuthStartUrl() from @/features/auth/api (GET /api/auth/google/start).
 *
 * `context` still drives the headline exactly as in the export, so callers can
 * keep using openSignup({ context: "watchlist", ticker }) unchanged.
 */

const headline = (context: SignupContext, ticker?: string) => {
  const t = ticker ?? "this company";
  switch (context) {
    case "watchlist": return `Track ${t} for free`;
    case "alert": return `Get an email the moment ${t} files`;
    case "feed": return "See every filing, free";
    case "filters": return "Filter by exchange, commodity, and verdict";
    case "insiders": return "See full insider ownership and trades";
    case "history": return "See the full filing history";
    default: return "Create your free OreWire account";
  }
};

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
);

/** `/register`, carrying an internal redirect so the visitor lands back here. */
const registerHref = (from: string) =>
  `/register?redirect=${encodeURIComponent(from || "/watchlist")}`;

const SignupModal = ({
  open, onOpenChange, context, ticker,
}: { open: boolean; onOpenChange: (o: boolean) => void; context: SignupContext; ticker?: string }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");

  const from = `${location.pathname}${location.search}`;
  const registerTo = registerHref(from);

  // The modal lives at the app root (SignupModalProvider), so it must not leak
  // the typed email from one visitor context into the next.
  useEffect(() => {
    if (!open) setEmail("");
  }, [open]);

  /* TODO(wire): the export sent a magic link (supabase.auth.signInWithOtp) so the
     visitor never left the page. OreWire has no equivalent endpoint, so this
     carries the address to /register, which pre-fills it. If a server-side
     magic-link route is ever added under Server/routes/api/, replace this with a
     real request instead. */
  const onEmail = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`${registerTo}&email=${encodeURIComponent(email.trim())}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-md gap-0 border-border">
        <div className="bg-[#1A2332] text-[#F7F6F3] px-6 pt-7 pb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[#F7F6F3]/60 mb-2">OreWire</div>
          <DialogTitle className="font-display text-2xl font-bold leading-tight text-[#F7F6F3]">
            {headline(context, ticker)}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-[#F7F6F3]/75 mt-2">
            Free. No credit card. Decoded filings and news releases for 2,000+ mining and resource companies across TSX, TSX-V, CSE, and ASX.
          </DialogDescription>
        </div>
        <div className="bg-[#F7F6F3] text-[#1A2332] px-6 py-6">
          <button
            type="button"
            onClick={() => { window.location.href = googleAuthStartUrl(from || "/watchlist"); }}
            className="w-full h-11 inline-flex items-center justify-center gap-2 border border-[#1A2332]/20 bg-white text-[#1A2332] text-sm font-semibold hover:bg-[#1A2332]/5 transition-colors"
          >
            <GoogleIcon /> Continue with Google
          </button>
          <div className="flex items-center gap-3 my-4 text-[11px] font-mono uppercase tracking-widest text-[#1A2332]/50">
            <span className="flex-1 h-px bg-[#1A2332]/15" /> or <span className="flex-1 h-px bg-[#1A2332]/15" />
          </div>
          <form onSubmit={onEmail} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-11 px-3 border border-[#1A2332]/20 bg-white text-sm outline-none focus:border-[#C8941A]"
            />
            <button
              type="submit"
              className="w-full h-11 inline-flex items-center justify-center gap-2 bg-[#C8941A] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              <Mail className="w-4 h-4" /> Create free account
            </button>
          </form>
          <Link
            to={`/login?redirect=${encodeURIComponent(from || "/watchlist")}`}
            onClick={() => onOpenChange(false)}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-[#1A2332]/70 hover:text-[#1A2332] transition-colors"
          >
            Already have an account? Sign in <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <p className="text-[11px] text-[#1A2332]/55 mt-5 text-center">
            Information for educational purposes only, not investment advice.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SignupModal;
