const ET_TZ = 'America/Toronto';

/** Header price: always 4 decimal places. */
export function formatPrice4(n: number): string {
  return n.toFixed(4);
}

/**
 * Live quote attribution under the title.
 * Example: "· Live · Last: 15:42:08 ET"
 */
export function formatLiveLastLabel(updatedAtMs: number | null | undefined): string {
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return '· Live · Last: — ET';
  }
  const time = new Date(updatedAtMs).toLocaleTimeString('en-US', {
    timeZone: ET_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `· Live · Last: ${time} ET`;
}

/** Prefer API `updatedAt` ISO string, else React Query `dataUpdatedAt`. */
export function liveQuoteUpdatedAtMs(
  updatedAtIso: string | null | undefined,
  dataUpdatedAt: number | undefined,
): number | null {
  if (updatedAtIso) {
    const ms = Date.parse(updatedAtIso);
    if (Number.isFinite(ms)) return ms;
  }
  if (dataUpdatedAt != null && dataUpdatedAt > 0) return dataUpdatedAt;
  return null;
}
