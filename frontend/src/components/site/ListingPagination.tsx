import { ChevronLeft, ChevronRight } from "lucide-react";

interface ListingPaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  isFetching?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
}

function pageWindow(page: number, totalPages: number): number[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  return Array.from(pages)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
}

const ListingPagination = ({
  page,
  totalPages,
  total,
  isFetching,
  onPageChange,
  className = "",
}: ListingPaginationProps) => {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-4 border-t border-border bg-muted/20 ${className}`}
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Page <span className="text-foreground font-bold">{page}</span> of{" "}
        <span className="text-foreground font-bold">{totalPages}</span>
        {total != null && (
          <>
            {" "}
            · <span className="text-foreground">{total}</span> results
          </>
        )}
        {isFetching ? " · loading…" : ""}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1 || isFetching}
          className="inline-flex items-center gap-1 h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        {pages.map((p, i) => {
          const prev = pages[i - 1];
          const gap = prev != null && p - prev > 1;
          return (
            <span key={p} className="flex items-center gap-1">
              {gap && <span className="px-1 text-muted-foreground font-mono text-xs">…</span>}
              <button
                type="button"
                onClick={() => onPageChange(p)}
                disabled={isFetching}
                className={`min-w-9 h-9 px-2 border text-sm font-mono tabular-nums transition-colors disabled:opacity-40 ${
                  p === page
                    ? "bg-foreground text-background border-foreground font-bold"
                    : "border-border hover:bg-background"
                }`}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages || isFetching}
          className="inline-flex items-center gap-1 h-9 px-3 border border-border text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-background transition-colors"
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default ListingPagination;
