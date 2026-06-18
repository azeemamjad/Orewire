import { Clock, Building2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import HeroSearchField from "@/components/site/HeroSearchField";
import { type Company } from "@/lib/api";
import { type NavSearchHit } from "@/lib/nav-search";
import { useSearchSuggestions } from "@/lib/use-search-suggestions";

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

type ListingSearchProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** When user picks a company suggestion, set company filter id */
  onCompanySelect?: (companyId: number, label: string) => void;
};

const ListingSearch = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search ticker, company, or ask: "gold companies in Africa"',
  onCompanySelect,
}: ListingSearchProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const { debounced, sections, hasSuggestions, isSearching } = useSearchSuggestions(value);
  const companyHits = sections.companies || [];

  const flatHits = useMemo(() => companyHits.slice(0, 8), [companyHits]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickCompany = useCallback(
    (hit: NavSearchHit) => {
      if (!hit.company || !onCompanySelect) return;
      onCompanySelect(hit.company.id, companyLabel(hit.company));
      onChange("");
      setOpen(false);
      setActiveIdx(-1);
    },
    [onCompanySelect, onChange],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (activeIdx >= 0 && flatHits[activeIdx]) {
      pickCompany(flatHits[activeIdx]);
      return;
    }
    onSubmit();
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
      return;
    }
    if (e.key === "ArrowDown" && flatHits.length) {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => (i + 1) % flatHits.length);
      return;
    }
    if (e.key === "ArrowUp" && flatHits.length) {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => (i <= 0 ? flatHits.length - 1 : i - 1));
      return;
    }
    if (e.key === "Enter" && activeIdx >= 0 && flatHits[activeIdx]) {
      e.preventDefault();
      pickCompany(flatHits[activeIdx]);
    }
  };

  const showPanel = open && value.trim().length >= 1 && onCompanySelect;

  return (
    <div ref={wrapRef} className="relative mb-4">
      <HeroSearchField
        value={value}
        onChange={(v) => {
          onChange(v);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onSubmit={handleSubmit}
        placeholder={placeholder}
        aria-expanded={showPanel && (hasSuggestions || isSearching)}
        aria-autocomplete={onCompanySelect ? "list" : "none"}
      />

      {showPanel && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 border border-border bg-popover text-popover-foreground shadow-md overflow-hidden max-h-[min(50vh,320px)] overflow-y-auto"
          role="listbox"
        >
          {isSearching && !hasSuggestions && (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">Searching…</p>
          )}
          {!isSearching && !hasSuggestions && (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              No companies found. Press Search to filter by text.
            </p>
          )}
          {flatHits.length > 0 && (
            <div>
              <div className="px-2.5 py-1.5 border-b border-border bg-muted/20 sticky top-0 z-10">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" />
                  Companies
                </span>
              </div>
              {flatHits.map((hit, idx) => {
                const c = hit.company!;
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
                    onClick={() => pickCompany(hit)}
                  >
                    <span className="font-mono text-xs font-semibold">
                      {fmtEx(c.exchange)}:{c.ticker}
                    </span>
                    <span className="text-muted-foreground ml-2 truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="px-3 py-2 border-t border-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Enter to search titles and summaries
          </div>
        </div>
      )}
    </div>
  );
};

export default ListingSearch;
