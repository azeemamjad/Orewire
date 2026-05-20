import { FileText, Sparkles, Send } from "lucide-react";

const steps = [
  { icon: FileText, label: "Filed", body: "2,000+ mining companies file on SEDAR and ASX daily." },
  { icon: Sparkles, label: "Translated", body: "AI reads every filing and produces a plain-English summary with a significance verdict." },
  { icon: Send, label: "Delivered", body: "Get the intelligence via our feed, daily newsletter, or instant watchlist alerts." },
];

const HowItWorks = () => (
  <section id="how" className="border-b border-border bg-secondary">
    <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16 lg:py-20">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">/// How it works</div>
      <h2 className="font-display text-3xl lg:text-4xl font-extrabold mb-10">From filing to inbox.</h2>
      <div className="grid md:grid-cols-3 gap-px bg-border border border-border">
        {steps.map((s, i) => (
          <div key={s.label} className="bg-surface p-7">
            <div className="flex items-center gap-3 mb-4">
              <span className="font-mono text-[11px] text-muted-foreground">0{i + 1}</span>
              <s.icon className="w-5 h-5 text-accent" strokeWidth={1.75} />
            </div>
            <h3 className="font-display text-xl font-bold mb-2">{s.label}</h3>
            <p className="text-sm text-foreground/70 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorks;
