import { Clock, ArrowUpRight, ArrowDownRight, TrendingUp, Flame } from "lucide-react";

const NewsHero = () => (
  <section className="border-b border-border bg-background">
    {/* Breaking strip */}
    <div className="bg-foreground text-background">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 h-9 flex items-center gap-3 text-[11px] font-mono overflow-hidden">
        <span className="bg-destructive text-destructive-foreground px-2 py-0.5 uppercase tracking-widest font-bold">Breaking</span>
        <span className="opacity-90 truncate">
          TSXV:SCZ — Santa Cruz hits <strong className="text-accent">12.4m @ 3.2 g/t Au</strong> at Eagle Lake, hole ends in mineralization · 07:31 EST
        </span>
        <span className="ml-auto hidden md:flex items-center gap-2 opacity-70">
          <span className="w-1.5 h-1.5 bg-noteworthy animate-pulse-dot" />
          LIVE · Mon Apr 24
        </span>
      </div>
    </div>

    {/* Masthead */}
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 pt-6 pb-4 border-b border-border flex items-end justify-between flex-wrap gap-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">
          Mining Wire · Issue 0428 · Mon Apr 24, 2026
        </div>
        <h1 className="font-display text-3xl lg:text-5xl font-extrabold leading-none">
          The AssayFeed Daily<span className="text-accent">.</span>
        </h1>
        <div className="text-sm text-foreground/70 mt-2 italic font-display">
          Every junior mining filing on SEDAR+ and ASX, decoded before the open.
        </div>
      </div>
      <nav className="flex gap-5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        <a className="text-foreground border-b-2 border-accent pb-1">Top stories</a>
        <a className="hover:text-foreground">Drill results</a>
        <a className="hover:text-foreground">Resources</a>
        <a className="hover:text-foreground">Placements</a>
        <a className="hover:text-foreground">Markets</a>
      </nav>
    </div>

    {/* Front page grid */}
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8 grid grid-cols-12 gap-6 lg:gap-8">
      {/* LEAD STORY */}
      <article className="col-span-12 lg:col-span-7 lg:border-r lg:border-border lg:pr-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="bg-noteworthy text-noteworthy-foreground px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest font-bold">Noteworthy</span>
          <span className="font-mono text-[11px] text-muted-foreground">TSXV:SCZ · Drill result · 07:31 EST</span>
        </div>
        <h2 className="font-display text-[clamp(2rem,4.5vw,3.75rem)] font-extrabold leading-[0.95] mb-4 text-balance">
          Santa Cruz strikes 12.4 metres of high-grade gold at Eagle Lake — and the hole isn't done.
        </h2>
        <p className="text-base lg:text-lg text-foreground/75 leading-relaxed mb-5 max-w-2xl">
          A drill hole that bottomed out in mineralization at 287 metres returned grades <strong className="text-foreground">2.4× the deposit average</strong>, suggesting a structurally robust zone with vertical extension still untested. Shares are indicated +38% in pre-market.
        </p>
        <div className="grid grid-cols-4 gap-px bg-border border border-border mb-5">
          <Stat label="Grade" value="3.2" unit="g/t Au" />
          <Stat label="Width" value="12.4" unit="m true" />
          <Stat label="Depth" value="287" unit="m" />
          <Stat label="Vs avg" value="2.4×" unit="deposit" />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground border-t border-border pt-3">
          <span>By AssayFeed AI · Reviewed by D. Chen, P.Geo</span>
          <a href="#cta" className="text-foreground underline underline-offset-2 inline-flex items-center gap-1">
            Read full translation <ArrowUpRight className="w-3 h-3" />
          </a>
        </div>
      </article>

      {/* HEADLINES + MARKETS */}
      <aside className="col-span-12 lg:col-span-5 flex flex-col gap-6">
        {/* Latest headlines */}
        <div>
          <div className="flex items-center justify-between border-b-2 border-foreground pb-2 mb-3">
            <h3 className="font-display text-lg font-bold">Latest filings</h3>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-noteworthy animate-pulse-dot" /> 148 today
            </span>
          </div>
          <ul className="divide-y divide-border">
            <Headline tone="watch" sym="ASX:DEG" time="07:42" title="Hemi resource upgrade — +18% Indicated category" />
            <Headline tone="noteworthy" sym="TSXV:NFG" time="07:22" title="Step-out: 2.1m @ 24 g/t Au, 4km from main zone" />
            <Headline tone="watch" sym="CSE:GR" time="07:11" title="$4.2M placement at $0.18, 0.8× market cap" />
            <Headline tone="noteworthy" sym="TSXV:NXE" time="07:04" title="Tech report filed — first Indicated category" />
            <Headline tone="routine" sym="ASX:CXO" time="06:58" title="Quarterly activities — production on guidance" />
            <Headline tone="watch" sym="ASX:RMS" time="06:44" title="Mt Magnet 4.1m @ 8.7 g/t Au extension" />
          </ul>
        </div>

        {/* Movers */}
        <div>
          <div className="flex items-center justify-between border-b-2 border-foreground pb-2 mb-3">
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              <Flame className="w-4 h-4 text-accent" /> Movers on filings
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Pre-market</span>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border border border-border">
            <Mover sym="TSXV:SCZ" px="$0.42" pct="+38.2%" up reason="Hi-grade hit" />
            <Mover sym="TSXV:NFG" px="$1.18" pct="+22.7%" up reason="Step-out" />
            <Mover sym="ASX:DEG" px="A$1.04" pct="+11.4%" up reason="JORC +18%" />
            <Mover sym="CSE:GR" px="$0.21" pct="-9.8%" reason="Dilution" />
          </div>
        </div>
      </aside>
    </div>

    {/* Subscribe band */}
    <div className="border-t-4 border-double border-foreground bg-secondary">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm">
          <span className="font-display font-bold">Get the 6am brief.</span>{" "}
          <span className="text-foreground/70">Every notable filing in plain English, delivered before the open.</span>
        </div>
        <form className="flex items-center gap-2">
          <input
            type="email"
            placeholder="you@firm.com"
            className="bg-background border border-border px-3 h-10 text-sm w-64 max-w-full outline-none focus:border-accent"
          />
          <button className="bg-foreground text-background h-10 px-5 text-sm font-medium inline-flex items-center gap-2 hover:bg-primary transition-colors">
            Subscribe free <ArrowUpRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  </section>
);

