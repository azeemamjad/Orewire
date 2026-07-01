import { FileText, Sparkles, BellRing } from "lucide-react";

const steps = [
  {
    icon: FileText,
    label: "Filed",
    body: "Every day, 2,000+ mining and resource companies file news and regulatory documents across the TSX, TSX-V, CSE, and ASX.",
  },
  {
    icon: Sparkles,
    label: "Summarized and decoded",
    body: "Within minutes of publication, every release and filing is decoded into a plain-English summary with a significance verdict.",
  },
  {
    icon: BellRing,
    label: "Delivered to your inbox",
    body: "Follow any company and get the summary the moment they file or release news. No 200-page PDFs required.",
  },
];

const HowItWorks = () => (
  <section id="how" className="border-b border-border bg-secondary">
    <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16 lg:py-20">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">/// How it works</div>
      <h2 className="font-display text-3xl lg:text-5xl font-extrabold mb-4 leading-[1.05] tracking-tight">
        From filing straight to your inbox.
      </h2>
      <p className="text-foreground/70 text-base lg:text-lg max-w-2xl mb-10 leading-relaxed">
        Follow the companies you care about. The moment they file or release news, you get a
        plain-English summary with a significance verdict.
      </p>
      <div className="grid md:grid-cols-3 gap-px bg-border border border-border">
        {steps.map((s, i) => (
          <div key={s.label} className="bg-surface p-7 flex flex-col">
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
