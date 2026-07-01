import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SiteLayout from "@/layouts/SiteLayout";
import { Switch } from "@/components/ui/switch";
import { fetchProfile, updateProfile, updateTwoStep, updateNotifications, type AuthUser } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const Profile = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [twoStepEnabled, setTwoStepEnabled] = useState(false);
  const [briefingEnabled, setBriefingEnabled] = useState(true);
  const [watchlistAlertsEnabled, setWatchlistAlertsEnabled] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTwoStep, setSavingTwoStep] = useState(false);
  const [savingNotification, setSavingNotification] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login?redirect=/profile");
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoadingProfile(true);
    fetchProfile()
      .then((data) => {
        setProfile(data.user);
        setFirstName(data.user.firstName || "");
        setLastName(data.user.lastName || "");
        setUsername(data.user.username || "");
        setTwoStepEnabled(!!data.user.twoStepEnabled);
        setBriefingEnabled(data.user.briefingEnabled !== false);
        setWatchlistAlertsEnabled(data.user.watchlistAlertsEnabled !== false);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load profile"))
      .finally(() => setLoadingProfile(false));
  }, [isAuthenticated]);

  const onSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const updated = await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
      });
      setProfile(updated.user);
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const onToggleNotification = async (
    key: "briefingEnabled" | "watchlistAlertsEnabled",
    next: boolean,
  ) => {
    const apply = (v: boolean) =>
      key === "briefingEnabled" ? setBriefingEnabled(v) : setWatchlistAlertsEnabled(v);
    const prev = key === "briefingEnabled" ? briefingEnabled : watchlistAlertsEnabled;
    apply(next);
    setSavingNotification(key);
    try {
      await updateNotifications({ [key]: next });
      toast.success("Notification preferences saved.");
    } catch (err) {
      apply(prev);
      toast.error(err instanceof Error ? err.message : "Could not update notifications");
    } finally {
      setSavingNotification(null);
    }
  };

  const onToggleTwoStep = async () => {
    setSavingTwoStep(true);
    try {
      const updated = await updateTwoStep(!twoStepEnabled);
      const enabled = !!updated.user.twoStepEnabled;
      setTwoStepEnabled(enabled);
      setProfile(updated.user);
      toast.success(enabled ? "2-step verification enabled." : "2-step verification disabled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update 2-step verification");
    } finally {
      setSavingTwoStep(false);
    }
  };

  const notificationsDisabled = loadingProfile || savingNotification !== null;

  return (
    <SiteLayout className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto px-6 lg:px-10 py-10 w-full">
        <h1 className="font-display text-3xl font-extrabold mb-2">Profile</h1>
        <p className="text-sm text-muted-foreground mb-8">Manage your account details and security settings.</p>

        <section className="border border-border bg-surface p-6 mb-6">
          <h2 className="font-display text-xl font-bold mb-4">Account</h2>
          <form onSubmit={onSaveProfile} className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Email</label>
              <input
                type="text"
                value={profile?.email || ""}
                disabled
                className="w-full h-11 px-3 bg-background border border-border text-sm opacity-70"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">First name</label>
              <input
                type="text"
                required
                minLength={2}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={loadingProfile}
                className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Last name</label>
              <input
                type="text"
                required
                minLength={2}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={loadingProfile}
                className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Username</label>
              <input
                type="text"
                required
                minLength={3}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                disabled={loadingProfile}
                className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile || loadingProfile}
              className="inline-flex items-center justify-center bg-accent text-accent-foreground px-4 h-11 text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {savingProfile ? "Saving..." : "Save profile"}
            </button>
          </form>
        </section>

        <section className="border border-border bg-surface p-6">
          <h2 className="font-display text-xl font-bold mb-2">Security</h2>
          <p className="text-sm text-muted-foreground mb-4">
            When enabled, you must enter an OTP sent to your email after password login.
          </p>
          <button
            type="button"
            onClick={onToggleTwoStep}
            disabled={savingTwoStep || loadingProfile}
            className={`inline-flex items-center justify-center px-4 h-11 text-sm font-semibold border transition-colors disabled:opacity-60 ${
              twoStepEnabled
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-green-300 bg-green-50 text-green-700"
            }`}
          >
            {savingTwoStep
              ? "Updating..."
              : twoStepEnabled
                ? "Disable 2-step verification"
                : "Enable 2-step verification"}
          </button>

          <div className="mt-6 pt-6 border-t border-border">
            <h3 className="font-display text-base font-bold mb-1">Password</h3>
            <p className="text-sm text-muted-foreground mb-3">Update the password you use to sign in.</p>
            <Link
              to="/change-password"
              className="inline-flex items-center justify-center px-4 h-11 text-sm font-semibold border border-border bg-background hover:bg-muted/50 transition-colors"
            >
              Change password
            </Link>
          </div>
        </section>

        <section className="border border-border bg-surface p-6 mt-6">
          <h2 className="font-display text-xl font-bold mb-2">Notifications</h2>
          <p className="text-sm text-muted-foreground mb-4">Choose which emails OreWire sends you.</p>
          <div className="divide-y divide-border">
            {([
              {
                key: "briefingEnabled" as const,
                value: briefingEnabled,
                title: "Daily briefing",
                body: "A morning summary of the names and filings that matter.",
              },
              {
                key: "watchlistAlertsEnabled" as const,
                value: watchlistAlertsEnabled,
                title: "Watchlist alerts",
                body: "News, filings and notable price moves for companies you track.",
              },
            ]).map((n) => (
              <div key={n.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="font-medium text-sm">{n.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
                </div>
                <Switch
                  checked={n.value}
                  disabled={notificationsDisabled}
                  onCheckedChange={(checked) => onToggleNotification(n.key, checked)}
                  aria-label={n.title}
                  className="data-[state=checked]:bg-accent"
                />
              </div>
            ))}
          </div>
        </section>
      </main>
    </SiteLayout>
  );
};

export default Profile;
