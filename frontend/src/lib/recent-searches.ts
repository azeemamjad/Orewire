export type RecentSearchItem = {
  id: string;
  label: string;
  href: string;
  query: string;
};

const STORAGE_KEY = "orewire-recent-searches";
const MAX_RECENT = 3;

export function getRecentSearches(): RecentSearchItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearchItem[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(item: Omit<RecentSearchItem, "id">) {
  const entry: RecentSearchItem = {
    id: `${item.href}-${Date.now()}`,
    ...item,
  };
  const next = [entry, ...getRecentSearches().filter((r) => r.href !== item.href)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("orewire-recent-searches-change"));
}
