import { ExternalLink, X } from "lucide-react";

const FeedPreview = () => {
  return (
    <div className="relative">
      {/* Topo backdrop */}
      <div className="absolute -inset-6 topo opacity-60 pointer-events-none" />

      <div className="relative bg-surface shadow-[0_30px_80px_-30px_rgba(0,0,0,0.25)]">
        {/* window chrome */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span className="w-2 h-2 bg-primary rounded-full animate-pulse-dot" />
            Live feed · Today
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <ExternalLink className="w-3.5 h-3.5" />
            <X className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Featured filing */}
        <div className="p-6 border-b border-border/70 relative bg-primary text-primary-foreground">
          <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-20 pointer-events-none topo" />
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 bg-foreground text-background text-[10px] font-mono uppercase tracking-wider">Noteworthy</span>
            <span className="text-[11px] font-mono opacity-80">TSXV:SCZ · 07:31 EST</span>
          </div>
          <div className="text-[10px] font-mono uppercase opacity-80 mb-1">Drill result · Eagle Lake</div>
          <h3 className="font-display text-3xl leading-[0.95] font-bold mb-4">
            12.4m @ 3.2 g/t Au<br />from 287m depth
          </h3>
          <p className="text-sm leading-relaxed opacity-95 mb-5">
            Santa Cruz Mining hit a high-grade gold intercept that's <strong>2.4× the deposit average</strong>,
            in a previously untested zone - and the hole ended in mineralization.
          </p>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Fact k="Grade" v="3.2 g/t" sub="vs 1.3 avg" />
            <Fact k="Width" v="12.4 m" sub="true width" />
            <Fact k="Depth" v="287 m" sub="open below" />
          </div>
        </div>

        {/* Routine list */}
        <div className="divide-y divide-border/70">
          <Row tone="watch" label="Watch" sym="ASX:DEG" title="Hemi resource upgrade - +18% Indicated category" time="07:42" />
          <Row tone="noteworthy" label="Noteworthy" sym="TSXV:NFG" title="Step-out: 2.1m @ 24 g/t Au, 4km from main zone" time="07:22" />
          <Row tone="routine" label="Routine" sym="ASX:CXO" title="Quarterly activities - Q3 production on guidance" time="07:18" />
        </div>
      </div>

      {/* Sticky note */}
      <div className="absolute -top-4 -right-4 lg:-right-8 bg-highlight text-foreground p-3 text-[11px] font-mono leading-tight rotate-3 shadow-md">
        Avg time<br />filing → alert<br /><span className="font-display text-lg font-bold not-italic">47 min</span>
      </div>
    </div>
  );
};

const Fact = ({ k, v, sub }: { k: string; v: string; sub: string }) => (
  <div className="bg-foreground/15 backdrop-blur-sm p-2.5">
    <div className="text-[10px] uppercase tracking-wider opacity-70">{k}</div>
    <div className="font-display text-lg font-bold leading-none mt-1">{v}</div>
    <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>
  </div>
);

const toneMap = {
  noteworthy: "bg-noteworthy text-noteworthy-foreground",
  watch: "bg-watch text-watch-foreground",
  routine: "bg-routine text-routine-foreground",
} as const;

const Row = ({ tone, label, sym, title, time }: { tone: keyof typeof toneMap; label: string; sym: string; title: string; time: string }) => (
  <div className="flex items-start gap-3 px-4 py-3 hover:bg-background/60 transition-colors">
    <span className={`mt-0.5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${toneMap[tone]}`}>{label}</span>
    <div className="flex-1 min-w-0">
      <div className="text-xs font-mono text-muted-foreground">{sym} · {time}</div>
      <div className="text-sm font-medium truncate">{title}</div>
    </div>
  </div>
);

export default FeedPreview;
