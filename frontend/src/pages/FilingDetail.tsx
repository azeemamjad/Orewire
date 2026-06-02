import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Clock, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import Disclaimer from "@/components/site/Disclaimer";
import { companySlug, fetchFiling, filingDocumentUrl, type Verdict } from "@/lib/api";

const verdictStyle: Record<Verdict, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};


const Section = ({ title, body }: { title: string; body: string }) => (
  <div className="border-t border-border pt-4">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
    <p className="text-[15px] leading-relaxed text-foreground/85 whitespace-pre-line">{body}</p>
  </div>
);

const FilingDetail = () => {
  const { id } = useParams();

  const { data: filing, isLoading } = useQuery({
    queryKey: ["filing-detail", id],
    queryFn: () => fetchFiling(id || ""),
    enabled: !!id,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-sm text-muted-foreground">Loading filing detail...</main>
        <Footer />
      </div>
    );
  }

  if (!filing) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="max-w-3xl mx-auto px-4 lg:px-6 py-12">
          <Link to="/#feed" className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to filings
          </Link>
          <div className="border border-border bg-surface p-6 text-sm text-muted-foreground">Filing not found.</div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-3xl mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <Link to="/#feed" className="inline-flex items-center gap-1.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to filings
        </Link>

        <div className="border border-border bg-surface p-5 lg:p-6 mb-6">
          <div className="flex items-center gap-2.5 flex-wrap mb-4">
            <span className="font-mono text-[18px] font-extrabold tracking-tight leading-none">{filing.ticker}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
              {filing.exchange}
            </span>
            {filing.verdict && (
              <span className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictStyle[filing.verdict]}`}>
                {filing.verdict}
              </span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
              {filing.filingType}
            </span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {filing.time}
            </span>
          </div>

          <h1 className="font-display text-2xl lg:text-4xl font-extrabold leading-tight mb-4">{filing.company}</h1>

          <div className="border-t border-border pt-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-accent mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> AI summary
            </div>
            <p className="text-[15px] leading-relaxed text-foreground/85">{filing.summary}</p>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-border">
            {filing.commodity && (
              <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-muted/50 border border-border">{filing.commodity}</span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-muted/50 border border-border">{filing.filingType}</span>
            <Link
              to={`/company/${companySlug(filing.exchange, filing.ticker)}`}
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-muted/50 border border-border hover:border-accent inline-flex items-center gap-1"
            >
              {filing.ticker} company page <ArrowUpRight className="w-2.5 h-2.5" />
            </Link>
          </div>
        </div>

        <article className="space-y-5">
          {filing.verdictReason && <Section title="Why this verdict" body={filing.verdictReason} />}
          {filing.keyFacts && <Section title="Key facts" body={filing.keyFacts} />}
          {filing.resourceEstimate && <Section title="Resource estimate" body={filing.resourceEstimate} />}
          {filing.gradeCommentary && <Section title="Grade commentary" body={filing.gradeCommentary} />}
          {filing.context && <Section title="Context" body={filing.context} />}
          {filing.whatToWatch && <Section title="What to watch" body={filing.whatToWatch} />}
          <div className="border-t border-border pt-4 flex items-center justify-between gap-3 flex-wrap">
            <a
              href={filing.sourceUrl || filingDocumentUrl(filing.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
            >
              Read original document (PDF)
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            {filing.pdfFilename && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{filing.pdfFilename}</span>
            )}
          </div>
          <Disclaimer />
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default FilingDetail;
