import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchInstrumentSymbols,
  type InstrumentEntityType,
  type InstrumentSymbol,
} from '@/features/markets/instrument-symbols';

export function useInstrumentSymbols(
  entityType: InstrumentEntityType,
  entityKey: string | undefined,
  options?: { initial?: InstrumentSymbol[]; enabled?: boolean },
) {
  const enabled = (options?.enabled ?? true) && !!entityKey;

  const { data, isLoading } = useQuery({
    queryKey: ['instrument-symbols', entityType, entityKey],
    queryFn: () => fetchInstrumentSymbols(entityType, entityKey!),
    enabled,
    staleTime: 5 * 60 * 1000,
    initialData: options?.initial?.length
      ? { items: options.initial }
      : undefined,
  });

  const symbols = data?.items ?? options?.initial ?? [];
  const [selectedTvSymbol, setSelectedTvSymbol] = useState<string | null>(null);

  useEffect(() => {
    if (!symbols.length) {
      setSelectedTvSymbol(null);
      return;
    }
    setSelectedTvSymbol((prev) => {
      if (prev && symbols.some((s) => s.tv_symbol === prev)) return prev;
      const def = symbols.find((s) => s.is_default) || symbols[0];
      return def?.tv_symbol ?? null;
    });
  }, [symbols]);

  return {
    symbols,
    selectedTvSymbol,
    setSelectedTvSymbol,
    isLoading,
  };
}
