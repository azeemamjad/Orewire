const db = require('./index');

/**
 * Generic key/value settings store (value is JSON).
 * Used for pipeline schedules, workers, toggles, etc.
 */
async function getSetting(key) {
  const r = await db.query('SELECT value, updated_at FROM app_settings WHERE key = $1', [key]);
  if (r.rows.length === 0) return null;
  return r.rows[0].value;
}

async function setSetting(key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

async function deleteSetting(key) {
  await db.query('DELETE FROM app_settings WHERE key = $1', [key]);
}

module.exports = { getSetting, setSetting, deleteSetting };
