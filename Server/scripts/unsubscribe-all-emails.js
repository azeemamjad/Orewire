#!/usr/bin/env node
/**
 * Unsubscribe all users from marketing emails (briefing + watchlist alerts).
 * Run once before rolling out new email templates.
 *
 * Usage: node scripts/unsubscribe-all-emails.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

async function main() {
  const briefing = await db.query(
    `UPDATE briefing_subscribers SET unsubscribed_at = NOW() WHERE unsubscribed_at IS NULL RETURNING email`,
  );
  const users = await db.query(
    `UPDATE users SET briefing_enabled = FALSE, watchlist_alerts_enabled = FALSE
     WHERE COALESCE(briefing_enabled, TRUE) = TRUE OR COALESCE(watchlist_alerts_enabled, TRUE) = TRUE
     RETURNING id, email`,
  );
  console.log(`Unsubscribed ${briefing.rowCount} briefing_subscribers`);
  console.log(`Disabled email prefs for ${users.rowCount} users`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
