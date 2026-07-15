import { useEffect, useState } from "react";
import { Circle, Calendar } from "lucide-react";

type ClockSpec = {
  city: string;
  exchanges: string;
  tz: string;
  openMin: number;
  closeMin: number;
};

const CLOCKS: ClockSpec[] = [
  { city: "Toronto", exchanges: "TSX · TSX-V · CSE", tz: "America/Toronto", openMin: 9 * 60 + 30, closeMin: 16 * 60 },
  { city: "Sydney", exchanges: "ASX", tz: "Australia/Sydney", openMin: 10 * 60, closeMin: 16 * 60 },
];

const ZONES = [
  { label: "EST", tz: "America/Toronto" },
  { label: "AEST", tz: "Australia/Sydney" },
];

const localParts = (tz: string, d: Date) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of fmt) map[p.type] = p.value;
  const weekday = map.weekday;
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const h = parseInt(map.hour === "24" ? "0" : map.hour, 10);
  const m = parseInt(map.minute, 10);
  const s = parseInt(map.second, 10);
  return { h, m, s, dayIdx, time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
};

const fmtDate = (tz: string, d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(d);

const fmtCountdown = (mins: number) => {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

const computeStatus = (spec: ClockSpec, now: Date) => {
  const { h, m, s, dayIdx } = localParts(spec.tz, now);
  const minsNow = h * 60 + m;
  const isWeekday = dayIdx >= 1 && dayIdx <= 5;
  const isOpen = isWeekday && minsNow >= spec.openMin && minsNow < spec.closeMin;

  if (isOpen) {
    const minsLeft = spec.closeMin - minsNow - (s > 0 ? 1 : 0);
    return { isOpen: true, label: `Closes in ${fmtCountdown(Math.max(1, minsLeft + 1))}` };
  }

  if (isWeekday && minsNow < spec.openMin) {
    const minsLeft = spec.openMin - minsNow - (s > 0 ? 1 : 0);
    return { isOpen: false, label: `Opens in ${fmtCountdown(Math.max(1, minsLeft + 1))}` };
  }

  let minsUntil = 24 * 60 - minsNow;
  let cursorDay = (dayIdx + 1) % 7;
  while (cursorDay === 0 || cursorDay === 6) {
    minsUntil += 24 * 60;
    cursorDay = (cursorDay + 1) % 7;
  }
  minsUntil += spec.openMin;
  return { isOpen: false, label: `Opens in ${fmtCountdown(minsUntil)}` };
};

const MarketClocks = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="bg-[hsl(219_45%_10%)] text-[hsl(36_30%_94%)] border-b border-[hsl(36_30%_94%/0.1)]">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-2 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 sm:gap-8 flex-wrap">
          {CLOCKS.map((spec) => {
            const { time } = localParts(spec.tz, now);
            const { isOpen, label } = computeStatus(spec, now);
            return (
              <div key={spec.city} className="flex items-center gap-2.5 font-mono text-[11px]">
                <Circle
                  className={`w-2 h-2 ${isOpen ? "text-[hsl(174_62%_52%)] fill-[hsl(174_62%_52%)]" : "text-[hsl(0_70%_60%)] fill-[hsl(0_70%_60%)]"}`}
                />
                <div className="flex items-baseline gap-1.5">
                  <span className="font-bold uppercase tracking-wider">{spec.city}</span>
                  <span className="text-[hsl(36_30%_94%/0.5)] hidden sm:inline">{spec.exchanges}</span>
                </div>
                <span className="font-bold tabular-nums">{time}</span>
                <span className="uppercase tracking-wider text-[10px] hidden sm:inline">
                  <span className={isOpen ? "text-[hsl(174_62%_52%)]" : "text-[hsl(0_70%_60%)]"}>
                    {isOpen ? "Open" : "Closed"}
                  </span>
                  <span className="text-[hsl(36_30%_94%/0.5)]"> · {label}</span>
                </span>
                <span className="uppercase tracking-wider text-[10px] sm:hidden">
                  <span className={isOpen ? "text-[hsl(174_62%_52%)]" : "text-[hsl(0_70%_60%)]"}>
                    {isOpen ? "Open" : "Closed"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 sm:gap-5 font-mono text-[11px]">
          <Calendar className="w-3 h-3 text-[hsl(36_30%_94%/0.5)] hidden sm:block" />
          {ZONES.map((z) => {
            const { time } = localParts(z.tz, now);
            const date = fmtDate(z.tz, now);
            return (
              <div key={z.label} className="flex items-center gap-1.5">
                <span className="font-bold uppercase tracking-wider text-[hsl(174_62%_52%)]">{z.label}</span>
                <span className="text-[hsl(36_30%_94%/0.6)] hidden md:inline">{date}</span>
                <span className="font-bold tabular-nums">{time}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MarketClocks;
