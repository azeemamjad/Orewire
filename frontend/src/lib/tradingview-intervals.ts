/** Default TradingView chart interval for a symbol. TVC/INDEX feeds are daily-only. */
export function defaultChartInterval(symbol: string | null): string {
  if (!symbol) return "1";
  if (symbol.startsWith("TVC:") || symbol.startsWith("INDEX:")) return "D";
  return "1";
}
