import type { ReactNode } from "react";
import { Building2 } from "lucide-react";
import TradingViewChart from "@/components/site/TradingViewChart";

type StatRow = { label: string; value: string };

type MarketDetailLayoutProps = {
  chartSymbol: string | null;
  chartLabel?: string | null;
  chartInterval?: string;
  symbolPicker?: ReactNode;
  aboutTitle: string;
  aboutBody: ReactNode;
  stats: StatRow[];
  marketNewsSection: ReactNode;
  discussion: ReactNode;
};

/** Shared 2-col layout for commodity / index / currency detail pages. */
export default function MarketDetailLayout({
  chartSymbol,
  chartLabel,
  chartInterval,
  symbolPicker,
  aboutTitle,
  aboutBody,
  stats,
  discussion,
  marketNewsSection,
}: MarketDetailLayoutProps) {
  return (
    <div className="grid lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 flex flex-col gap-6">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="space-y-1.5 p-6 pb-3 flex flex-col gap-2 shrink-0">
            <div className="flex flex-row items-center justify-between gap-3 flex-wrap">
              <h3 className="font-semibold tracking-tight font-display text-xl">Price</h3>
              {chartLabel && <span className="font-mono text-[11px] text-muted-foreground">{chartLabel}</span>}
            </div>
            {symbolPicker}
          </div>
          <div className="p-6 pt-0">
            <TradingViewChart symbol={chartSymbol} interval={chartInterval} />
          </div>
        </div>

        {marketNewsSection}
        {discussion}
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="font-semibold font-display text-base uppercase tracking-wider">Key stats</h3>
          </div>
          <div className="p-6 pt-0">
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              {stats.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">{row.label}</dt>
                  <dd className="font-mono text-right font-semibold">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm flex-1">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="font-semibold font-display text-base uppercase tracking-wider flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {aboutTitle}
            </h3>
          </div>
          <div className="p-6 pt-0 space-y-3 text-sm leading-relaxed">{aboutBody}</div>
        </div>
      </aside>
    </div>
  );
}
