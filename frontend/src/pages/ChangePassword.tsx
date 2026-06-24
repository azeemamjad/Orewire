import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { changePassword } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const fieldClass = "h-11 rounded-none border-foreground/15 bg-muted/40 focus-visible:ring-accent focus-visible:border-foreground/40";
const labelClass = "text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1.5 block";

const ChangePassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, loading } = useAuth();
  const redirectTo = new URLSearchParams(location.search).get("redirect") || "/watchlist";
  const forced = !!user?.mustChangePassword;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login?redirect=/change-password");
  }, [isAuthenticated, loading, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-[480px] mx-auto px-6 py-10 lg:py-16">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
            OreWire / Account
          </div>
          <h1 className="font-display text-3xl font-extrabold mb-2">
            {forced ? "Set a new password" : "Change password"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {forced
              ? "Your account was created with a temporary password. Choose a new password to continue."
              : "Enter your current password and choose a new one."}
          </p>

          <div className="border border-border bg-card p-6 md:p-8">
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label className={labelClass} htmlFor="currentPassword">
                  {forced ? "Temporary password" : "Current password"}
                </Label>
                <Input
                  id="currentPassword"
                  type="password"
                  className={fieldClass}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
              <div>
                <Label className={labelClass} htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  className={fieldClass}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label className={labelClass} htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  className={fieldClass}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 font-mono text-[12px] uppercase tracking-[0.22em] font-bold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                {submitting ? "Please wait…" : "Update password"}
              </button>

              {!forced && (
                <div className="mt-4 pt-4 border-t border-border">
                  <Link to="/profile" className={cn("text-sm text-muted-foreground hover:text-foreground")}>← Back to profile</Link>
                </div>
              )}
            </form>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ChangePassword;
