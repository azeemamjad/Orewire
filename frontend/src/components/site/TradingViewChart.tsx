import { useEffect, useRef } from "react";

// Embeds TradingView's Advanced Chart widget for a given symbol
// (e.g. "TVC:GOLD", "FX:USDCAD", "AMEX:GDXJ"). Re-embeds when the symbol changes.
export default function TradingViewChart({
  symbol,
  className,
}: {
  symbol: string | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) return;
    container.innerHTML = "";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "light",
      style: "1",
      locale: "en",
      withdateranges: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: true,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol]);

  const box = `w-full aspect-[16/9] min-h-[340px] ${className || ""}`;

  if (!symbol) {
    return <div className={`${box} grid place-items-center text-sm text-muted-foreground`}>Chart unavailable.</div>;
  }
  return <div className={`tradingview-widget-container ${box}`} ref={containerRef} />;
}
