import { Search, Bell, Filter, ArrowUpRight, ArrowDownRight, Clock, ExternalLink, ChevronDown, Flame, TrendingUp, TrendingDown } from "lucide-react";

const Terminal = () => (
  <section className="relative border-b border-border/70">
    {/* Live status bar */}
    <div className="bg-foreground text-background">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 h-9 flex items-center gap-6 text-[11px] font-mono">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-noteworthy animate-pulse-dot" />
          <span className="uppercase tracking-widest">Live</span>
        </div>
        <span className="opacity-60">Mon Apr 24 · 09:47 EST</span>
        <span className="hidden md:inline opacity-60">Monitoring 2,417 juniors</span>
        <span className="hidden lg:inline opacity-60">SEDAR+ · ASX · CSE</span>
        <div className="ml-auto hidden md:flex items-center gap-4">
          <span className="opacity-60">Today's filings</span><span>148</span>
          <span className="opacity-60">Noteworthy</span><span className="text-noteworthy-foreground bg-noteworthy px-1.5">7</span>
          <span className="opacity-60">Watch</span><span className="text-watch-foreground bg-watch px-1.5">19</span>
        </div>
      </div>
    </div>

    {/* Marquee ticker */}
    <div className="border-b border-border/70 bg-surface overflow-hidden">
      <div className="flex ticker whitespace-nowrap py-2.5 font-mono text-xs">
        {Array.from({ length: 2 }).map((_, k) => (
          <div key={k} className="flex gap-8 px-5">
            {tickerItems.map((t, i) => (
              <span key={i} className="flex items-center gap-2">
                <span className="text-foreground font-bold">{t.sym}</span>
                <span className={t.up ? "text-noteworthy" : "text-destructive"}>
                  {t.up ? "▲" : "▼"} {t.pct}
                </span>
                <span className="text-foreground/60">{t.px}</span>
                <span className="opacity-30">·</span>
                <span className="text-foreground/80">{t.tag}</span>
                <span className="opacity-30 px-2">|</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>

    {/* Terminal main grid */}
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <h1 className="font-display text-2xl lg:text-3xl font-extrabold leading-none mr-3">
          AssayFeed<span className="text-accent">.</span> <span className="text-muted-foreground font-normal text-base">Mining filings, decoded.</span>
        </h1>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-surface border border-border px-3 h-9 w-72 max-w-full">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input className="bg-transparent text-xs flex-1 outline-none placeholder:text-muted-foreground" placeholder="Search ticker, project, commodity…" />
            <span className="text-[10px] font-mono text-muted-foreground border border-border px-1">⌘K</span>
          </div>
          <button className="h-9 px-3 bg-surface border border-border text-xs font-mono uppercase flex items-center gap-1.5"><Filter className="w-3 h-3" />Filters</button>
          <a href="#cta" className="h-9 px-4 bg-foreground text-background text-xs font-mono uppercase flex items-center gap-1.5 hover:bg-primary transition-colors">Sign in <ArrowUpRight className="w-3 h-3" /></a>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border mb-5 overflow-x-auto">
        <Tab active>Live news</Tab>
        <Tab>Screener</Tab>
        <Tab>Drill results</Tab>
        <Tab>Resource updates</Tab>
        <Tab>Placements</Tab>
        <Tab>Calendar</Tab>
        <Tab>Performance</Tab>
        <div className="ml-auto hidden md:flex items-center gap-3 text-[10px] font-mono text-muted-foreground py-2">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-noteworthy" /> Noteworthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-watch" /> Watch</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-routine" /> Routine</span>
        </div>
      </div>

      {/* Three-pane terminal */}
      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        {/* LEFT - Live news feed */}
        <div className="col-span-12 lg:col-span-4 bg-surface border border-border flex flex-col">
          <PaneHeader title="Live news" sub="148 today" />
          <div className="divide-y divide-border overflow-hidden">
            <NewsRow tone="noteworthy" sym="TSXV:SCZ" type="Drill" title="Eagle Lake - 12.4m @ 3.2 g/t Au from 287m" time="07:31" active />
            <NewsRow tone="watch" sym="ASX:DEG" type="JORC" title="Hemi resource upgrade - +18% Indicated category" time="07:42" />
            <NewsRow tone="noteworthy" sym="TSXV:NFG" type="Drill" title="Step-out: 2.1m @ 24 g/t Au, 4km from main zone" time="07:22" />
            <NewsRow tone="watch" sym="CSE:GR" type="Placement" title="$4.2M placement at $0.18, 0.8× market cap" time="07:11" />
            <NewsRow tone="noteworthy" sym="TSXV:NXE" type="43-101" title="Tech report filed - first Indicated category" time="07:04" />
            <NewsRow tone="routine" sym="ASX:CXO" type="Quarterly" title="Quarterly activities - production on guidance" time="06:58" />
            <NewsRow tone="routine" sym="TSXV:LUM" type="AIF" title="AIF re-filing - no material change" time="06:51" />
            <NewsRow tone="watch" sym="ASX:RMS" type="Drill" title="Mt Magnet 4.1m @ 8.7 g/t Au extension" time="06:44" />
          </div>
          <div className="mt-auto px-4 py-2.5 border-t border-border text-[10px] font-mono text-muted-foreground flex items-center justify-between">
            <span>Updated 12s ago</span>
            <a href="#feed" className="underline underline-offset-2">View all →</a>
          </div>
        </div>

        {/* CENTER - Featured translation */}
        <div className="col-span-12 lg:col-span-5 bg-surface border border-border flex flex-col">
          <PaneHeader title="Translation" sub="TSXV:SCZ · 07:31 EST" />
          <div className="p-5 lg:p-6 border-b border-border bg-primary text-primary-foreground relative overflow-hidden">
            <div className="absolute inset-0 topo opacity-15 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3 text-[10px] font-mono uppercase tracking-widest">
                <span className="bg-foreground text-background px-2 py-0.5">Noteworthy</span>
                <span className="opacity-80">Drill result · Eagle Lake 23-001</span>
              </div>
              <h2 className="font-display text-3xl lg:text-4xl font-extrabold leading-[0.95] mb-3">
                12.4m @ 3.2 g/t Au<br />from 287m depth
              </h2>
              <p className="text-sm leading-relaxed opacity-95">
                Santa Cruz Mining hit a high-grade gold intercept at <strong>2.4× the deposit's average</strong>, in a previously untested zone - and the hole ended in mineralization, meaning the system may extend deeper.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-px bg-border">
            <Stat label="Grade" value="3.2" unit="g/t" />
            <Stat label="Width" value="12.4" unit="m true" />
            <Stat label="Depth" value="287" unit="m" />
            <Stat label="Vs avg" value="2.4×" unit="deposit" />
          </div>
          <div className="p-5 lg:p-6 space-y-3 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Why this matters</div>
            <KeyFact i="01" t="Grade vs deposit avg" v="3.2 g/t Au is well above the 1.3 g/t historic district mine average." />
            <KeyFact i="02" t="True width is meaningful" v="12.4m true width indicates a structurally robust zone, not a thin vein." />
            <KeyFact i="03" t="Open at depth" v="Final assay was the highest of the hole - the deposit is not closed off vertically." />
          </div>
          <div className="px-5 lg:px-6 py-3 border-t border-border text-[10px] font-mono text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5"><ExternalLink className="w-3 h-3" /> SEDAR+ · NR-2026-04-24-01 · 38 pages</span>
            <a href="#cta" className="underline underline-offset-2 text-foreground">Unlock full report →</a>
          </div>
        </div>

        {/* RIGHT - Screener / movers */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4 lg:gap-5">
          {/* Movers */}
          <div className="bg-surface border border-border">
            <PaneHeader title="Movers" sub="On filings" />
            <div className="px-3 py-1 flex gap-1 border-b border-border text-[10px] font-mono uppercase">
              <MiniTab active>Up</MiniTab>
              <MiniTab>Down</MiniTab>
              <MiniTab>Vol</MiniTab>
            </div>
            <div className="divide-y divide-border">
              <MoverRow sym="TSXV:SCZ" px="$0.42" pct="+38.2%" up reason="Hi-grade hit" />
              <MoverRow sym="TSXV:NFG" px="$1.18" pct="+22.7%" up reason="Step-out" />
              <MoverRow sym="ASX:DEG" px="A$1.04" pct="+11.4%" up reason="JORC +18%" />
              <MoverRow sym="TSXV:NXE" px="$5.87" pct="+6.3%" up reason="43-101" />
              <MoverRow sym="CSE:GR" px="$0.21" pct="-9.8%" reason="Dilution" />
            </div>
          </div>

          {/* Hot commodities */}
          <div className="bg-surface border border-border">
            <PaneHeader title="Commodity heat" sub="7-day filings" />
            <div className="p-3 space-y-2">
              <Heat label="Gold" pct={84} count={62} trend="up" />
              <Heat label="Copper" pct={71} count={48} trend="up" />
              <Heat label="Lithium" pct={42} count={29} trend="down" />
              <Heat label="Uranium" pct={58} count={31} trend="up" />
              <Heat label="Silver" pct={36} count={18} trend="down" />
              <Heat label="Nickel" pct={28} count={12} trend="down" />
            </div>
          </div>

          {/* Today calendar */}
          <div className="bg-surface border border-border">
            <PaneHeader title="On deck" sub="Next 5 days" />
            <div className="divide-y divide-border text-xs">
              <CalRow d="Apr 25" sym="TSXV:AXR" e="PEA expected" />
              <CalRow d="Apr 26" sym="ASX:CMM" e="Q-result" />
              <CalRow d="Apr 28" sym="TSXV:OSI" e="Resource update" />
              <CalRow d="Apr 29" sym="CSE:KORE" e="Drill batch #4" />
            </div>
          </div>
        </div>
      </div>

      {/* CTA strip */}
      <div className="mt-6 bg-foreground text-background flex items-center justify-between px-5 lg:px-6 py-4 flex-wrap gap-4">
        <div className="flex items-center gap-3 text-sm">
          <Bell className="w-4 h-4 text-accent" />
          <span className="font-mono text-xs uppercase tracking-widest opacity-70">Free tier</span>
          <span>Live news feed + ticker. Translations, screener filters & alerts require an account.</span>
        </div>
        <a href="#cta" className="bg-accent text-accent-foreground px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2 hover:opacity-90">
          Start 14-day trial <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  </section>
);

const tickerItems = [
  { sym: "TSXV:SCZ", pct: "38.2%", px: "$0.42", tag: "Hi-grade hit", up: true },
  { sym: "ASX:DEG", pct: "11.4%", px: "A$1.04", tag: "Hemi +18%", up: true },
  { sym: "TSXV:NFG", pct: "22.7%", px: "$1.18", tag: "Step-out", up: true },
  { sym: "CSE:GR", pct: "9.8%", px: "$0.21", tag: "Dilution", up: false },
  { sym: "ASX:CXO", pct: "1.2%", px: "A$0.16", tag: "Quarterly", up: false },
  { sym: "TSXV:NXE", pct: "6.3%", px: "$5.87", tag: "43-101", up: true },
  { sym: "TSXV:LUM", pct: "0.4%", px: "$0.08", tag: "AIF", up: false },
  { sym: "ASX:RMS", pct: "4.1%", px: "A$2.18", tag: "Mt Magnet", up: true },
];

const Tab = ({ children, active }: { children: React.ReactNode; active?: boolean }) => (
  <button className={`px-4 py-2.5 text-xs font-mono uppercase tracking-wider whitespace-nowrap border-b-2 -mb-px ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
    {children}
  </button>
);

const MiniTab = ({ children, active }: { children: React.ReactNode; active?: boolean }) => (
  <button className={`px-2 py-1 ${active ? "bg-foreground text-background" : "text-muted-foreground"}`}>{children}</button>
);

const PaneHeader = ({ title, sub }: { title: string; sub: string }) => (
  <div className="flex items-center justify-between px-4 h-10 border-b border-border">
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 bg-primary animate-pulse-dot" />
      <span className="font-mono text-[10px] uppercase tracking-widest">{title}</span>
    </div>
    <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>
  </div>
);

const NewsRow = ({ sym, tone, title, type, time, active }: { sym: string; tone: "noteworthy" | "watch" | "routine"; title: string; type: string; time: string; active?: boolean }) => {
  const dot = { noteworthy: "bg-noteworthy", watch: "bg-watch", routine: "bg-routine" }[tone];
  return (
    <div className={`flex gap-3 px-4 py-3 cursor-pointer ${active ? "bg-background" : "hover:bg-background/60"}`}>
      <div className={`w-1 ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-1">
          <span className="truncate">{sym} · {type}</span>
          <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{time}</span>
        </div>
        <div className="text-[13px] font-medium leading-snug">{title}</div>
      </div>
    </div>
  );
};

const Stat = ({ label, value, unit }: { label: string; value: string; unit: string }) => (
  <div className="bg-surface px-3 py-3">
    <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
    <div className="flex items-baseline gap-1">
      <span className="font-display text-2xl font-bold leading-none">{value}</span>
      <span className="text-[9px] font-mono text-muted-foreground">{unit}</span>
    </div>
  </div>
);

const KeyFact = ({ i, t, v }: { i: string; t: string; v: string }) => (
  <div className="flex gap-3 border-t border-border pt-3">
    <span className="font-mono text-[10px] text-muted-foreground">{i}</span>
    <div className="flex-1">
      <div className="text-[11px] font-medium uppercase tracking-wider mb-0.5">{t}</div>
      <div className="text-xs text-foreground/70 leading-relaxed">{v}</div>
    </div>
  </div>
);

const MoverRow = ({ sym, px, pct, up, reason }: { sym: string; px: string; pct: string; up?: boolean; reason: string }) => (
  <div className="flex items-center gap-2 px-3 py-2 hover:bg-background/60">
    <div className="flex-1 min-w-0">
      <div className="text-[11px] font-mono font-bold truncate">{sym}</div>
      <div className="text-[10px] text-muted-foreground truncate">{reason}</div>
    </div>
    <div className="text-right">
      <div className="text-[11px] font-mono">{px}</div>
      <div className={`text-[10px] font-mono font-bold flex items-center justify-end gap-0.5 ${up ? "text-noteworthy" : "text-destructive"}`}>
        {up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}{pct}
      </div>
    </div>
  </div>
);

const Heat = ({ label, pct, count, trend }: { label: string; pct: number; count: number; trend: "up" | "down" }) => (
  <div>
    <div className="flex items-center justify-between text-[11px] font-mono mb-1">
      <span className="flex items-center gap-1.5">
        {trend === "up" ? <TrendingUp className="w-3 h-3 text-noteworthy" /> : <TrendingDown className="w-3 h-3 text-muted-foreground" />}
        {label}
      </span>
      <span className="text-muted-foreground">{count}</span>
    </div>
    <div className="h-1.5 bg-background relative">
      <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
    </div>
  </div>
);

const CalRow = ({ d, sym, e }: { d: string; sym: string; e: string }) => (
  <div className="flex items-center gap-3 px-3 py-2 hover:bg-background/60">
    <span className="font-mono text-[10px] text-muted-foreground w-12">{d}</span>
    <span className="font-mono text-[11px] font-bold">{sym}</span>
    <span className="text-[11px] text-foreground/70 truncate ml-auto">{e}</span>
  </div>
);

export default Terminal;
