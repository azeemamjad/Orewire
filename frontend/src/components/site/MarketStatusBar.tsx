import { useEffect, useState } from "react";
import { Circle } from "lucide-react";

interface Market {
  city: string;
  exchanges: string;
  timeZone: string;
  openHour: number;
  openMin: number;
  closeHour: number;
  closeMin: number;
}

const MARKETS: Market[] = [
  { city: "Toronto", exchanges: "TSX · TSXV · CSE", timeZone: "America/Toronto", openHour: 9, openMin: 30, closeHour: 16, closeMin: 0 },
  { city: "Sydney", exchanges: "ASX", timeZone: "Australia/Sydney", openHour: 10, openMin: 0, closeHour: 16, closeMin: 0 },
];

interface LocalNow {
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
}

function getLocalNow(timeZone: string, date: Date): LocalNow {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  return {
    hour,
    minute: parseInt(map.minute, 10),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function fmtTime(h: number, m: number): string {
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function fmtDuration(totalMinutes: number): string {
  if (totalMinutes < 0) totalMinutes = 0;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

interface Status {
  isOpen: boolean;
  label: string;
  nextLabel: string;
  nextDuration: string;
  localTime: string;
}

function computeStatus(market: Market, now: Date): Status {
  const local = getLocalNow(market.timeZone, now);
  const isWeekday = local.weekday >= 1 && local.weekday <= 5;
  const nowMins = local.hour * 60 + local.minute;
  const openMins = market.openHour * 60 + market.openMin;
  const closeMins = market.closeHour * 60 + market.closeMin;
  const isOpen = isWeekday && nowMins >= openMins && nowMins < closeMins;

  if (isOpen) {
    return {
      isOpen: true,
      label: "Open",
      nextLabel: "Closes in",
      nextDuration: fmtDuration(closeMins - nowMins),
      localTime: fmtTime(local.hour, local.minute),
    };
  }

  // Find minutes until next weekday open
  let daysAhead = 0;
  let weekday = local.weekday;
  if (isWeekday && nowMins < openMins) {
    daysAhead = 0;
  } else {
    daysAhead = 1;
    weekday = (weekday + 1) % 7;
    while (weekday === 0 || weekday === 6) {
      daysAhead += 1;
      weekday = (weekday + 1) % 7;
    }
  }
  const minutesToNext = daysAhead * 24 * 60 + (openMins - nowMins);

  return {
    isOpen: false,
    label: "Closed",
    nextLabel: "Opens in",
    nextDuration: fmtDuration(minutesToNext),
    localTime: fmtTime(local.hour, local.minute),
  };
}

const MarketStatusBar = () => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="bg-[hsl(220_45%_10%)] text-[hsl(36_30%_94%)] border-b border-[hsl(36_30%_94%/0.1)]">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-2 flex items-center justify-center sm:justify-start gap-4 sm:gap-8 flex-wrap">
        {MARKETS.map((m) => {
          const s = computeStatus(m, now);
          const dotColor = s.isOpen ? "hsl(174_62%_52%)" : "hsl(0_70%_60%)";
          const labelColor = s.isOpen ? "text-[hsl(174_62%_52%)]" : "text-[hsl(0_70%_60%)]";
          return (
            <div key={m.city} className="flex items-center gap-2.5 font-mono text-[11px]">
              <Circle className="w-2 h-2" style={{ color: dotColor, fill: dotColor }} />
              <div className="flex items-baseline gap-1.5">
                <span className="font-bold uppercase tracking-wider">{m.city}</span>
                <span className="text-[hsl(36_30%_94%/0.5)] hidden sm:inline">{m.exchanges}</span>
              </div>
              <span className="font-bold tabular-nums">{s.localTime}</span>
              <span className="uppercase tracking-wider text-[10px] hidden sm:inline">
                <span className={labelColor}>{s.label}</span>
                <span className="text-[hsl(36_30%_94%/0.5)]"> · {s.nextLabel} {s.nextDuration}</span>
              </span>
              <span className="uppercase tracking-wider text-[10px] sm:hidden">
                <span className={labelColor}>{s.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MarketStatusBar;
