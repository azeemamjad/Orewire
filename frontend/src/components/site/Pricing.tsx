const tiers = [
  {
    name: "Free",
    price: "0",
    cadence: "/ month",
    tagline: "For the curious.",
    features: [
      "Live news feed",
      "Latest 5 filing translations",
      "Basic company data + TradingView charts",
      "Weekly recap newsletter",
    ],
    cta: "Create account",
    featured: false,
  },
  {
    name: "Starter",
    price: "30",
    cadence: "/ month",
    tagline: "For the attentive retail investor.",
    features: [
      "Full filing archive",
      "Daily morning newsletter (full)",
      "Watchlist up to 15 companies",
      "Email alerts within 60 minutes",
    ],
    cta: "Start 7-day trial",
    featured: false,
  },
  {
    name: "Premium",
    price: "75",
    cadence: "/ month",
    tagline: "For active traders.",
    features: [
      "Everything in Starter",
      "Unlimited watchlist + SMS alerts",
      "Filing search + CSV export",
      "Full insider data + performance tracker",
    ],
    cta: "Start 7-day trial",
    featured: true,
  },
  {
    name: "Operator",
    price: "300+",
    cadence: "/ month",
    tagline: "For Discord & Telegram communities.",
    features: [
      "Everything in Premium",
      "Discord / Telegram bot",
      "White-label channel posting",
      "Per-commodity routing & priority support",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

const Pricing = () => (
  <section id="pricing" className="border-b border-border/70 bg-secondary">
    <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-20 lg:py-28">
      <div className="flex items-end justify-between flex-wrap gap-6 mb-12">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">/// Pricing</div>
          <h2 className="font-display text-4xl lg:text-6xl font-bold leading-[0.95] max-w-3xl">
            Cheaper than<br />one bad trade.
          </h2>
        </div>
        <div className="font-mono text-xs text-muted-foreground max-w-xs">
          7-day Starter trial, no credit card. Cancel any time. Annual billing saves 20%.
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-px bg-border">
        {tiers.map((t) => (
          <div key={t.name} className={`p-7 flex flex-col ${t.featured ? "bg-primary text-primary-foreground" : "bg-surface"}`}>
            <div className="flex items-center justify-between mb-6">
              <span className={`font-mono text-[11px] uppercase tracking-widest ${t.featured ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{t.name}</span>
              {t.featured && <span className="px-2 py-0.5 bg-accent text-accent-foreground text-[10px] font-mono uppercase tracking-wider">Most popular</span>}
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="font-display text-5xl font-extrabold leading-none">${t.price}</span>
              <span className={`text-sm ${t.featured ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{t.cadence}</span>
            </div>
            <p className={`text-sm mb-7 ${t.featured ? "text-primary-foreground/80" : "text-foreground/70"}`}>{t.tagline}</p>

            <ul className="space-y-2.5 mb-8 flex-1">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-[13px] leading-snug">
                  <span className={`mt-1.5 w-1.5 h-1.5 ${t.featured ? "bg-accent" : "bg-foreground"}`} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <a href="#cta" className={`inline-flex items-center justify-between px-4 py-3 text-sm font-medium ${t.featured ? "bg-accent text-accent-foreground hover:opacity-90" : "bg-foreground text-background hover:bg-accent hover:text-accent-foreground"} transition-colors`}>
              {t.cta} <span>→</span>
            </a>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Pricing;
