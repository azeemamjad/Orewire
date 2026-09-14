/**
 * Day-of-week gating for scheduled jobs ("paused days").
 *
 * Weekday indexes follow Date#getDay(): 0 = Sunday … 6 = Saturday.
 * Used by the filing/news/profile pipeline schedulers and the daily briefing email
 * so an operator can pause either on chosen weekdays without editing cron expressions.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Weekday index for a moment, optionally in a specific IANA time zone.
 * Time-zone aware so a job scheduled in America/Toronto is judged by Toronto's day,
 * not the server's.
 */
function weekdayIndex(date = new Date(), timeZone) {
  if (!timeZone) return date.getDay();
  try {
    const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
    const i = SHORT_NAMES.indexOf(short);
    return i >= 0 ? i : date.getDay();
  } catch {
    // Unknown/invalid time zone — fall back to server-local.
    return date.getDay();
  }
}

/** Accepts [0,6] / "0,6" / "Sunday" and returns a sorted, unique list of 0-6. */
function normalizeSkipDays(input) {
  const raw = Array.isArray(input)
    ? input
    : (typeof input === 'string' ? input.split(',') : []);
  const out = [];
  for (const value of raw) {
    let n = Number(value);
    if (!Number.isInteger(n)) {
      const named = DAY_NAMES.findIndex((d) => d.toLowerCase() === String(value).trim().toLowerCase());
      n = named;
    }
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function dayName(index) {
  return DAY_NAMES[index] || String(index);
}

/**
 * Should a job be skipped right now?
 * @param {number[]|string} skipDays
 * @param {{ timeZone?: string, date?: Date }} [opts]
 * @returns {{ skip: boolean, weekday: number, dayName: string }}
 */
function shouldSkipDay(skipDays, { timeZone, date = new Date() } = {}) {
  const weekday = weekdayIndex(date, timeZone);
  const list = normalizeSkipDays(skipDays);
  return { skip: list.includes(weekday), weekday, dayName: dayName(weekday) };
}

/** Human summary for logs/UI, e.g. "paused Sunday" or "every day". */
function describeSkipDays(skipDays) {
  const list = normalizeSkipDays(skipDays);
  return list.length ? `paused ${list.map(dayName).join(', ')}` : 'every day';
}

module.exports = {
  DAY_NAMES,
  weekdayIndex,
  normalizeSkipDays,
  dayName,
  shouldSkipDay,
  describeSkipDays,
};
