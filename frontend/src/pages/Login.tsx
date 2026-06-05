import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Lock, Bookmark, TrendingUp, Bell } from "lucide-react";
import Nav from "@/components/site/Nav";
import { forgotPassword, login, register, resendOtp, resetPassword, verifyLoginOtp, verifyRegistrationOtp } from "@/lib/api";

type Mode = "signin" | "register";
type Stage = "form" | "verify-register" | "verify-login" | "reset-request" | "reset-verify";

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
        await verifyLoginOtp(email.trim(), otp.trim());
        navigate(redirectTo);
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
        } else {
          navigate(redirectTo);
        }
      } else {
        const resp = await register(firstName.trim(), lastName.trim(), username.trim(), email.trim(), password);
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Nav />

      <main className="flex-1 grid lg:grid-cols-2">
        {/* Left: pitch */}
        <section className="bg-background border-r border-border px-8 lg:px-16 py-12 lg:py-20 flex flex-col">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
            Orewire / Terminal
          </div>
          <h1 className="font-display text-4xl lg:text-5xl font-extrabold leading-tight mb-5 max-w-xl">
            The intelligence layer for junior mining.
          </h1>
          <p className="text-sm text-foreground/70 max-w-md mb-10">
            TSX-V, CSE and ASX filings — read, ranked and routed to the names you actually own.
          </p>

          <ul className="space-y-6 max-w-md">
            <Feature
              icon={<Bookmark className="w-4 h-4" />}
              title="Custom watchlists"
              body="Track the juniors you care about. Reorder by conviction."
            />
            <Feature
              icon={<TrendingUp className="w-4 h-4" />}
              title="Verdicts on every filing"
              body="Noteworthy, Watch or Routine — no more 60-page PDFs."
            />
            <Feature
              icon={<Bell className="w-4 h-4" />}
              title="Mover alerts"
              body="Insider buys, drill results, financings — pushed to your feed."
            />
          </ul>

          <div className="mt-auto pt-12 border-t border-border">
            <p className="font-mono text-[10px] text-muted-foreground">
              Not investment advice. Information only.
            </p>
          </div>
        </section>

        {/* Right: form */}
        <section className="bg-surface/40 px-6 lg:px-12 py-12 lg:py-20 flex items-center justify-center">
          <div className="w-full max-w-md">
            {/* Tabs */}
            <div className="grid grid-cols-2 mb-6">
              <button
                onClick={() => { setMode("signin"); setStage("form"); setError(null); }}
                className={`h-12 font-mono text-[11px] uppercase tracking-[0.2em] font-semibold transition-colors ${
                  mode === "signin"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface text-foreground/70 border border-border border-l-0"
                }`}
              >
                Sign in
              </button>
              <button
                onClick={() => { setMode("register"); setStage("form"); setError(null); }}
                className={`h-12 font-mono text-[11px] uppercase tracking-[0.2em] font-semibold transition-colors ${
                  mode === "register"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface text-foreground/70 border border-border border-r-0"
                }`}
              >
                Register
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-5 bg-surface border border-border border-t-0 p-6 -mt-px">
              {mode === "register" && stage === "form" && (
                <>
                  <div>
                    <label htmlFor="firstName" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                      First name
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      required
                      minLength={2}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                      Last name
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      required
                      minLength={2}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                      placeholder="Doe"
                    />
                  </div>
                  <div>
                    <label htmlFor="username" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                      Username
                    </label>
                    <input
                      id="username"
                      type="text"
                      required
                      minLength={3}
                      maxLength={24}
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                      className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                      placeholder="john_doe"
                    />
                  </div>
                </>
              )}

              {(stage === "form" || stage === "reset-request") && (
              <div>
                <label htmlFor="email" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  {mode === "signin" ? "Email or username" : "Email"}
                </label>
                <input
                  id="email"
                  type={mode === "signin" ? "text" : "email"}
                  required
                  autoComplete={mode === "signin" ? "username" : "email"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                  placeholder="you@example.com"
                />
              </div>
              )}

              {stage === "form" && (
              <div>
                <label htmlFor="password" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                  placeholder="••••••••"
                />
              </div>
              )}

              {(stage === "verify-register" || stage === "verify-login" || stage === "reset-verify") && (
                <div>
                  <p className="font-mono text-[11px] text-foreground/80 mb-4">
                    OTP sent to <span className="text-accent">{email.trim()}</span>
                  </p>
                  <label htmlFor="otp" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                    OTP code
                  </label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent tracking-[0.3em] font-mono"
                    placeholder="123456"
                  />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {resendLeft > 0 ? `Resend available in ${resendLeft}s` : (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await resendOtp(
                              email.trim(),
                              stage === "verify-register"
                                ? "register"
                                : stage === "verify-login"
                                  ? "login_2fa"
                                  : "reset_password"
                            );
                            startCountdown(60);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Could not resend");
                          }
                        }}
                        className="text-accent hover:underline"
                      >
                        Resend email
                      </button>
                    )}
                  </div>
                </div>
              )}

              {stage === "reset-verify" && (
                <div>
                  <label htmlFor="newPassword" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                    New password
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                    placeholder="••••••••"
                  />
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground h-12 text-sm font-mono uppercase tracking-[0.2em] font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                <Lock className="w-4 h-4" />
                {submitting
                  ? "Please wait..."
                  : stage === "verify-register"
                    ? "Verify OTP"
                    : stage === "verify-login"
                      ? "Verify sign in"
                    : stage === "reset-request"
                      ? "Send reset code"
                      : stage === "reset-verify"
                        ? "Reset password"
                        : mode === "register"
                          ? "Sign up"
                          : "Login"}
              </button>

              {mode === "signin" && stage === "form" && (
                <button
                  type="button"
                  onClick={() => { setStage("reset-request"); setError(null); }}
                  className="text-xs text-accent hover:underline"
                >
                  Forgot password?
                </button>
              )}

              {(stage === "verify-register" || stage === "verify-login" || stage === "reset-request" || stage === "reset-verify") && (
                <button
                  type="button"
                  onClick={() => { setStage("form"); setError(null); setOtp(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Back
                </button>
              )}

              <p className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                By continuing you agree to our terms. Orewire is editorial intelligence, not investment advice.
              </p>

              <Link to="/" className="block font-mono text-[11px] text-foreground/70 hover:text-foreground">
                ← Back to home
              </Link>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
};

const Feature = ({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) => (
  <li className="flex gap-4">
    <span className="w-9 h-9 grid place-items-center border border-border text-accent shrink-0">{icon}</span>
    <div>
      <div className="font-display text-[15px] font-bold mb-1">{title}</div>
      <p className="text-sm text-foreground/70">{body}</p>
    </div>
  </li>
);

export default Login;
