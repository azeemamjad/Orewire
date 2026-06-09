import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCommodities, fetchCompanies, fetchCurrencies, fetchIndexes } from "@/lib/api";
import { buildNavSearchSections, type NavSearchHit, type SearchCategory } from "@/lib/nav-search";

const EMPTY_SECTIONS: Record<SearchCategory, NavSearchHit[]> = {
  companies: [],
  commodities: [],
  indexes: [],
  currencies: [],
};

/**
 * Shared search-suggestion engine used by both the navbar search and the
 * home hero search. Debounces the query, fetches the same data sources, and
 * builds ranked suggestion sections.
 */
export function useSearchSuggestions(query: string, debounceMs = 280) {
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

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
      return { order: [] as SearchCategory[], sections: EMPTY_SECTIONS };
    }
    return buildNavSearchSections(
      debounced,
      companyData?.data ?? [],
      commoditiesData?.items ?? [],
      indexesData?.items ?? [],
      currenciesData?.items ?? [],
    );
  }, [debounced, companyData?.data, commoditiesData?.items, indexesData?.items, currenciesData?.items]);

  const hasSuggestions = order.length > 0;
  const isSearching = debounced.length >= 1 && companiesLoading;

  return { debounced, order, sections, hasSuggestions, isSearching };
}
