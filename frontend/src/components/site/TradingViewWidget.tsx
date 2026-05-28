import { useEffect, useMemo, useRef } from "react";

type TvStyle = "candles" | "line" | "area";

interface TradingViewWidgetProps {
  symbol: string;
  interval: string;
  style?: TvStyle;
  height?: number;
}

const STYLE_MAP: Record<TvStyle, string> = {
  candles: "1",
  line: "2",
  area: "3",
};

const TradingViewWidget = ({ symbol, interval, style = "area", height = 360 }: TradingViewWidgetProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const widgetConfig = useMemo(
    () => ({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: STYLE_MAP[style],
      locale: "en",
      enable_publishing: false,
      allow_symbol_change: false,
      hide_side_toolbar: true,
      withdateranges: false,
      hide_top_toolbar: true,
      hide_legend: false,
      save_image: false,
      studies: [],
      container_id: "tradingview_widget_container",
    }),
    [symbol, interval, style],
  );

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    host.innerHTML = "";
    const container = document.createElement("div");
    container.className = "tradingview-widget-container h-full w-full";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    widget.id = "tradingview_widget_container";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.innerHTML = JSON.stringify(widgetConfig);

    container.appendChild(widget);
    container.appendChild(script);
    host.appendChild(container);
  }, [widgetConfig]);

  return (
    <div className="w-full" style={{ height }}>
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-sm" />
    </div>
  );
};

export default TradingViewWidget;

