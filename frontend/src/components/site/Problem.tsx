const Problem = () => (
  <section className="border-b border-border/70 bg-surface">
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-24 lg:py-32 grid lg:grid-cols-12 gap-10">
      <div className="lg:col-span-4">
        <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">/// The problem</div>
        <h2 className="font-display text-4xl lg:text-5xl font-bold leading-[0.95]">
          2,400 juniors.<br />
          50–200 page reports.<br />
          <span className="text-primary">Nobody reads them.</span>
        </h2>
      </div>

      <div className="lg:col-span-7 lg:col-start-6 space-y-6 text-foreground/80 text-lg leading-relaxed max-w-2xl">
        <p>
          Every day, junior mining companies file dense technical documents — drill assays, NI 43-101 reports,
          JORC resource estimates, private placements. These filings are how you find out a company just hit
          high-grade gold at depth, or just diluted shareholders into oblivion.
        </p>
        <p className="text-foreground">
          Understanding <span className="font-mono text-base bg-foreground text-background px-2 py-0.5">3.2 g/t Au over 12.4m</span> requires
          knowing whether that grade is good for that deposit type, whether the width is meaningful, and whether
          it's open at depth.
        </p>
        <p>
          Retail investors can't read them. Brokerage research covers less than 5% of listed juniors. Newsletters
          cover 10–20 names. Twitter is noise. <span className="text-foreground font-medium">That's the gap.</span>
        </p>
      </div>
    </div>
  </section>
);

export default Problem;
