import { Search, Filter, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const SEVERITIES = ["Noteworthy", "Watch", "Routine"] as const;
export const EXCHANGES = ["TSX", "TSX-V", "CSE", "ASX"] as const;
export const COMMODITIES = ["Gold", "Silver", "Copper", "Lithium", "Uranium", "Nickel"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Exchange = (typeof EXCHANGES)[number];
export type Commodity = (typeof COMMODITIES)[number];

export interface ListFilters {
  severities: string[];
  exchanges: string[];
  commodities: string[];
}

export const EMPTY_FILTERS: ListFilters = { severities: [], exchanges: [], commodities: [] };

export function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

const Chip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-card text-foreground/80 border-border hover:border-foreground/40"
    }`}
  >
    {children}
  </button>
);

const Group = ({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
}) => (
  <div className="border-t border-border py-4">
    <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">{label}</h4>
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Chip key={i} active={selected.includes(i)} onClick={() => onToggle(i)}>
          {i}
        </Chip>
      ))}
    </div>
  </div>
);

interface Props {
  title: string;
  eyebrow: string;
  description: string;
  totalCount: number;
  resultCount: number;
  query: string;
  setQuery: (v: string) => void;
  filters: ListFilters;
  setFilters: (f: ListFilters) => void;
  showSeverity?: boolean;
  showExchange?: boolean;
  showCommodity?: boolean;
  severityLabel?: string;
  severityItems?: readonly string[];
  placeholder?: string;
  onSearch?: () => void;
}

export function ListFilterHeader({
  title,
  eyebrow,
  description,
  totalCount,
  resultCount,
  query,
  setQuery,
  placeholder,
  onSearch,
}: Pick<Props, "title" | "eyebrow" | "description" | "totalCount" | "resultCount" | "query" | "setQuery" | "placeholder" | "onSearch">) {
  return (
    <section className="border-b border-border bg-card">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 py-8">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{eyebrow}</div>
            <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">{title}</h1>
            <p className="text-muted-foreground mt-2 max-w-4xl">{description}</p>
          </div>
          <div className="text-sm text-muted-foreground font-mono">
            <span className="text-foreground font-bold">{resultCount}</span> of {totalCount}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch?.();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder ?? "Search by company, ticker or keyword"}
              className="pl-10 pr-10 h-12 text-base bg-background rounded-none border-foreground/20 focus-visible:ring-accent"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            className="h-12 px-6 rounded-none bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
          >
            <Search className="w-4 h-4 mr-2" /> Search
          </Button>
        </form>
      </div>
    </section>
  );
}

export function ListFilterSidebar({
  filters,
  setFilters,
  showSeverity = true,
  showExchange = true,
  showCommodity = true,
  severityLabel = "Significance",
  severityItems = SEVERITIES,
}: Pick<Props, "filters" | "setFilters" | "showSeverity" | "showExchange" | "showCommodity" | "severityLabel" | "severityItems">) {
  const activeCount = filters.severities.length + filters.exchanges.length + filters.commodities.length;
  return (
    <aside>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" />
          <h3 className="font-display font-bold text-lg">Filters</h3>
          {activeCount > 0 && (
            <Badge variant="secondary" className="rounded-none text-[10px]">{activeCount}</Badge>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear all
          </button>
        )}
      </div>
      {showSeverity && (
        <Group
          label={severityLabel}
          items={severityItems}
          selected={filters.severities}
          onToggle={(v) => setFilters({ ...filters, severities: toggle(filters.severities, v) })}
        />
      )}
      {showExchange && (
        <Group
          label="Exchange"
          items={EXCHANGES}
          selected={filters.exchanges}
          onToggle={(v) => setFilters({ ...filters, exchanges: toggle(filters.exchanges, v) })}
        />
      )}
      {showCommodity && (
        <Group
          label="Commodity"
          items={COMMODITIES}
          selected={filters.commodities}
          onToggle={(v) => setFilters({ ...filters, commodities: toggle(filters.commodities, v) })}
        />
      )}
    </aside>
  );
}

export function ActiveChips({
  filters,
  setFilters,
}: {
  filters: ListFilters;
  setFilters: (f: ListFilters) => void;
}) {
  const items: { k: keyof ListFilters; v: string }[] = [
    ...filters.severities.map((v) => ({ k: "severities" as const, v })),
    ...filters.exchanges.map((v) => ({ k: "exchanges" as const, v })),
    ...filters.commodities.map((v) => ({ k: "commodities" as const, v })),
  ];
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-border">
      {items.map(({ k, v }) => (
        <button
          key={`${k}-${v}`}
          type="button"
          onClick={() => setFilters({ ...filters, [k]: filters[k].filter((x) => x !== v) })}
          className="inline-flex items-center gap-1.5 bg-foreground text-background px-2.5 py-1 text-xs font-medium"
        >
          {v} <X className="w-3 h-3" />
        </button>
      ))}
    </div>
  );
}
