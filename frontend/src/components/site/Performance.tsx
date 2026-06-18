import { ArrowUpRight, TrendingUp } from "lucide-react";

const rows = [
  { d: "Apr 12", sym: "TSXV:NFG", filing: "Step-out drill 2.1m @ 24 g/t Au", d7: "+18.4%", d30: "+34.2%", d60: "+41.8%", d90: "+52.6%" },
  { d: "Apr 08", sym: "ASX:DEG", filing: "Hemi resource upgrade +18%", d7: "+9.1%", d30: "+14.6%", d60: "+22.3%", d90: "+28.4%" },
  { d: "Mar 28", sym: "TSXV:NXE", filing: "First Indicated category resource", d7: "+12.8%", d30: "+24.7%", d60: "+38.2%", d90: "+44.1%" },
  { d: "Mar 22", sym: "TSXV:AUR", filing: "PEA - $1.2B NPV @ 8% disc.", d7: "+8.4%", d30: "+19.2%", d60: "+27.8%", d90: "+35.1%" },
  { d: "Mar 14", sym: "ASX:CMM", filing: "Karlawinda extension 6.3m @ 11.4 g/t", d7: "+6.7%", d30: "+11.4%", d60: "+18.2%", d90: "+24.8%" },
];

const Performance = () => (
  <section id="performance" className="border-b border-border/70 bg-background">
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-20 lg:py-24">
      <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">/// Performance tracker</div>
          <h2 className="font-display text-4xl lg:text-5xl font-bold leading-[0.95] max-w-3xl">
            Every Noteworthy flag.<br />Tracked in public.
          </h2>
        </div>
        <div className="font-mono text-xs text-muted-foreground max-w-sm">
          Stock price after each Noteworthy verdict - measured at 7, 30, 60 and 90 days. Free users see the latest 10. Paid see the full history.
        </div>
      </div>

      <div className="bg-surface border border-border overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-border bg-secondary text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <div className="col-span-2">Date flagged</div>
          <div className="col-span-2">Ticker</div>
          <div className="col-span-4">Filing</div>
          <div className="col-span-1 text-right">+7d</div>
          <div className="col-span-1 text-right">+30d</div>
          <div className="col-span-1 text-right">+60d</div>
          <div className="col-span-1 text-right">+90d</div>
        </div>
        {rows.map((r) => (
          <div key={r.sym + r.d} className="grid grid-cols-12 gap-2 px-4 py-3.5 border-b border-border last:border-b-0 items-center hover:bg-secondary/50">
            <div className="col-span-2 font-mono text-[11px] text-muted-foreground">{r.d}</div>
            <div className="col-span-2 font-mono text-xs font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-noteworthy" />{r.sym}
            </div>
            <div className="col-span-4 text-sm">{r.filing}</div>
            <div className="col-span-1 text-right font-mono text-xs text-[hsl(var(--up))] font-semibold">{r.d7}</div>
            <div className="col-span-1 text-right font-mono text-xs text-[hsl(var(--up))] font-semibold">{r.d30}</div>
            <div className="col-span-1 text-right font-mono text-xs text-[hsl(var(--up))] font-semibold">{r.d60}</div>
            <div className="col-span-1 text-right font-mono text-xs text-[hsl(var(--up))] font-semibold">{r.d90}</div>
          </div>
        ))}
        <div className="px-4 py-3 bg-secondary text-[11px] font-mono text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-2"><TrendingUp className="w-3 h-3" /> Median +30d return on Noteworthy: <span className="text-foreground font-bold">+18.4%</span></span>
          <a href="#cta" className="text-foreground hover:text-accent inline-flex items-center gap-1">View full history <ArrowUpRight className="w-3 h-3" /></a>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground max-w-2xl">
        Past performance shown for transparency only. This platform provides information for educational purposes - nothing here constitutes investment advice.
      </p>
    </div>
  </section>
);

export default Performance;
