const db = require('../../db');
const { CATEGORY_KEYS } = require('./material-templates');

const PLATFORM = 'x';

const DEFAULTS = {
  enabled: false,
  cron: process.env.SOCIAL_X_CRON || '0 8 * * *',
  timezone: process.env.BRIEFING_TIMEZONE || 'America/Toronto',
  items_min: 5,
  items_max: 7,
  dry_run: process.env.SOCIAL_X_DRY_RUN !== 'false',
  // Material-post pipeline (template-driven) — see lib/social/material-*.js
  material_cron: process.env.SOCIAL_MATERIAL_CRON || '*/30 * * * *',
  material_daily_cap: 3,
  material_min_gap_minutes: 60,
  material_min_verdict: 'noteworthy',
  material_per_company_days: 7,
};

const MATERIAL_CATEGORY_KEYS = CATEGORY_KEYS;

function envXApiConfigured() {
  return !!(
    (process.env.X_API_KEY || process.env.TWITTER_API_KEY) &&
    (process.env.X_API_SECRET || process.env.X_API_KEY_SECRET || process.env.TWITTER_API_SECRET) &&
    (process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN) &&
    (process.env.X_ACCESS_TOKEN_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET)
  );
}

/** Keep the stored category list inside the known template keys; empty means "all". */
function normalizeCategories(input) {
  if (!Array.isArray(input)) return [...MATERIAL_CATEGORY_KEYS];
  const kept = input.map((c) => String(c || '').trim().toLowerCase()).filter((c) => MATERIAL_CATEGORY_KEYS.includes(c));
  return kept.length ? [...new Set(kept)] : [...MATERIAL_CATEGORY_KEYS];
}

function normalizeMinVerdict(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'watch' ? 'watch' : 'noteworthy';
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

async function getSettings() {
  const r = await db.query(
    `SELECT enabled, cron, timezone, items_min, items_max, dry_run, updated_at,
            bridge_url, bridge_token_enc, bridge_status, last_bridge_error, last_bridge_ok_at,
            x_api_key_enc, x_api_secret_enc, x_access_token_enc, x_access_secret_enc,
            x_api_status, last_x_api_error, last_x_api_ok_at, x_api_username,
            material_cron, material_daily_cap, material_min_gap_minutes,
            material_min_verdict, material_categories, material_per_company_days
       FROM social_automation_settings WHERE platform = $1`,
    [PLATFORM],
  );
  if (!r.rows.length) {
    return {
      platform: PLATFORM,
      ...DEFAULTS,
      material_categories: [...MATERIAL_CATEGORY_KEYS],
      updated_at: null,
      bridge_url: null,
      bridge_configured: false,
      bridge_status: 'unknown',
      last_bridge_error: null,
      last_bridge_ok_at: null,
      x_api_configured: envXApiConfigured(),
      x_api_status: 'unknown',
      last_x_api_error: null,
      last_x_api_ok_at: null,
      x_api_username: null,
    };
  }
  const row = r.rows[0];
  const dbApiConfigured = !!(
    row.x_api_key_enc && row.x_api_secret_enc && row.x_access_token_enc && row.x_access_secret_enc
  );
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
    x_api_configured: dbApiConfigured || envXApiConfigured(),
    x_api_status: row.x_api_status || 'unknown',
    last_x_api_error: row.last_x_api_error || null,
    last_x_api_ok_at: row.last_x_api_ok_at || null,
    x_api_username: row.x_api_username || null,
    // Material-post pipeline
    material_cron: row.material_cron || DEFAULTS.material_cron,
    material_daily_cap: clampInt(row.material_daily_cap, 1, 20, DEFAULTS.material_daily_cap),
    material_min_gap_minutes: clampInt(row.material_min_gap_minutes, 0, 1440, DEFAULTS.material_min_gap_minutes),
    material_min_verdict: normalizeMinVerdict(row.material_min_verdict),
    material_categories: normalizeCategories(row.material_categories),
    material_per_company_days: clampInt(row.material_per_company_days, 1, 90, DEFAULTS.material_per_company_days),
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
    material_cron: patch.material_cron !== undefined
      ? (String(patch.material_cron).trim() || cur.material_cron)
      : cur.material_cron,
    material_daily_cap: patch.material_daily_cap !== undefined
      ? clampInt(patch.material_daily_cap, 1, 20, cur.material_daily_cap)
      : cur.material_daily_cap,
    material_min_gap_minutes: patch.material_min_gap_minutes !== undefined
      ? clampInt(patch.material_min_gap_minutes, 0, 1440, cur.material_min_gap_minutes)
      : cur.material_min_gap_minutes,
    material_min_verdict: patch.material_min_verdict !== undefined
      ? normalizeMinVerdict(patch.material_min_verdict)
      : cur.material_min_verdict,
    material_categories: patch.material_categories !== undefined
      ? normalizeCategories(patch.material_categories)
      : cur.material_categories,
    material_per_company_days: patch.material_per_company_days !== undefined
      ? clampInt(patch.material_per_company_days, 1, 90, cur.material_per_company_days)
      : cur.material_per_company_days,
  };
  if (next.items_min < 1) next.items_min = 1;
  if (next.items_max < next.items_min) next.items_max = next.items_min;
  if (next.items_max > 10) next.items_max = 10;

  await db.query(
    `INSERT INTO social_automation_settings
       (platform, enabled, cron, timezone, items_min, items_max, dry_run,
        material_cron, material_daily_cap, material_min_gap_minutes,
        material_min_verdict, material_categories, material_per_company_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, NOW())
     ON CONFLICT (platform) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       cron = EXCLUDED.cron,
       timezone = EXCLUDED.timezone,
       items_min = EXCLUDED.items_min,
       items_max = EXCLUDED.items_max,
       dry_run = EXCLUDED.dry_run,
       material_cron = EXCLUDED.material_cron,
       material_daily_cap = EXCLUDED.material_daily_cap,
       material_min_gap_minutes = EXCLUDED.material_min_gap_minutes,
       material_min_verdict = EXCLUDED.material_min_verdict,
       material_categories = EXCLUDED.material_categories,
       material_per_company_days = EXCLUDED.material_per_company_days,
       updated_at = NOW()`,
    [
      PLATFORM, next.enabled, next.cron, next.timezone, next.items_min, next.items_max, next.dry_run,
      next.material_cron, next.material_daily_cap, next.material_min_gap_minutes,
      next.material_min_verdict, JSON.stringify(next.material_categories), next.material_per_company_days,
    ],
  );
  return getSettings();
}

module.exports = {
  PLATFORM,
  getSettings,
  updateSettings,
  DEFAULTS,
  MATERIAL_CATEGORY_KEYS,
  normalizeCategories,
};
