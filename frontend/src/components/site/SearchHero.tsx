import { Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const SearchHero = () => {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/companies?search=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <section className="border-b border-border bg-background">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-10 lg:py-14">
        <div className="mb-6">
          <div className="flex items-end justify-between flex-wrap gap-3 mb-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-[hsl(var(--up))] animate-pulse-dot" />
                Live · Mining terminal
              </div>
              <h1 className="font-display text-3xl lg:text-4xl font-extrabold leading-tight">
                Search 4,200+ junior miners, commodities &amp; indexes
              </h1>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              TSX-V · CSE · ASX · TSX · Delayed 15m
            </div>
          </div>

          <form onSubmit={handleSearch} className="relative">
            <div className="relative">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Search ticker, company, or ask: "gold companies in Africa"'
                className="flex w-full border px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:text-sm pl-10 pr-32 h-12 text-base bg-card rounded-none border-foreground/20 focus-visible:ring-accent"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 px-4 py-2 absolute right-1 top-1 h-10 rounded-none bg-accent text-accent-foreground hover:bg-accent/90"
              >
                <Search className="w-4 h-4 mr-1.5" />
                Search
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};

export default SearchHero;
