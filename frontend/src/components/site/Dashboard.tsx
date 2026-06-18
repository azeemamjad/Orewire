import { ChevronDown, Search, Bell, Settings, LayoutGrid, MapPin, FileSpreadsheet, AlertTriangle, Calendar, BarChart3, Layers, ExternalLink, X, ArrowRight } from "lucide-react";

const Dashboard = () => (
  <section id="feed" className="border-b border-border/70">
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
      <div className="flex items-end justify-between flex-wrap gap-6 mb-12">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">/// Inside the portal</div>
          <h2 className="font-display text-4xl lg:text-6xl font-bold leading-[0.95] max-w-3xl">
            One feed for every<br />junior in <span className="text-primary">North America</span><br />and Australia.
          </h2>
        </div>
        <div className="font-mono text-xs text-muted-foreground max-w-sm">
          Filter by commodity, verdict, filing type or company. Build watchlists. Export to CSV. Backed by a searchable archive of every translation we've ever produced.
        </div>
      </div>

      {/* Dashboard mock */}
      <div className="bg-surface border border-border shadow-[0_40px_120px_-40px_rgba(0,0,0,0.3)]">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border">
          <div className="w-7 h-7 bg-highlight grid place-items-center">
            <div className="grid grid-cols-3 gap-[2px]">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="w-[2px] h-[2px] bg-foreground" />)}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-md bg-background px-3 h-8">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Search 14,238 translated filings…</span>
          </div>
          <div className="hidden md:flex items-center gap-2 ml-auto text-xs">
            <span className="px-2 py-1 bg-background font-mono">CA</span>
            <span className="px-2 py-1 font-mono text-muted-foreground">AU</span>
          </div>
          <Bell className="w-4 h-4 text-muted-foreground" />
          <Settings className="w-4 h-4 text-muted-foreground" />
        </div>

        <div className="grid grid-cols-12 min-h-[640px]">
          {/* Sidebar rail */}
          <aside className="hidden md:flex col-span-1 border-r border-border flex-col items-center py-4 gap-5 text-muted-foreground bg-background/40">
            <LayoutGrid className="w-4 h-4 text-foreground" />
            <Search className="w-4 h-4" />
            <MapPin className="w-4 h-4 text-primary" />
            <AlertTriangle className="w-4 h-4" />
            <FileSpreadsheet className="w-4 h-4" />
            <BarChart3 className="w-4 h-4" />
            <Layers className="w-4 h-4" />
            <Calendar className="w-4 h-4" />
          </aside>

          {/* Feed list */}
          <div className="col-span-12 md:col-span-4 border-r border-border flex flex-col">
            <div className="px-5 py-5 border-b border-border">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Today · Apr 24</div>
              <h3 className="font-display text-3xl font-bold leading-tight">Live Feed</h3>
              <div className="flex gap-2 mt-4 text-[10px] font-mono">
                <Pill active>All</Pill>
                <Pill>Noteworthy</Pill>
                <Pill>Watch</Pill>
                <Pill>Au</Pill>
                <Pill>Cu</Pill>
              </div>
            </div>
            <div className="divide-y divide-border overflow-hidden">
              <FeedItem active sym="TSXV:SCZ" tone="noteworthy" title="Eagle Lake - 12.4m @ 3.2 g/t Au from 287m" type="Drill result" time="07:31" />
              <FeedItem sym="ASX:DEG" tone="watch" title="Hemi resource upgrade - +18% Indicated" type="JORC update" time="07:42" />
              <FeedItem sym="TSXV:NFG" tone="noteworthy" title="Step-out: 2.1m @ 24 g/t Au at Queensway" type="Drill result" time="07:22" />
              <FeedItem sym="CSE:GR" tone="watch" title="$4.2M placement at $0.18, 0.8x mkt cap" type="Placement" time="07:11" />
              <FeedItem sym="TSXV:NXE" tone="noteworthy" title="NI 43-101 filed - first Indicated category" type="Tech report" time="07:04" />
              <FeedItem sym="ASX:CXO" tone="routine" title="Quarterly activities - Q3 in line with guidance" type="Quarterly" time="06:58" />
              <FeedItem sym="TSXV:LUM" tone="routine" title="AIF re-filing - no material change" type="AIF" time="06:51" />
            </div>
          </div>

          {/* Detail panel */}
          <div className="col-span-12 md:col-span-7 flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between px-7 pt-6 pb-5 border-b border-border">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                  <span>Well in La Salle, TX</span>
                  <span className="opacity-40">·</span>
                  <span>TSXV:SCZ</span>
                  <span className="opacity-40">·</span>
                  <span>Filed 07:31 EST</span>
                </div>
                <h3 className="font-display text-5xl font-extrabold leading-[0.9]">
                  Eagle Lake<br />
                  <span className="text-foreground/40">23-001</span>
                </h3>
              </div>
              <div className="flex flex-col items-end gap-1.5 text-[10px] font-mono">
                <Tag dot="bg-noteworthy">Noteworthy</Tag>
                <Tag dot="bg-primary">High-grade</Tag>
                <Tag dot="bg-emerald-500">Open at depth</Tag>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-px bg-border">
              <Stat label="Grade" value="3.2" unit="g/t Au" />
              <Stat label="Width" value="12.4" unit="m true" />
              <Stat label="Depth" value="287" unit="m" />
              <Stat label="Vs avg" value="2.4×" unit="deposit" />
            </div>

            {/* Translation panel */}
            <div className="grid md:grid-cols-5 flex-1">
              <div className="md:col-span-3 p-7 space-y-5 border-r border-border">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Plain-English translation</div>
                <p className="font-display text-xl leading-snug font-medium">
                  Santa Cruz Mining hit a high-grade gold intercept at <span className="bg-highlight px-1">2.4× the deposit's average grade</span>, in a previously untested zone - and the hole ended in mineralization, meaning the system may extend deeper.
                </p>
                <div className="space-y-3 text-sm text-foreground/80">
                  <KeyFact i="01" t="Grade vs deposit avg" v="3.2 g/t Au is well above the 1.3 g/t historic mine average for this district." />
                  <KeyFact i="02" t="True width is meaningful" v="12.4m true width at this orientation indicates a structurally robust zone, not a thin vein." />
                  <KeyFact i="03" t="Open at depth" v="Final assay was the highest of the hole - the deposit is not closed off vertically." />
                </div>
              </div>

              {/* Right column: action + watch */}
              <div className="md:col-span-2 p-7 bg-primary text-primary-foreground relative overflow-hidden flex flex-col">
                <div className="absolute inset-0 topo opacity-15 pointer-events-none" />
                <div className="relative">
                  <div className="text-[10px] font-mono uppercase tracking-widest opacity-80 mb-2">What to watch</div>
                  <h4 className="font-display text-2xl font-bold leading-tight mb-4">
                    Step-out drilling<br />and Hole 24
                  </h4>
                  <p className="text-xs leading-relaxed opacity-90 mb-6">
                    Company guided 6,000m follow-up by Q3. Watch for a deeper step-out below 320m and any extension to the east.
                  </p>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between border-b border-primary-foreground/20 pb-2"><span className="opacity-70">Cash runway</span><span>14 mo</span></div>
                    <div className="flex justify-between border-b border-primary-foreground/20 pb-2"><span className="opacity-70">Float</span><span>184M</span></div>
                    <div className="flex justify-between border-b border-primary-foreground/20 pb-2"><span className="opacity-70">52w high</span><span>$0.84</span></div>
                  </div>
                </div>
                <button className="mt-6 inline-flex items-center justify-between gap-2 bg-foreground text-background px-4 py-3 text-sm font-medium relative">
                  Add to watchlist <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-7 py-3 border-t border-border text-[11px] font-mono text-muted-foreground">
              <span>Source: SEDAR+ · NR-2026-04-24-01 · 38 pages</span>
              <span className="flex items-center gap-3">
                <ExternalLink className="w-3.5 h-3.5" /> View original PDF <X className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Caption */}
      <div className="grid md:grid-cols-2 gap-10 mt-10 max-w-5xl">
        <p className="text-foreground/70">
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground block mb-2">/// Stop searching. Start seeing.</span>
          Every translation links back to the source PDF, paragraph and page number. Verdicts are auditable, not vibes.
        </p>
        <p className="text-foreground/70">
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground block mb-2">/// ROI in real time.</span>
          Every Noteworthy verdict is tracked at +7, +30, +60 and +90 days on a public scoreboard. Our calls live or die in public.
        </p>
      </div>
    </div>
  </section>
);

