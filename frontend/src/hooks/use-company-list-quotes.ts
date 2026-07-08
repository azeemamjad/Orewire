import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Company } from "@/lib/api";
import { tvSymbol } from "@/lib/tradingview";
import { fetchTvQuoteBySymbol, type LiveTvQuote } from "@/features/markets/instrument-symbols";

const REFETCH_MS = 5_000;

export function companyListQuoteKey(exchange: string | null | undefined, ticker: string | null | undefined): string | null {
  return tvSymbol(exchange, ticker);
}

export function useCompanyListQuotes(companies: Company[]) {
  const symbols = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of companies) {
      const sym = companyListQuoteKey(c.exchange, c.ticker);
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push(sym);
    }
    return out;
  }, [companies]);

  const { data } = useQuery({
    queryKey: ["company-list-quotes", symbols.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        symbols.map(async (sym) => {
          const quote = await fetchTvQuoteBySymbol(sym);
          return [sym, quote] as const;
        }),
      );
      const map = new Map<string, LiveTvQuote>();
      for (const [sym, quote] of entries) {
        if (quote) map.set(sym, quote);
      }
      return map;
    },
    enabled: symbols.length > 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: REFETCH_MS,
    staleTime: REFETCH_MS / 2,
    placeholderData: (prev) => prev,
  });

  return data ?? new Map<string, LiveTvQuote>();
}
