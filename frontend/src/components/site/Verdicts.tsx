const verdicts = [
  {
    name: "Noteworthy",
    tone: "noteworthy",
    desc: "High significance. First-ever resource estimates, >20% upgrades, >5 g/t Au discoveries, >2× market-cap raises.",
    delivery: "Instant alert + featured in daily digest",
    pct: "~6%",
  },
  {
    name: "Watch",
    tone: "watch",
    desc: "Moderate significance. Follow-up drilling on flagged plays, sub-threshold expansions, milestones approaching.",
    delivery: "Mentioned in digest with prior context",
    pct: "~22%",
  },
  {
    name: "Routine",
    tone: "routine",
    desc: "Low significance. Annual restatements, maintenance placements, quarterly MD&A with no project update.",
    delivery: "One-line mention in digest",
    pct: "~72%",
  },
];

const dotMap: Record<string, string> = {
  noteworthy: "bg-noteworthy",
  watch: "bg-watch",
  routine: "bg-routine",
};
const badgeMap: Record<string, string> = {
  noteworthy: "bg-noteworthy text-noteworthy-foreground",
  watch: "bg-watch text-watch-foreground",
  routine: "bg-routine text-routine-foreground",
};

const Verdicts = () => (
  <section id="verdicts" className="border-b border-border/70 bg-surface">
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
      <div className="grid lg:grid-cols-12 gap-10 mb-16">
        <div className="lg:col-span-5">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">/// Verdict system</div>
          <h2 className="font-display text-4xl lg:text-5xl font-bold leading-[0.95]">
            Three verdicts.<br />
            One question:<br />
            <span className="text-primary italic">does this matter?</span>
          </h2>
        </div>
        <div className="lg:col-span-6 lg:col-start-7 text-foreground/70 text-lg leading-relaxed self-end">
          Every translation is graded against objective, deposit-aware criteria — not sentiment. The verdict drives delivery: instant alert, digest mention, or one-liner.
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-px bg-border">
        {verdicts.map((v) => (
          <div key={v.name} className="bg-surface p-8 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <span className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider ${badgeMap[v.tone]}`}>{v.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{v.pct} of filings</span>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-3 h-3 ${dotMap[v.tone]}`} />
              <div className={`flex-1 h-px ${dotMap[v.tone]} opacity-40`} />
            </div>
            <h3 className="font-display text-3xl font-bold mb-4">{v.name}</h3>
            <p className="text-sm leading-relaxed text-foreground/70 mb-6 flex-1">{v.desc}</p>
            <div className="border-t border-border/70 pt-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Delivery → <span className="text-foreground normal-case tracking-normal font-sans">{v.delivery}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Verdicts;
