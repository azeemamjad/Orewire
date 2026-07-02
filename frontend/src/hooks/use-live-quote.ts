import { useQuery } from '@tanstack/react-query';
import { fetchTvQuoteBySymbol } from '@/features/markets/instrument-symbols';

const REFETCH_MS = 30_000;

export function useLiveQuote(tvSymbol: string | null | undefined) {
  return useQuery({
    queryKey: ['live-quote', tvSymbol],
    queryFn: () => fetchTvQuoteBySymbol(tvSymbol!),
    enabled: !!tvSymbol,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.price != null ? REFETCH_MS : false,
    staleTime: REFETCH_MS / 2,
    placeholderData: (prev) => prev,
  });
}
