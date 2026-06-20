import { Clock, Building2, Gem, LineChart, DollarSign } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type Company } from "@/lib/api";
import HeroSearchField from "@/components/site/HeroSearchField";
import {
  allSuggestionHrefs,
  CATEGORY_LABELS,
  type NavSearchHit,
  type SearchCategory,
} from "@/lib/nav-search";
import { useSearchSuggestions } from "@/lib/use-search-suggestions";
import { addRecentSearch, getRecentSearches, type RecentSearchItem } from "@/lib/recent-searches";

const CATEGORY_ICONS: Record<SearchCategory, typeof Building2> = {
  companies: Building2,
  commodities: Gem,
  indexes: LineChart,
  currencies: DollarSign,
};

function fmtEx(ex: string | null): string {
  if (!ex) return "";
  const u = ex.toUpperCase();
  return u === "TSXV" ? "TSX-V" : ex;
}

function companyLabel(c: Company): string {
  const tk = c.ticker || "";
  const ex = fmtEx(c.exchange);
  return ex && tk ? `${ex}:${tk} · ${c.name}` : c.name;
}

function hitLabel(hit: NavSearchHit): string {
  if (hit.company) return companyLabel(hit.company);
  if (hit.meta && hit.category !== "companies") return `${hit.label} · ${hit.meta}`;
  return hit.label;
}

const SearchHero = () => {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentSearchItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const { debounced, order, sections, hasSuggestions, isSearching } = useSearchSuggestions(query);

  const refreshRecent = useCallback(() => setRecent(getRecentSearches()), []);

  useEffect(() => {
    refreshRecent();
    const onChange = () => refreshRecent();
    window.addEventListener("orewire-recent-searches-change", onChange);
    return () => window.removeEventListener("orewire-recent-searches-change", onChange);
  }, [refreshRecent]);

  const suggestionHrefs = useMemo(() => allSuggestionHrefs(sections), [sections]);

  const recentFiltered = useMemo(
    () => recent.filter((r) => !suggestionHrefs.has(r.href)),
    [recent, suggestionHrefs],
  );

  const flatItems = useMemo(() => {
    const items: { hit?: NavSearchHit; recent?: RecentSearchItem }[] = [];
    for (const cat of order) {
      sections[cat].forEach((hit) => items.push({ hit }));
    }
    recentFiltered.forEach((r) => items.push({ recent: r }));
    return items;
  }, [order, sections, recentFiltered]);

  const categoryOffsets = useMemo(() => {
    const offsets = new Map<SearchCategory, number>();
    let n = 0;
    for (const cat of order) {
      offsets.set(cat, n);
      n += sections[cat].length;
    }
    return { offsets, recentStart: n };
  }, [order, sections]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const goHit = (hit: NavSearchHit) => {
    addRecentSearch({ label: hitLabel(hit), href: hit.href, query: debounced || hit.label });
    refreshRecent();
    setQuery("");
    setOpen(false);
    navigate(hit.href);
  };

  const goSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const href = `/companies?search=${encodeURIComponent(trimmed)}`;
    addRecentSearch({ label: trimmed, href, query: trimmed });
    refreshRecent();
    setQuery("");
    setOpen(false);
    navigate(href);
  };

  const goRecent = (r: RecentSearchItem) => {
    setQuery("");
    setOpen(false);
    navigate(r.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
      return;
    }
    if (e.key === "ArrowDown" && flatItems.length) {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => (i + 1) % flatItems.length);
      return;
    }
    if (e.key === "ArrowUp" && flatItems.length) {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => (i <= 0 ? flatItems.length - 1 : i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIdx];
      if (item?.hit) goHit(item.hit);
      else if (item?.recent) goRecent(item.recent);
      else goSearch(query);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeIdx >= 0 && flatItems[activeIdx]?.hit) goHit(flatItems[activeIdx].hit!);
    else if (activeIdx >= 0 && flatItems[activeIdx]?.recent) goRecent(flatItems[activeIdx].recent!);
    else goSearch(query);
  };

  const showPanel = open && (debounced.length >= 1 || recent.length > 0);

  return (
    <div className="mb-6">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-[hsl(var(--up))] animate-pulse-dot" />
            Live · TSX · TSX-V · CSE · ASX
          </div>
          <h1 className="font-display text-3xl lg:text-4xl font-extrabold leading-tight">
            Mining and resource intelligence,
            <br />
            <span className="text-accent">clearly summarized.</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Stock prices, decoded filings, and news release summaries for 2,000+ mining and resource companies across Canada and Australia.
          </p>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          TSX-V · CSE · ASX · TSX · Delayed 15m
        </div>
      </div>

      <div ref={wrapRef} className="relative">
        <HeroSearchField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onSubmit={handleSearch}
          aria-expanded={showPanel}
          aria-autocomplete="list"
        />

        {showPanel && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-50 border border-border bg-popover text-popover-foreground shadow-md overflow-hidden max-h-[min(70vh,420px)] overflow-y-auto"
            role="listbox"
          >
            {debounced.length >= 1 && (
              <>
                {isSearching && !hasSuggestions && (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground">Searching…</p>
                )}
                {!isSearching && !hasSuggestions && (
                  <p className="px-3 py-2.5 text-xs text-muted-foreground">No results found.</p>
                )}

                {order.map((cat) => {
                  const hits = sections[cat];
                  if (!hits.length) return null;
                  const Icon = CATEGORY_ICONS[cat];
                  const sectionStart = categoryOffsets.offsets.get(cat) ?? 0;

                  return (
                    <div key={cat}>
                      <div className="px-2.5 py-1.5 border-t border-border first:border-t-0 bg-muted/20 sticky top-0 z-10">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Icon className="w-3 h-3" />
                          {CATEGORY_LABELS[cat]}
                        </span>
                      </div>
                      {hits.map((hit, hi) => {
                        const idx = sectionStart + hi;
                        const active = activeIdx === idx;
                        return (
                          <button
                            key={hit.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors ${
                              active ? "bg-muted/60" : ""
                            }`}
                            onMouseEnter={() => setActiveIdx(idx)}
                            onClick={() => goHit(hit)}
                          >
                            {hit.category === "companies" && hit.company ? (
                              <>
                                <span className="font-mono text-xs font-semibold">
                                  {fmtEx(hit.company.exchange)}:{hit.company.ticker}
                                </span>
                                <span className="text-muted-foreground ml-2 truncate">{hit.company.name}</span>
                              </>
                            ) : (
                              <>
                                <span className="font-mono text-xs font-semibold">{hit.meta || hit.label}</span>
                                {hit.meta && hit.meta !== hit.label && (
                                  <span className="text-muted-foreground ml-2 truncate">{hit.label}</span>
                                )}
                                {!hit.meta && (
                                  <span className="text-muted-foreground ml-2 truncate">{hit.label}</span>
                                )}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )}

            {recentFiltered.length > 0 && (
              <div>
                <div className="px-2.5 py-1.5 border-t border-border bg-muted/20 sticky top-0 z-10">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    Recent
                  </span>
                </div>
                {recentFiltered.map((r, ri) => {
                  const idx = categoryOffsets.recentStart + ri;
                  const active = activeIdx === idx;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-muted/60 transition-colors ${
                        active ? "bg-muted/60" : ""
                      }`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => goRecent(r)}
                    >
                      <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="truncate">{r.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {debounced.length === 0 && recent.length === 0 && (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">
                Search companies, commodities, indexes, or currencies.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchHero;
