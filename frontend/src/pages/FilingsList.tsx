import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock, FileText, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import Nav from "@/components/site/Nav";
import Footer from "@/components/site/Footer";
import { fetchFilingsPage, type Filing, type Verdict } from "@/lib/api";

const FILTERS = ["All", "Noteworthy", "Watch", "Routine"] as const;
type FilterValue = (typeof FILTERS)[number];

const PAGE_SIZE = 10;

const verdictStyle: Record<Verdict, string> = {
  Noteworthy: "bg-[hsl(var(--noteworthy))] text-[hsl(var(--noteworthy-foreground))]",
  Watch: "bg-[hsl(var(--watch))] text-[hsl(var(--watch-foreground))]",
  Routine: "bg-[hsl(var(--routine))] text-[hsl(var(--routine-foreground))]",
};

const FilingsList = () => {
  const [filter, setFilter] = useState<FilterValue>("All");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["filings-list", page, filter],
    queryFn: () => fetchFilingsPage({ page, limit: PAGE_SIZE, verdict: filter }),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const items = data?.items || [];
  const totalPages = data?.pagination?.totalPages ?? 1;

  const scrollToTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  const goToPage = (next: number) => {
    const upper = data?.pagination?.totalPages;
    const clamped = upper ? Math.min(Math.max(1, next), upper) : Math.max(1, next);
    if (clamped === page) return;
    setPage(clamped);
    scrollToTop();
  };

  // Keep the page in range when the filter narrows the result set. Guard on real
  // pagination data so a loading state (no data) never resets the page.
  useEffect(() => {
    if (!data?.pagination) return;
    setPage((p) => Math.min(Math.max(1, p), data.pagination.totalPages));
  }, [data?.pagination?.totalPages, filter]);

  const changeFilter = (f: FilterValue) => {
    setFilter(f);
    setPage(1);
    scrollToTop();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="max-w-[1200px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
        <div className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Filing intelligence</div>
          <h1 className="font-display text-3xl lg:text-5xl font-extrabold tracking-tight mb-2">Filings</h1>
          <p className="text-sm text-foreground/70">Every filing from SEDAR+, ASX Announcements and the CSE — summarized with a significance verdict.</p>
        </div>

        <div className="border border-border bg-surface">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" />
              <span className="font-display text-sm font-bold">All filings</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => changeFilter(f)}
                  className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1 rounded-full border transition-colors ${
                    filter === f
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">Loading filings...</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">No filings match this filter.</div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item: Filing) => (
                <li key={item.id} className="hover:bg-background/60">
                  <Link to={`/filings/${item.id}`} className="block px-5 py-4">
                    <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                      <span className="font-mono text-[18px] font-extrabold tracking-tight leading-none">{item.ticker}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5">
                        {item.exchange}
                      </span>
                      <span className="text-[15px] font-semibold leading-none truncate max-w-[45%]">{item.company}</span>
                      {item.verdict && (
                        <span className={`text-[10px] font-mono uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${verdictStyle[item.verdict]}`}>
                          {item.verdict}
                        </span>
                      )}
                      <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-border text-muted-foreground">
                        {item.filingType}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {item.time}
                      </span>
                    </div>
                    <p className="text-[13px] leading-snug text-foreground/85 pl-0.5">
                      <Sparkles className="inline w-3 h-3 text-accent mr-1 -mt-0.5" />
                      {item.summary}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {!isLoading && totalPages > 1 && (
            <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Page {page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 1}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Previous
                </button>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page === totalPages}
                  className="h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default FilingsList;
