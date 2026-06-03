/**
 * Build / parse cron expressions from user-friendly schedule fields.
 * frequency: 'every_hours' | 'daily' | 'weekly'
 */

const DEFAULT_PARTS = { frequency: 'daily', hour: 6, minute: 0, hours: 3, dayOfWeek: 1 };

function clampInt(n, min, max, fallback) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function normalizeParts(parts) {
  const p = { ...DEFAULT_PARTS, ...(parts || {}) };
  p.frequency = ['every_hours', 'daily', 'weekly'].includes(p.frequency) ? p.frequency : 'daily';
  p.hour = clampInt(p.hour, 0, 23, 6);
  p.minute = clampInt(p.minute, 0, 59, 0);
  p.hours = clampInt(p.hours, 1, 23, 3);
  p.dayOfWeek = clampInt(p.dayOfWeek, 0, 6, 1);
  return p;
}

function buildCron(parts) {
  const p = normalizeParts(parts);
  if (p.frequency === 'every_hours') {
    return `0 */${p.hours} * * *`;
  }
  if (p.frequency === 'weekly') {
    return `${p.minute} ${p.hour} * * ${p.dayOfWeek}`;
  }
  return `${p.minute} ${p.hour} * * *`;
}

function parseCron(expr) {
  const parts = { ...DEFAULT_PARTS };
  if (!expr || typeof expr !== 'string') return parts;
  const bits = expr.trim().split(/\s+/);
  if (bits.length < 5) return parts;

  const [min, hour, , , dow] = bits;
  if (hour.startsWith('*/')) {
    parts.frequency = 'every_hours';
    parts.hours = clampInt(hour.slice(2), 1, 23, 3);
    parts.minute = clampInt(min, 0, 59, 0);
    return parts;
  }
  if (dow !== '*' && dow !== '?') {
    parts.frequency = 'weekly';
    parts.dayOfWeek = clampInt(dow, 0, 6, 1);
  } else {
    parts.frequency = 'daily';
  }
  parts.hour = clampInt(hour, 0, 23, 6);
  parts.minute = clampInt(min, 0, 59, 0);
  return parts;
}

function describeSchedule(parts) {
  const p = normalizeParts(parts);
  if (p.frequency === 'every_hours') {
    return `Every ${p.hours} hour${p.hours === 1 ? '' : 's'}`;
  }
  if (p.frequency === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const t = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    return `Weekly on ${days[p.dayOfWeek]} at ${t}`;
  }
  const t = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return `Daily at ${t}`;
}

module.exports = { buildCron, parseCron, normalizeParts, describeSchedule, DEFAULT_PARTS };
