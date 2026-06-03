#!/usr/bin/env node
/**
 * Manually send the daily briefing to all subscribers.
 * Usage: node scripts/send-daily-briefing.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const migrate = require('../db/migrate');
const { sendDailyBriefings } = require('../lib/daily-briefing');

(async () => {
  try {
    await migrate();
    const result = await sendDailyBriefings();
    console.log(result);
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
