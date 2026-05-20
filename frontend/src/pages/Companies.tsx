import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchCompanies, fetchCompanyExchanges, type Exchange } from "@/lib/api";

const exchanges: ("All" | Exchange)[] = ["All", "TSX", "TSX-V", "CSE", "ASX"];

const exchangeBadge: Record<string, string> = {
  TSX: "bg-blue-50 text-blue-700 border-blue-200",
  "TSX-V": "bg-emerald-50 text-emerald-700 border-emerald-200",
  CSE: "bg-amber-50 text-amber-700 border-amber-200",
  ASX: "bg-purple-50 text-purple-700 border-purple-200",
};

const Companies = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [exchange, setExchange] = useState<"All" | Exchange>("All");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { data: exList } = useQuery({
    queryKey: ["exchanges"],
    queryFn: fetchCompanyExchanges,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["companies", page, debouncedSearch, exchange],
    queryFn: () =>
      fetchCompanies({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        exchange: exchange !== "All" ? exchange : undefined,
      }),
  });

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    // simple debounce
    const timer = setTimeout(() => setDebouncedSearch(val), 300);
    return () => clearTimeout(timer);
  };

  const handleExchangeChange = (val: "All" | Exchange) => {
    setExchange(val);
    setPage(1);
  };

  const companies = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-10">
        {/* Breadcrumb */}
        <div className="text-sm text-muted-foreground mb-6">
          <span className="cursor-pointer hover:text-foreground" onClick={() => navigate("/")}>Home</span>
          <span className="mx-2">/</span>
          <span className="font-medium text-foreground">Companies</span>
        </div>

        <h1 className="font-display text-3xl lg:text-4xl font-extrabold mb-8">
          Mining Companies
        </h1>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          {/* Exchange radio buttons */}
          <div className="flex flex-wrap gap-2">
            {exchanges.map((ex) => (
              <button
                key={ex}
                onClick={() => handleExchangeChange(ex)}
                className={`px-4 py-2 text-sm font-medium rounded-full border transition-all ${
                  exchange === ex
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-surface text-foreground border-border hover:border-accent"
                }`}
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-md ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search company name or ticker..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 h-10 bg-surface border border-border rounded-lg text-sm outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="text-sm text-muted-foreground mb-4">
          {pagination ? (
            <span>
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} companies
            </span>
          ) : (
            <span>Loading...</span>
          )}
        </div>

        {/* Company Grid */}
        {isLoading ? (
          <div className="py-20 text-center text-muted-foreground">Loading companies...</div>
        ) : companies.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            No companies found. Try adjusting filters.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {companies.map((company) => (
              <div
                key={company.id}
                onClick={() => navigate(`/company/${company.id}`)}
                className="group bg-surface border border-border rounded-lg p-5 cursor-pointer hover:border-accent hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-lg">{company.ticker || "—"}</span>
                      {company.exchange && (
                        <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${exchangeBadge[company.exchange] || "border-border text-muted-foreground"}`}>
                          {company.exchange}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-medium text-foreground/80 line-clamp-1">
                      {company.name}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {company.sector && <span>{company.sector}</span>}
                  {company.market_cap && (
                    <span className="font-mono">
                      MC: ${(company.market_cap / 1e6).toFixed(1)}M
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 mt-3 text-xs text-accent group-hover:underline">
                  View profile <ArrowUpRight className="w-3 h-3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!pagination.hasPrev}
              className="p-2 rounded border border-border disabled:opacity-30 hover:border-accent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-mono px-3">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasNext}
              className="p-2 rounded border border-border disabled:opacity-30 hover:border-accent transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Companies;