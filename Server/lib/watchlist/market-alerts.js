const db = require('../../db');
const {
  getCommoditiesPayload,
  getIndexesPayload,
  getCurrenciesPayload,
} = require('../market/payloads');
const { commodityApiKeyFromSlug } = require('../market/commodity-slugs');

const MAJOR_MOVE_PCT = parseFloat(process.env.ALERT_MAJOR_MOVE_PCT || '2', 10);

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function marketHref(itemType, itemKey) {
  const slug = encodeURIComponent(itemKey);
  if (itemType === 'commodity') return `/market/commodity/${slug}`;
  if (itemType === 'index') return `/market/index/${slug}`;
  return `/market/currency/${slug}`;
}

function findSpot(itemType, itemKey, commodities, indexes, currencies) {
  const key = itemKey.toUpperCase();
  if (itemType === 'commodity') {
    const apiKey = commodityApiKeyFromSlug(itemKey);
    return commodities.items.find((i) => i.key === apiKey) || null;
  }
  if (itemType === 'index') {
    return indexes.items.find((i) => i.key.toUpperCase() === key) || null;
  }
  if (itemType === 'currency') {
    return currencies.items.find((i) => i.key.toUpperCase() === key) || null;
  }
  return null;
}

/**
 * Append in-app alerts for large daily moves on commodities, indexes, and currencies.
 */
async function appendMarketMoveAlerts(userId, alerts) {
  const rows = await db.query(
    `SELECT id, item_type, item_key, alert_move_notified_date
       FROM watchlist
      WHERE user_id = $1
        AND alerts_enabled = TRUE
        AND item_type IN ('commodity', 'index', 'currency')`,
    [userId],
  );
  if (!rows.rows.length) return;

  const [commodities, indexes, currencies] = await Promise.all([
    getCommoditiesPayload(),
    getIndexesPayload(),
    getCurrenciesPayload(),
  ]);

  const today = todayUtc();

  for (const w of rows.rows) {
    const spot = findSpot(w.item_type, w.item_key, commodities, indexes, currencies);
    if (!spot || spot.change_pct == null || spot.price == null) continue;
    if (Math.abs(spot.change_pct) < MAJOR_MOVE_PCT) continue;

    const notified =
      w.alert_move_notified_date instanceof Date
        ? w.alert_move_notified_date.toISOString().slice(0, 10)
        : w.alert_move_notified_date
          ? String(w.alert_move_notified_date).slice(0, 10)
          : null;
    if (notified === today) continue;

    const label = spot.label || w.item_key;
    const pct = spot.change_pct;
    const at = new Date().toISOString();
    const id = `market-${w.item_type}-${w.item_key}-${today}`;

    alerts.push({
      type: 'market',
      id,
      itemType: w.item_type,
      itemKey: w.item_key,
      label,
      price: spot.price,
      changePct: pct,
      at,
      href: marketHref(w.item_type, w.item_key),
    });

    await db.query(
      `UPDATE watchlist SET alert_move_notified_date = CURRENT_DATE WHERE id = $1`,
      [w.id],
    );
  }
}

module.exports = { appendMarketMoveAlerts, MAJOR_MOVE_PCT };
