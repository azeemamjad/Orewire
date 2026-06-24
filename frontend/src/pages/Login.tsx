import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Lock, Bookmark, TrendingUp, Bell } from "lucide-react";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { forgotPassword, login, register, resendOtp, resetPassword, verifyLoginOtp, verifyRegistrationOtp } from "@/lib/api";

type Mode = "signin" | "register";
type Stage = "form" | "verify-register" | "verify-login" | "reset-request" | "reset-verify";

const FEATURES = [
  { icon: Bookmark, title: "Custom watchlists", body: "Track the juniors you care about. Reorder by conviction." },
  { icon: TrendingUp, title: "Verdicts on every filing", body: "Noteworthy, Watch or Routine — no more 60-page PDFs." },
  { icon: Bell, title: "Mover alerts", body: "Insider buys, drill results, financings — pushed to your feed." },
];

const fieldClass = "h-11 rounded-none border-foreground/15 bg-muted/40 focus-visible:ring-accent focus-visible:border-foreground/40";
const labelClass = "text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-1.5 block";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get("redirect") || "/watchlist";
  const isRegisterRoute = location.pathname === "/register";
  const [mode, setMode] = useState<Mode>(isRegisterRoute ? "register" : "signin");
  const [stage, setStage] = useState<Stage>("form");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resendLeft, setResendLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (stage === "verify-register") {
        await verifyRegistrationOtp(email.trim(), otp.trim());
        navigate(redirectTo);
      } else if (stage === "verify-login") {
        const resp = await verifyLoginOtp(email.trim(), otp.trim());
        navigate(resp.user?.mustChangePassword ? `/change-password?redirect=${encodeURIComponent(redirectTo)}` : redirectTo);
      } else if (stage === "reset-request") {
        await forgotPassword(email.trim());
        setStage("reset-verify");
        startCountdown(60);
      } else if (stage === "reset-verify") {
        await resetPassword(email.trim(), otp.trim(), newPassword);
        setMode("signin");
        setStage("form");
        setPassword("");
        setOtp("");
        setNewPassword("");
      } else if (mode === "signin") {
        const resp = await login(email.trim(), password);
        if (resp.requiresTwoStep) {
          setStage("verify-login");
          startCountdown(Math.max(1, Math.ceil((resp.retryAfterMs ?? 60000) / 1000)));
        } else if (resp.user?.mustChangePassword) {
          navigate(`/change-password?redirect=${encodeURIComponent(redirectTo)}`);
        } else {
          navigate(redirectTo);
        }
      } else {
        const resp = await register(
          firstName.trim(),
          lastName.trim(),
          username.trim(),
          email.trim(),
          password,
          company.trim() || undefined,
        );
        if (resp.requiresVerification) {
          setStage("verify-register");
          startCountdown(60);
        } else {
          navigate(redirectTo);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel =
    submitting
      ? "Please wait…"
      : stage === "verify-register"
        ? "Verify OTP"
        : stage === "verify-login"
          ? "Verify sign in"
          : stage === "reset-request"
            ? "Send reset code"
            : stage === "reset-verify"
              ? "Reset password"
              : mode === "register"
                ? "Sign Up"
                : "Login";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />

      <main className="flex-1">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-10 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div className="lg:pr-8 lg:border-r lg:border-border lg:min-h-[640px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-4">
                OreWire / Terminal
              </div>
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight">
                The intelligence layer for junior mining.
              </h1>
              <p className="text-muted-foreground mt-5 text-base md:text-lg max-w-md leading-relaxed">
                TSX, TSX-V, CSE and ASX filings — read, ranked and routed to the names you actually own.
              </p>

              <ul className="mt-10 space-y-5 max-w-md">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex items-start gap-4 pb-5 border-b border-border last:border-0">
                    <div className="w-11 h-11 border border-border bg-card flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                      <div className="font-display font-bold text-[15px]">{title}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{body}</div>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-10 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Not investment advice. Information only.
              </p>
            </div>

            <div className="w-full max-w-[480px] mx-auto lg:mx-0">
              <div className="grid grid-cols-2" role="tablist">
                {(["signin", "register"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => { setMode(m); setStage("form"); setError(null); }}
                    className={cn(
                      "h-12 font-mono text-[11px] uppercase tracking-[0.22em] font-bold border transition-colors",
                      mode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground/80 border-border hover:text-foreground",
                    )}
                  >
                    {m === "signin" ? "Sign In" : "Register"}
                  </button>
                ))}
              </div>

              <div className="border border-t-0 border-border bg-card p-6 md:p-8">
                <form onSubmit={onSubmit} className="space-y-4">
                  {mode === "register" && stage === "form" && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label className={labelClass} htmlFor="firstName">First name</Label>
                          <Input id="firstName" className={fieldClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" required minLength={2} />
                        </div>
                        <div>
                          <Label className={labelClass} htmlFor="lastName">Last name</Label>
                          <Input id="lastName" className={fieldClass} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" required minLength={2} />
                        </div>
                      </div>
                      <div>
                        <Label className={labelClass} htmlFor="username">Username</Label>
                        <Input id="username" className={fieldClass} value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="john_doe" required minLength={3} maxLength={24} />
                      </div>
                      <div>
                        <Label className={labelClass} htmlFor="company">
                          Company <span className="normal-case tracking-normal text-muted-foreground/70 font-sans">(optional)</span>
                        </Label>
                        <Input id="company" className={fieldClass} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Capital" maxLength={100} />
                      </div>
                    </>
                  )}

                  {(stage === "form" || stage === "reset-request") && (
                    <div>
                      <Label className={labelClass} htmlFor="email">
                        {mode === "signin" ? "Email or username" : "Email"}
                      </Label>
                      <Input
                        id="email"
                        type={mode === "signin" ? "text" : "email"}
                        className={fieldClass}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        autoComplete={mode === "signin" ? "username" : "email"}
                      />
                    </div>
                  )}

                  {stage === "form" && (
                    <div>
                      <Label className={labelClass} htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        className={fieldClass}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={6}
                        autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      />
                    </div>
                  )}

                  {(stage === "verify-register" || stage === "verify-login" || stage === "reset-verify") && (
                    <div>
                      <p className="font-mono text-[11px] text-foreground/80 mb-4">
                        OTP sent to <span className="text-accent">{email.trim()}</span>
                      </p>
                      <Label className={labelClass} htmlFor="otp">OTP code</Label>
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
                        {resendLeft > 0 ? `Resend available in ${resendLeft}s` : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await resendOtp(
                                  email.trim(),
                                  stage === "verify-register" ? "register" : stage === "verify-login" ? "login_2fa" : "reset_password",
                                );
                                startCountdown(60);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Could not resend");
                              }
                            }}
                            className="text-accent hover:underline font-medium"
                          >
                            Resend email
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {stage === "reset-verify" && (
                    <div>
                      <Label className={labelClass} htmlFor="newPassword">New password</Label>
                      <Input id="newPassword" type="password" className={fieldClass} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
                    </div>
                  )}

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
                    {submitLabel}
                  </button>

                  {mode === "signin" && stage === "form" && (
                    <button type="button" onClick={() => { setStage("reset-request"); setError(null); }} className="text-sm text-accent hover:underline font-medium">
                      Forgot password?
                    </button>
                  )}

                  {(stage === "verify-register" || stage === "verify-login" || stage === "reset-request" || stage === "reset-verify") && (
                    <button type="button" onClick={() => { setStage("form"); setError(null); setOtp(""); }} className="text-sm text-muted-foreground hover:text-foreground">
                      Back
                    </button>
                  )}

                  <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
                    By continuing you agree to our{" "}
                    <Link to="/terms" className="underline hover:text-foreground">terms</Link>. OreWire is editorial intelligence, not investment advice.
                  </p>

                  <div className="mt-6 pt-5 border-t border-border flex items-center justify-between text-xs">
                    <Link to="/" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                      ← Back to home
                    </Link>
                    <button
                      type="button"
                      onClick={() => setMode(mode === "register" ? "signin" : "register")}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {mode === "register" ? "Have an account? Sign in" : "New here? Create account"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Login;
