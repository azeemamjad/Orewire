/** Map Orewire exchange codes to TradingView symbol prefixes. */
export function tvSymbol(exchange?: string | null, ticker?: string | null): string | null {
  if (!ticker) return null;
  const ex = (exchange || "").toUpperCase().replace("-", "");
  const prefix = ({ TSX: "TSX", TSXV: "TSXV", CSE: "CSE", ASX: "ASX" } as Record<string, string>)[ex] || ex;
  return prefix ? `${prefix}:${ticker.toUpperCase()}` : ticker.toUpperCase();
}
