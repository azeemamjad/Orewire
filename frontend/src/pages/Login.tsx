import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Lock, Bookmark, TrendingUp, Bell } from "lucide-react";
import Nav from "@/components/site/Nav";
import { login, register } from "@/lib/api";

type Mode = "signin" | "register";

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get("redirect") || "/watchlist";
  const isRegisterRoute = location.pathname === "/register";
  const [mode, setMode] = useState<Mode>(isRegisterRoute ? "register" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }
      navigate(redirectTo);
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
                onClick={() => { setMode("signin"); setError(null); }}
                className={`h-12 font-mono text-[11px] uppercase tracking-[0.2em] font-semibold transition-colors ${
                  mode === "signin"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface text-foreground/70 border border-border border-l-0"
                }`}
              >
                Sign in
              </button>
              <button
                onClick={() => { setMode("register"); setError(null); }}
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
              <div>
                <label htmlFor="email" className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
                  placeholder="you@example.com"
                />
              </div>

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
                  ? mode === "signin" ? "Signing in..." : "Creating account..."
                  : "Enter terminal"}
              </button>

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
