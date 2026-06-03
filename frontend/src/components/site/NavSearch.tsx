import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Clock, Building2, Gem, LineChart, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities, fetchCompanies, fetchCurrencies, fetchIndexes, type Company } from "@/lib/api";
import {
  allSuggestionHrefs,
  buildNavSearchSections,
  CATEGORY_LABELS,
  type NavSearchHit,
  type SearchCategory,
} from "@/lib/nav-search";
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

const NavSearch = () => {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentSearchItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const refreshRecent = useCallback(() => setRecent(getRecentSearches()), []);

  useEffect(() => {
    refreshRecent();
    const onChange = () => refreshRecent();
    window.addEventListener("orewire-recent-searches-change", onChange);
    return () => window.removeEventListener("orewire-recent-searches-change", onChange);
  }, [refreshRecent]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const { data: companyData, isFetching: companiesLoading } = useQuery({
    queryKey: ["nav-search-companies", debounced],
    queryFn: () => fetchCompanies({ search: debounced, limit: 20, page: 1 }),
    enabled: debounced.length >= 1,
    staleTime: 30_000,
  });

  const { data: commoditiesData } = useQuery({
    queryKey: ["market-commodities"],
    queryFn: fetchCommodities,
    staleTime: 5 * 60_000,
  });

  const { data: indexesData } = useQuery({
    queryKey: ["market-indexes"],
    queryFn: fetchIndexes,
    staleTime: 5 * 60_000,
  });

  const { data: currenciesData } = useQuery({
    queryKey: ["market-currencies"],
    queryFn: fetchCurrencies,
    staleTime: 5 * 60_000,
  });

  const { order, sections } = useMemo(() => {
    if (debounced.length < 1) {
      return {
        order: [] as SearchCategory[],
        sections: { companies: [], commodities: [], indexes: [], currencies: [] },
      };
    }
    return buildNavSearchSections(
      debounced,
      companyData?.data ?? [],
      commoditiesData?.items ?? [],
      indexesData?.items ?? [],
      currenciesData?.items ?? [],
    );
  }, [debounced, companyData?.data, commoditiesData?.items, indexesData?.items, currenciesData?.items]);

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

  const hasSuggestions = order.length > 0;
  const isSearching = debounced.length >= 1 && companiesLoading;

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

  const showPanel = open && (debounced.length >= 1 || recent.length > 0);

  return (
    <div ref={wrapRef} className="flex-1 flex justify-center min-w-0 px-2">
      <form
        className="relative hidden md:block w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (activeIdx >= 0 && flatItems[activeIdx]?.hit) goHit(flatItems[activeIdx].hit!);
          else if (activeIdx >= 0 && flatItems[activeIdx]?.recent) goRecent(flatItems[activeIdx].recent!);
          else goSearch(query);
        }}
      >
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search ticker or company…"
          autoComplete="off"
          aria-label="Search ticker or company"
          aria-expanded={showPanel}
          aria-autocomplete="list"
          className="w-full h-9 pl-8 pr-3 text-sm bg-muted/40 border border-border focus:bg-background focus:border-foreground/30 outline-none transition-colors"
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
      </form>
    </div>
  );
};

export default NavSearch;
