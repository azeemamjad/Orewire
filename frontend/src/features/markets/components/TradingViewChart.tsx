import { useEffect, useRef, useState } from "react";
import { defaultChartInterval } from "@/lib/tradingview-intervals";

const NARROW = "(max-width: 767px)";

// Embeds TradingView's Advanced Chart widget for a given symbol
// (e.g. "TVC:GOLD", "FX:USDCAD", "AMEX:GDXJ"). Re-embeds when the symbol changes.
export default function TradingViewChart({
  symbol,
  interval,
  className,
}: {
  symbol: string | null;
  interval?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedInterval = interval ?? defaultChartInterval(symbol);

  // The drawing-tool rail costs ~55px of a ~310px container on a phone, so drop
  // it on narrow viewports. Re-embeds when the breakpoint is crossed.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
      interval: resolvedInterval,
      timezone: "Etc/UTC",
      theme: "light",
      style: "1",
      locale: "en",
      withdateranges: !isNarrow,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: isNarrow,
      allow_symbol_change: false,
      save_image: !isNarrow,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol, resolvedInterval, isNarrow]);

  const box = `w-full max-w-full overflow-hidden aspect-[16/9] min-h-[300px] sm:min-h-[340px] ${className || ""}`;

  if (!symbol) {
    return <div className={`${box} grid place-items-center text-sm text-muted-foreground`}>Chart unavailable.</div>;
  }
  return <div className={`tradingview-widget-container ${box}`} ref={containerRef} />;
}
