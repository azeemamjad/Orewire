import { ArrowRight } from "lucide-react";

const CTA = () => (
  <section id="cta" className="bg-foreground text-background relative overflow-hidden">
    <div className="absolute inset-0 topo opacity-10 pointer-events-none" />
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-24 lg:py-36 relative">
      <div className="grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-8">
          <div className="text-xs font-mono uppercase tracking-widest text-background/60 mb-6">/// Start reading</div>
          <h2 className="font-display text-5xl lg:text-8xl font-extrabold leading-[0.9] text-balance">
            Tomorrow's<br />
            digest is being<br />
            <span className="text-primary">written right now.</span>
          </h2>
          <p className="mt-8 text-lg text-background/70 max-w-xl">
            Drop your email. We'll send you the next morning's digest free, no card. If it's not the most useful thing in your inbox, unsubscribe in one click.
          </p>

          <form className="mt-10 flex flex-col sm:flex-row gap-3 max-w-xl" onSubmit={(e) => e.preventDefault()}>
            <input
              type="email"
              required
              placeholder="you@portfolio.com"
              className="flex-1 bg-transparent border border-background/30 px-5 py-4 text-background placeholder:text-background/40 focus:outline-none focus:border-primary"
            />
            <button className="group inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-4 font-medium hover:bg-background hover:text-foreground transition-colors">
              Get tomorrow's digest <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </form>

          <div className="mt-6 text-xs font-mono text-background/50">
            No card · 14-day full access · Cancel any time
          </div>
        </div>

        <div className="lg:col-span-4 lg:border-l lg:border-background/20 lg:pl-10 flex flex-col justify-end">
          <div className="space-y-6">
            {[
              { k: "47 min", v: "Average filing → alert" },
              { k: "2,417", v: "Juniors monitored" },
              { k: "14,238", v: "Filings translated to date" },
              { k: "+38%", v: "Median 90-day move on Noteworthy calls" },
            ].map((s) => (
              <div key={s.k} className="border-t border-background/20 pt-3">
                <div className="font-display text-3xl font-bold">{s.k}</div>
                <div className="text-xs font-mono text-background/60 mt-1 uppercase tracking-wider">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default CTA;
