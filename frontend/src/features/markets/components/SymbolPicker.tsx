import type { InstrumentSymbol } from '@/features/markets/instrument-symbols';

type SymbolPickerProps = {
  symbols: InstrumentSymbol[];
  selectedTvSymbol: string | null;
  onSelect: (tvSymbol: string) => void;
  className?: string;
};

/** Pill row for switching chart / quote symbol on detail pages. */
export default function SymbolPicker({
  symbols,
  selectedTvSymbol,
  onSelect,
  className = '',
}: SymbolPickerProps) {
  if (symbols.length <= 1) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {symbols.map((s) => {
        const active = s.tv_symbol === selectedTvSymbol;
        const label = s.label || s.tv_symbol;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.tv_symbol)}
            className={`font-mono text-[10px] px-2 py-0.5 rounded border transition-colors ${
              active
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/40'
            }`}
            title={s.tv_symbol}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