const Pill = ({ children, active }: { children: React.ReactNode; active?: boolean }) => (
  <span className={`px-2 py-1 uppercase tracking-wider ${active ? "bg-foreground text-background" : "bg-background text-foreground/70"}`}>{children}</span>
);

const FeedItem = ({ sym, tone, title, type, time, active }: { sym: string; tone: "noteworthy" | "watch" | "routine"; title: string; type: string; time: string; active?: boolean }) => {
  const dot = { noteworthy: "bg-noteworthy", watch: "bg-watch", routine: "bg-routine" }[tone];
  return (
    <div className={`flex gap-3 px-5 py-3.5 cursor-pointer ${active ? "bg-background" : "hover:bg-background/60"}`}>
      <div className={`w-1 ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-1">
          <span>{sym} · {type}</span>
          <span>{time}</span>
        </div>
        <div className="text-sm font-medium leading-snug truncate">{title}</div>
      </div>
    </div>
  );
};

const Tag = ({ children, dot }: { children: React.ReactNode; dot: string }) => (
  <span className="inline-flex items-center gap-1.5 bg-background px-2 py-1 uppercase tracking-wider">
    <span className={`w-1.5 h-1.5 ${dot}`} />{children}
  </span>
);

const Stat = ({ label, value, unit }: { label: string; value: string; unit: string }) => (
  <div className="bg-surface px-5 py-4">
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
    <div className="flex items-baseline gap-1.5">
      <span className="font-display text-3xl font-bold leading-none">{value}</span>
      <span className="text-[10px] font-mono text-muted-foreground">{unit}</span>
    </div>
  </div>
);

const KeyFact = ({ i, t, v }: { i: string; t: string; v: string }) => (
  <div className="flex gap-4 border-t border-border pt-3">
    <span className="font-mono text-xs text-muted-foreground">{i}</span>
    <div className="flex-1">
      <div className="text-xs font-medium uppercase tracking-wider mb-1">{t}</div>
      <div className="text-sm text-foreground/70 leading-relaxed">{v}</div>
    </div>
  </div>
);

export default Dashboard;
