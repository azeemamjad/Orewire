import { useQuery } from '@tanstack/react-query';
import { fetchTvQuoteBySymbol } from '@/features/markets/instrument-symbols';

const REFETCH_MS = 5_000;

export function useLiveQuote(tvSymbol: string | null | undefined) {
  return useQuery({
    queryKey: ['live-quote', tvSymbol],
    queryFn: () => fetchTvQuoteBySymbol(tvSymbol!),
    enabled: !!tvSymbol,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS / 2,
    placeholderData: (prev) => prev,
  });
}
