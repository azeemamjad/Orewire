import { Search, Sparkles } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

const INPUT_CLASS =
  "flex w-full border px-3 py-2 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm pl-10 pr-32 h-12 text-base bg-card rounded-none border-foreground/20 focus-visible:ring-accent";

const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 px-4 py-2 absolute right-1 top-1 h-10 rounded-none bg-accent text-accent-foreground hover:bg-accent/90";

type HeroSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  "aria-expanded"?: boolean;
  "aria-autocomplete"?: "list" | "none";
};

const HeroSearchField = ({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  onFocus,
  placeholder = 'Search ticker, company, or ask: "gold companies in Africa"',
  "aria-expanded": ariaExpanded,
  "aria-autocomplete": ariaAutocomplete,
}: HeroSearchFieldProps) => (
  <form onSubmit={onSubmit} className="relative">
    <div className="relative">
      <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="Search ticker or company"
        aria-expanded={ariaExpanded}
        aria-autocomplete={ariaAutocomplete}
        className={INPUT_CLASS}
      />
      <button type="submit" className={BUTTON_CLASS}>
        <Search className="w-4 h-4 mr-1.5" />
        Search
      </button>
    </div>
  </form>
);

export default HeroSearchField;
