const db = require('../../db');

const PLATFORM = 'x';

const DEFAULTS = {
  enabled: false,
  cron: process.env.SOCIAL_X_CRON || '0 8 * * *',
  timezone: process.env.BRIEFING_TIMEZONE || 'America/Toronto',
  items_min: 5,
  items_max: 7,
  dry_run: process.env.SOCIAL_X_DRY_RUN !== 'false',
};

async function getSettings() {
  const r = await db.query(
    `SELECT enabled, cron, timezone, items_min, items_max, dry_run, updated_at,
            bridge_url, bridge_token_enc, bridge_status, last_bridge_error, last_bridge_ok_at
       FROM social_automation_settings WHERE platform = $1`,
    [PLATFORM],
  );
  if (!r.rows.length) {
    return {
      platform: PLATFORM,
      ...DEFAULTS,
      updated_at: null,
      bridge_url: null,
      bridge_configured: false,
      bridge_status: 'unknown',
      last_bridge_error: null,
      last_bridge_ok_at: null,
    };
  }
  const row = r.rows[0];
  return {
    platform: PLATFORM,
    enabled: !!row.enabled,
    cron: row.cron || DEFAULTS.cron,
    timezone: row.timezone || DEFAULTS.timezone,
    items_min: Number(row.items_min) || 5,
    items_max: Number(row.items_max) || 7,
    dry_run: !!row.dry_run,
    updated_at: row.updated_at,
    bridge_url: row.bridge_url || null,
    bridge_configured: !!(row.bridge_url && row.bridge_token_enc) || !!(process.env.SOCIAL_BRIDGE_URL && process.env.SOCIAL_BRIDGE_TOKEN),
    bridge_status: row.bridge_status || 'unknown',
    last_bridge_error: row.last_bridge_error || null,
    last_bridge_ok_at: row.last_bridge_ok_at || null,
  };
}

async function updateSettings(patch = {}) {
  const cur = await getSettings();
  const next = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : cur.enabled,
    cron: patch.cron !== undefined ? String(patch.cron).trim() || cur.cron : cur.cron,
    timezone: patch.timezone !== undefined ? String(patch.timezone).trim() || cur.timezone : cur.timezone,
    items_min: patch.items_min !== undefined ? Number(patch.items_min) : cur.items_min,
    items_max: patch.items_max !== undefined ? Number(patch.items_max) : cur.items_max,
    dry_run: patch.dry_run !== undefined ? !!patch.dry_run : cur.dry_run,
  };
  if (next.items_min < 1) next.items_min = 1;
  if (next.items_max < next.items_min) next.items_max = next.items_min;
  if (next.items_max > 10) next.items_max = 10;

  await db.query(
    `INSERT INTO social_automation_settings
       (platform, enabled, cron, timezone, items_min, items_max, dry_run, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (platform) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       cron = EXCLUDED.cron,
       timezone = EXCLUDED.timezone,
       items_min = EXCLUDED.items_min,
       items_max = EXCLUDED.items_max,
       dry_run = EXCLUDED.dry_run,
       updated_at = NOW()`,
    [PLATFORM, next.enabled, next.cron, next.timezone, next.items_min, next.items_max, next.dry_run],
  );
  return getSettings();
}

module.exports = { PLATFORM, getSettings, updateSettings, DEFAULTS };
