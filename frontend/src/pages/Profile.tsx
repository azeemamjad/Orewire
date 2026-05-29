import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Nav from "@/components/site/Nav";
import { fetchProfile, updateProfile, updateTwoStep, type AuthUser } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

const Profile = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [twoStepEnabled, setTwoStepEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/login?redirect=/profile");
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchProfile()
      .then((data) => {
        setProfile(data.user);
        setFirstName(data.user.firstName || "");
        setLastName(data.user.lastName || "");
        setUsername(data.user.username || "");
        setTwoStepEnabled(!!data.user.twoStepEnabled);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profile"));
  }, [isAuthenticated]);

  const onSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        username: username.trim(),
      });
      setProfile(updated.user);
      setMessage("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  const onToggleTwoStep = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateTwoStep(!twoStepEnabled);
      const enabled = !!updated.user.twoStepEnabled;
      setTwoStepEnabled(enabled);
      setProfile(updated.user);
      setMessage(enabled ? "2-step verification enabled." : "2-step verification disabled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update 2-step verification");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
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
                className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
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
                className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
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
                className="w-full h-11 px-3 bg-background border border-border text-sm outline-none focus:border-accent"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center bg-accent text-accent-foreground px-4 h-11 text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {saving ? "Saving..." : "Save profile"}
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
            disabled={saving}
            className={`inline-flex items-center justify-center px-4 h-11 text-sm font-semibold border transition-colors disabled:opacity-60 ${
              twoStepEnabled
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-green-300 bg-green-50 text-green-700"
            }`}
          >
            {twoStepEnabled ? "Disable 2-step verification" : "Enable 2-step verification"}
          </button>
        </section>

        {message && <div className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-2">{message}</div>}
        {error && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2">{error}</div>}
      </main>
    </div>
  );
};

export default Profile;
