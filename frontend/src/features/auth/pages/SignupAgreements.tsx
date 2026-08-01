import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import SiteLayout from "@/layouts/SiteLayout";
import { completeSignupAgreements } from "@/lib/api";

const SignupAgreements = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirect") || "/watchlist";
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [briefingEnabled, setBriefingEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!acceptedTerms) {
      setError("You must agree to the terms to continue");
      return;
    }
    setSubmitting(true);
    try {
      await completeSignupAgreements({ acceptedTerms: true, briefingEnabled });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save agreements");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SiteLayout className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1">
        <div className="max-w-[480px] mx-auto px-6 py-16">
          <div className="border border-border bg-card p-6 md:p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Almost done
            </div>
            <h1 className="font-display text-2xl font-bold mb-2">Confirm your account</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Before we finish Google sign-up, please confirm the terms below.
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
              <label className="flex items-start gap-3 text-sm leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
                  required
                />
                <span>
                  By continuing you agree to our{" "}
                  <Link to="/terms" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                    terms
                  </Link>
                  . OreWire is editorial intelligence, not investment advice.
                </span>
              </label>

              <label className="flex items-start gap-3 text-sm leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={briefingEnabled}
                  onChange={(e) => setBriefingEnabled(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
                />
                <span>
                  Send me the{" "}
                  <span className="font-medium text-foreground">morning summary</span> email with the filings and names that matter.
                </span>
              </label>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !acceptedTerms}
                className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 font-mono text-[12px] uppercase tracking-[0.22em] font-bold transition-colors"
              >
                {submitting ? "Saving…" : "Continue"}
              </button>
            </form>
          </div>
        </div>
      </main>
    </SiteLayout>
  );
};

export default SignupAgreements;
