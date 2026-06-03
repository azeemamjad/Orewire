#!/usr/bin/env node
/**
 * Manually run the morning watchlist filing alert job.
 * Usage: node scripts/send-watchlist-filing-alerts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const migrate = require('../db/migrate');
const { sendMorningWatchlistFilingAlerts } = require('../lib/watchlist-filing-alerts');

(async () => {
  try {
    await migrate();
    const result = await sendMorningWatchlistFilingAlerts();
    console.log(result);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
