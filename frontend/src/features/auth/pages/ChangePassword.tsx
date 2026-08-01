import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import SiteLayout from "@/layouts/SiteLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { changePassword, requestChangePasswordOtp } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const fieldClass = "h-11 rounded-none border-foreground/15 bg-muted/40 focus-visible:ring-accent focus-visible:border-foreground/40";
const labelClass = "text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1.5 block";

const ChangePassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, loading } = useAuth();
  const redirectTo = new URLSearchParams(location.search).get("redirect") || "/profile";
  const forced = !!user?.mustChangePassword;

  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login?redirect=/change-password");
  }, [isAuthenticated, loading, navigate]);

  const startCountdown = (seconds = 60) => {
    setResendLeft(seconds);
    const timer = window.setInterval(() => {
      setResendLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    setError(null);
    setSendingCode(true);
    try {
      const resp = await requestChangePasswordOtp();
      setCodeSent(true);
      startCountdown(Math.max(1, Math.ceil((resp.retryAfterMs ?? 60000) / 1000)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send verification code");
    } finally {
      setSendingCode(false);
    }
  };

  useEffect(() => {
    if (!loading && isAuthenticated && !codeSent && !sendingCode) {
      sendCode();
    }
    // Auto-send once when the authenticated page loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(otp.trim(), newPassword);
      navigate(forced ? redirectTo : "/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SiteLayout className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1">
        <div className="max-w-[480px] mx-auto px-6 py-10 lg:py-16">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">
            OreWire / Account
          </div>
          <h1 className="font-display text-3xl font-extrabold mb-2">
            {forced ? "Set a new password" : "Change password"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {codeSent
              ? <>We sent a verification code to <span className="text-accent">{user?.email}</span>. Enter it below with your new password.</>
              : "We'll email you a verification code so you can set a new password."}
          </p>

          <div className="border border-border bg-card p-6 md:p-8">
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label className={labelClass} htmlFor="otp">Verification code</Label>
                <Input
                  id="otp"
                  className={cn(fieldClass, "tracking-[0.3em] font-mono")}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
                <div className="mt-2 text-xs text-muted-foreground">
                  {sendingCode
                    ? "Sending code…"
                    : resendLeft > 0
                      ? `Resend available in ${resendLeft}s`
                      : (
                        <button
                          type="button"
                          onClick={sendCode}
                          className="text-accent hover:underline font-medium"
                        >
                          {codeSent ? "Resend code" : "Send code"}
                        </button>
                      )}
                </div>
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
                disabled={submitting || !codeSent}
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
    </SiteLayout>
  );
};

export default ChangePassword;
