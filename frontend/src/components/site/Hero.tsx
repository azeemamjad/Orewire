const Hero = () => (
  <section className="bg-[hsl(220_45%_10%)] text-[hsl(36_30%_94%)]">
    <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-20 lg:py-28 text-center">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[hsl(36_30%_94%/0.6)] mb-8">
        <span className="w-1.5 h-1.5 bg-[hsl(174_62%_42%)] animate-pulse-dot" />
        Live · TSX-V · CSE · ASX
      </div>
      <h1 className="font-display text-[clamp(2.5rem,6vw,5rem)] font-extrabold leading-[1.02] tracking-tight text-balance">
        Junior Mining Intelligence —<br />
        <span className="text-[hsl(38_78%_55%)]">Translated by AI.</span>
      </h1>
      <p className="mt-6 max-w-2xl mx-auto text-lg text-[hsl(36_30%_94%/0.75)] leading-relaxed">
        Every filing from 2,000+ TSX-V, CSE, and ASX mining companies — summarized in plain English before the market opens.
      </p>
      <div className="mt-10 flex flex-col items-center gap-3">
        <a
          href="#cta"
          className="inline-flex items-center bg-accent text-accent-foreground px-8 h-12 text-base font-semibold hover:opacity-90 transition-opacity"
        >
          Start 7-Day Free Trial
        </a>
        <span className="font-mono text-[11px] text-[hsl(36_30%_94%/0.55)]">No credit card required</span>
      </div>
    </div>
  </section>
);

export default Hero;
