import { useQuery } from "@tanstack/react-query";
import { Clock, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchFilings, type Filing } from "@/lib/api";

const REFETCH_MS = 30 * 60 * 1000;

const verdictStyle: Record<string, string> = {
  Noteworthy: "rounded-full bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "rounded-full bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "rounded-full bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

const placeholderFilings: Filing[] = [
  { id: -1, ticker: "SCZ", company: "Scorpio Gold Resources", exchange: "TSX-V", filingType: "Technical Report", verdict: "Noteworthy", commodity: "Gold", time: "22 min ago", summary: "Updated MRE: 1.42 Moz Indicated @ 1.8 g/t Au — 31% category upgrade vs prior." },
  { id: -2, ticker: "DEG", company: "De Grey Mining", exchange: "ASX", filingType: "JORC Update", verdict: "Noteworthy", commodity: "Gold", time: "1 hr ago", summary: "Hemi JORC 2012 update: 11.7 Moz total; Indicated now 6.8 Moz." },
  { id: -3, ticker: "NFG", company: "New Found Gold", exchange: "TSX-V", filingType: "Drill Result", verdict: "Noteworthy", commodity: "Gold", time: "2 hrs ago", summary: "AFZ-988 high-grade step-out triggers 25,000m follow-up program." },
  { id: -4, ticker: "GR", company: "Great Atlantic Resources", exchange: "CSE", filingType: "Private Placement", verdict: "Watch", commodity: null, time: "3 hrs ago", summary: "Subscription agreement: C$4.2M flow-through @ $0.18, half-warrant @ $0.28." },
  { id: -5, ticker: "CXO", company: "Core Lithium", exchange: "ASX", filingType: "Quarterly", verdict: "Routine", commodity: "Lithium", time: "4 hrs ago", summary: "Cash flow report: A$87M cash; quarterly opex A$22M; 4 quarters runway." },
  { id: -6, ticker: "RMS", company: "Ramelius Resources", exchange: "ASX", filingType: "Quarterly", verdict: "Routine", commodity: "Gold", time: "5 hrs ago", summary: "AISC A$1,820/oz; FY guidance reaffirmed at 280-310 koz." },
  { id: -7, ticker: "NXE", company: "NexGen Energy", exchange: "TSX-V", filingType: "AIF", verdict: "Routine", commodity: "Uranium", time: "6 hrs ago", summary: "FY25 AIF filed; no material changes to risk factors or property disclosures." },
  { id: -8, ticker: "FIL", company: "Filo Mining", exchange: "TSX-V", filingType: "Early Warning", verdict: "Watch", commodity: "Copper", time: "7 hrs ago", summary: "BHP increases stake to 11.2% via market purchases — first crossing of 10%." },
];

const Filings = () => {
  const { data } = useQuery({
    queryKey: ["filings-feed"],
    queryFn: () => fetchFilings({ limit: 12 }),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
  });

  const items = data && data.length > 0 ? data : placeholderFilings;

  return (
    <div className="border border-border bg-surface flex flex-col min-h-0">
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
        {items.slice(0, 12).map((f) => (
          <li key={f.id} className="hover:bg-background/60">
            <Link to={`/filings/${f.id}`} className="block px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-[13px] font-bold">{f.ticker}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1 py-0.5">
                  {f.exchange}
                </span>
                <span className="text-[11.5px] font-medium truncate max-w-[40%]">{f.company}</span>
                {f.verdict && (
                  <span className={`font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold ${verdictStyle[f.verdict]}`}>
                    {f.verdict}
                  </span>
                )}
                <span className="ml-auto font-mono text-[9px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {f.time}
                </span>
              </div>
              <p className="text-[12.5px] leading-snug text-foreground/85 line-clamp-2">{f.summary}</p>
            </Link>
          </li>
        ))}
        <li>
          <Link
            to="/filings"
            className="block px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors text-center"
          >
            See more filings →
          </Link>
        </li>
      </ul>
    </div>
  );
};

export default Filings;
