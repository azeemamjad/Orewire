const rows = [
  { id: "001", region: "Canada", venue: "TSX-V", filings: "NI 43-101, drill results, MD&A, placements, AIF, material change", count: "1,612", status: "Live" },
  { id: "002", region: "Canada", venue: "CSE", filings: "Drill results, financings, technical disclosures", count: "428", status: "Live" },
  { id: "003", region: "Australia", venue: "ASX", filings: "JORC, exploration results, Appendix 3B, quarterly activities", count: "377", status: "Phase 2" },
  { id: "004", region: "Global", venue: "CRIRSCO standards", filings: "NI 43-101 + JORC translated under one taxonomy", count: "—", status: "Built-in" },
];

const Coverage = () => (
  <section id="coverage" className="border-b border-border/70 bg-surface">
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
      <div className="grid lg:grid-cols-12 gap-10 mb-16">
        <h2 className="lg:col-span-7 font-display text-5xl lg:text-7xl font-extrabold leading-[0.92]">
          Desktop &<br />Mobile<br />
          <span className="text-foreground/40">Transformation.</span>
        </h2>
        <div className="lg:col-span-4 lg:col-start-9 self-end">
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Key modules <span className="inline-block w-2 h-2 bg-foreground align-middle ml-1" /></div>
          <p className="text-sm text-foreground/70 leading-relaxed">
            One taxonomy. Two jurisdictions. Built on the same global CRIRSCO framework so a JORC report and an NI 43-101 report sit side-by-side in the same feed.
          </p>
        </div>
      </div>

      <div className="border-t border-border/70">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-12 gap-4 py-6 border-b border-border/70 items-baseline group hover:bg-background/40 transition-colors px-2">
            <div className="col-span-1 font-mono text-xs text-muted-foreground">{r.id}</div>
            <div className="col-span-3 font-display text-xl lg:text-2xl font-bold">{r.venue}</div>
            <div className="col-span-1 hidden md:block text-xs font-mono text-muted-foreground">{r.region}</div>
            <div className="col-span-12 md:col-span-5 text-sm text-foreground/70">{r.filings}</div>
            <div className="col-span-6 md:col-span-1 font-mono text-sm text-foreground">{r.count}</div>
            <div className="col-span-6 md:col-span-1 text-right">
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 ${r.status === "Live" ? "bg-noteworthy text-noteworthy-foreground" : r.status === "Phase 2" ? "bg-watch text-watch-foreground" : "bg-foreground text-background"}`}>{r.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filing types modules */}
      <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-px bg-border mt-16">
        {["Geospatial map", "Drill results", "NI 43-101", "JORC reports", "Placements", "Quarterlies", "MD&A", "AIFs", "Material change", "Resource upgrades", "Smart alerts", "Watchlists"].map((m) => (
          <div key={m} className="bg-surface px-4 py-5 text-sm font-medium hover:bg-foreground hover:text-background transition-colors">
            {m}
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Coverage;