const Stat = ({ label, value, unit }: { label: string; value: string; unit: string }) => (
  <div className="bg-surface px-3 py-3">
    <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
    <div className="flex items-baseline gap-1">
      <span className="font-display text-2xl font-bold leading-none">{value}</span>
      <span className="text-[9px] font-mono text-muted-foreground">{unit}</span>
    </div>
  </div>
);

const Headline = ({ sym, tone, title, time }: { sym: string; tone: "noteworthy" | "watch" | "routine"; title: string; time: string }) => {
  const dot = { noteworthy: "bg-noteworthy", watch: "bg-watch", routine: "bg-routine" }[tone];
  return (
    <li className="flex gap-3 py-3 group cursor-pointer">
      <div className={`w-1 ${dot} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground mb-1 uppercase tracking-wider">
          <span className="font-bold text-foreground">{sym}</span>
          <span>·</span>
          <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{time}</span>
        </div>
        <div className="font-display text-[15px] font-semibold leading-snug group-hover:underline underline-offset-2">{title}</div>
      </div>
    </li>
  );
};

const Mover = ({ sym, px, pct, up, reason }: { sym: string; px: string; pct: string; up?: boolean; reason: string }) => (
  <div className="bg-surface px-3 py-2.5">
    <div className="flex items-center justify-between mb-0.5">
      <span className="font-mono text-[11px] font-bold">{sym}</span>
      <span className={`font-mono text-[11px] font-bold flex items-center gap-0.5 ${up ? "text-noteworthy" : "text-destructive"}`}>
        {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{pct}
      </span>
    </div>
    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
      <span className="truncate">{reason}</span>
      <span className="font-mono">{px}</span>
    </div>
  </div>
);

export default NewsHero;
