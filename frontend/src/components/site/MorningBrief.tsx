import { ArrowRight, Mail } from "lucide-react";
import { useState } from "react";
import { subscribeMorningBriefing } from "@/lib/api";
import { toast } from "sonner";

const MorningBrief = () => {
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
    <div className="bg-background border-b border-border">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-10 h-14 flex items-center justify-center gap-6">
        <div className="flex items-center gap-2.5 text-[13px] text-foreground/80 min-w-0">
          <span className="inline-flex items-center justify-center w-6 h-6 bg-accent/15 shrink-0">
            <Mail className="w-3.5 h-3.5 text-accent" />
          </span>
          <span className="truncate">
            <span className="font-semibold text-foreground">Morning Brief</span>
            <span className="text-muted-foreground hidden sm:inline"> — daily summary in your inbox</span>
          </span>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex items-center h-9 border border-border bg-card overflow-hidden focus-within:border-accent transition-colors"
        >
          <input
            type="email"
            required
            placeholder="you@firm.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-full w-44 sm:w-56 bg-transparent pl-3 pr-2 text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-full inline-flex items-center gap-1 px-4 text-[12px] font-semibold bg-foreground text-background hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60"
          >
            {loading ? "…" : "Subscribe"} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default MorningBrief;
