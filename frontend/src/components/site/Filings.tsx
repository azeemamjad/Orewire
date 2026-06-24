import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchFilings, type Filing } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000;

const verdictStyle: Record<string, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

const placeholderFilings: Filing[] = [
  { id: -1, ticker: "SCZ", company: "Scorpio Gold Resources", exchange: "TSX-V", filingType: "NI 43-101", verdict: "Noteworthy", commodity: "Gold", time: "22 min ago", summary: "Updated MRE: 1.42 Moz Indicated @ 1.8 g/t Au, 31% category upgrade vs prior." },
  { id: -2, ticker: "DEG", company: "De Grey Mining", exchange: "ASX", filingType: "JORC Resource", verdict: "Noteworthy", commodity: "Gold", time: "1 hr ago", summary: "Hemi JORC 2012 update: 11.7 Moz total; Indicated now 6.8 Moz." },
  { id: -3, ticker: "NFG", company: "New Found Gold", exchange: "TSX-V", filingType: "Material Change", verdict: "Noteworthy", commodity: "Gold", time: "2 hrs ago", summary: "AFZ-988 high-grade step-out triggers 25,000m follow-up program." },
  { id: -4, ticker: "GR", company: "Great Atlantic Resources", exchange: "CSE", filingType: "Private Placement", verdict: "Watch", commodity: null, time: "3 hrs ago", summary: "Subscription agreement: C$4.2M flow-through @ $0.18, half-warrant @ $0.28." },
  { id: -5, ticker: "CXO", company: "Core Lithium", exchange: "ASX", filingType: "Appendix 5B", verdict: "Routine", commodity: "Lithium", time: "4 hrs ago", summary: "Cash flow report: A$87M cash; quarterly opex A$22M; 4 quarters runway." },
  { id: -6, ticker: "RMS", company: "Ramelius Resources", exchange: "ASX", filingType: "Quarterly MD&A", verdict: "Routine", commodity: "Gold", time: "5 hrs ago", summary: "AISC A$1,820/oz; FY guidance reaffirmed at 280-310 koz." },
  { id: -7, ticker: "NXE", company: "NexGen Energy", exchange: "TSX-V", filingType: "Annual Information Form", verdict: "Routine", commodity: "Uranium", time: "6 hrs ago", summary: "FY25 AIF filed; no material changes to risk factors or property disclosures." },
  { id: -8, ticker: "FIL", company: "Filo Mining", exchange: "TSX-V", filingType: "Early Warning Report", verdict: "Watch", commodity: "Copper", time: "7 hrs ago", summary: "BHP increases stake to 11.2% via market purchases, first crossing of 10%." },
  { id: -9, ticker: "ABX", company: "Barrick Mining", exchange: "TSX", filingType: "Proxy Circular", verdict: "Routine", commodity: "Gold", time: "9 hrs ago", summary: "2026 AGM circular; board slate unchanged, say-on-pay advisory included." },
  { id: -10, ticker: "AGO", company: "Atlas Iron", exchange: "ASX", filingType: "Substantial Holder Notice", verdict: "Watch", commodity: null, time: "11 hrs ago", summary: "Hancock Prospecting lifts holding to 19.9%, just under takeover threshold." },
];

const Filings = () => {
  const { data } = useQuery({
    queryKey: ["filings-feed"],
    queryFn: () => fetchFilings({ limit: 20 }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data && data.length > 0 ? data : placeholderFilings;

  return (
    <div className="border border-border bg-surface flex flex-col min-h-0 lg:h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-accent" />
          <h3 className="font-display text-sm font-bold tracking-tight">Latest filings</h3>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">· Summarized</span>
        </div>
        <Link to="/filings" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
          All →
        </Link>
      </div>
      <ul className="divide-y divide-border flex-1 overflow-auto min-h-0">
        {items.slice(0, 20).map((f) => (
          <li key={f.id} className="hover:bg-background/60">
            <Link to={`/filings/${f.id}`} className="block px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[13px] font-bold whitespace-nowrap">{f.ticker}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5 whitespace-nowrap">
                  {f.exchange}
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <Clock className="w-2.5 h-2.5" />
                  {f.time}
                </span>
              </div>
              <div className="text-[12px] font-semibold text-foreground/90 mb-1.5 leading-snug truncate">
                {f.company}
              </div>
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                {f.verdict && (
                  <span
                    className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold rounded-full whitespace-nowrap ${verdictStyle[f.verdict] || verdictStyle.Routine}`}
                  >
                    {f.verdict}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[12.5px] font-bold tracking-tight text-foreground leading-snug">
                  <FileText className="w-3 h-3 text-accent shrink-0" />
                  {f.filingType}
                </span>
              </div>
              <p className="text-[12px] leading-relaxed text-foreground/70 line-clamp-2">{f.summary}</p>
            </Link>
          </li>
        ))}
        <li className="p-3 bg-muted/20">
          <Link
            to="/filings"
            className="flex items-center justify-center gap-1.5 w-full h-9 bg-foreground text-background font-mono text-[11px] uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
          >
            View all filings <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </li>
      </ul>
    </div>
  );
};

export default Filings;
