import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SiteLayout from "@/layouts/SiteLayout";
import { consumeOauthToken, setAuth } from "@/lib/api";

const GoogleAuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || "";
    if (!token) {
      const oauthError = params.get("oauth_error");
      setError(oauthError || "Missing Google OAuth token");
      return;
    }

    let active = true;
    consumeOauthToken(token)
      .then((resp) => {
        if (!active) return;
        setAuth(resp);
        const redirectTo = resp.redirectTo || "/watchlist";
        if (resp.user?.termsAccepted === false) {
          navigate(`/auth/agree?redirect=${encodeURIComponent(redirectTo)}`, { replace: true });
          return;
        }
        navigate(redirectTo, { replace: true });
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Google sign-in failed");
      });

    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <SiteLayout className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1">
        <div className="max-w-[480px] mx-auto px-6 py-16">
          <div className="border border-border bg-card p-8">
            <h1 className="font-display text-2xl font-bold mb-3">Signing you in</h1>
            {error ? (
              <>
                <p className="text-sm text-destructive mb-4">{error}</p>
                <button
                  type="button"
                  onClick={() => navigate("/login", { replace: true })}
                  className="text-sm text-accent hover:underline font-medium"
                >
                  Back to login
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Completing Google authentication...</p>
            )}
          </div>
        </div>
      </main>
    </SiteLayout>
  );
};

export default GoogleAuthCallback;
