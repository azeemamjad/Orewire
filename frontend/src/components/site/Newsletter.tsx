import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { subscribeMorningBriefing } from "@/lib/api";
import { toast } from "sonner";

const Newsletter = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await subscribeMorningBriefing(trimmed);
      toast.success("You're subscribed to the Morning Briefing.");
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not subscribe");
    } finally {
      setLoading(false);
    }
  };

  return (
  <section id="cta" className="border-b border-border bg-background">
    <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-16 lg:py-20 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">/// Morning brief</div>
      <h2 className="font-display text-3xl lg:text-5xl font-extrabold leading-tight mb-3">
        Get the morning brief before the market opens.
      </h2>
      <p className="text-base lg:text-lg text-foreground/70 max-w-2xl mx-auto mb-8">
        The day's most important mining filings - summarized, scored, and delivered to your inbox by 7:30am ET.
      </p>
      <form className="flex flex-col sm:flex-row gap-2 max-w-lg mx-auto" onSubmit={handleSubmit}>
        <input
          type="email"
          required
          placeholder="you@firm.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 bg-surface border border-border px-4 h-12 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 bg-accent text-accent-foreground px-6 h-12 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? "…" : "Subscribe Free"} <ArrowUpRight className="w-4 h-4" />
        </button>
      </form>
      <p className="font-mono text-[11px] text-muted-foreground mt-4">
        Free subscribers get the top 3 items. Upgrade for the full digest.
      </p>
    </div>
  </section>
  );
};

export default Newsletter;
