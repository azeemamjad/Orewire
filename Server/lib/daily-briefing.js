const { sendBriefingEmail } = require('./email');
const { renderDailyBriefing, briefingSubject } = require('./daily-briefing-template');
const {
  buildGlobalBriefingData,
  getBriefingRecipients,
  fetchFilingsSince,
} = require('./daily-briefing-data');
const db = require('../db');

const HOURS_24_MS = 24 * 60 * 60 * 1000;

async function watchlistFilingsForUser(userId) {
  const since = new Date(Date.now() - HOURS_24_MS);
  const r = await db.query(
    `SELECT company_id FROM watchlist
      WHERE user_id = $1 AND item_type = 'company' AND company_id IS NOT NULL`,
    [userId],
  );
  const companyIds = r.rows.map((x) => x.company_id);
  if (!companyIds.length) return [];
  return fetchFilingsSince(since, { companyIds, limit: 10 });
}

const SEND_DELAY_MS = Number(process.env.BRIEFING_SEND_DELAY_MS || 200);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendBriefingToRecipient(recipient, globalCache) {
  const base = globalCache || (await buildGlobalBriefingData());
  let watchlistFilings = [];
  if (recipient.userId) {
    watchlistFilings = await watchlistFilingsForUser(recipient.userId);
  }
  const data = { ...base, watchlistFilings, watchlistCount: watchlistFilings.length };

  const html = renderDailyBriefing(data, {
    firstName: recipient.firstName,
    userId: recipient.userId,
  });
  await sendBriefingEmail({
    email: recipient.email,
    subject: briefingSubject(),
    html,
  });
}

async function sendDailyBriefings() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[briefing] RESEND_API_KEY not set — skipping daily briefing');
    return { sent: 0, failed: 0, skipped: true };
  }

  const recipients = await getBriefingRecipients();
  if (!recipients.length) {
    console.log('[briefing] No recipients');
    return { sent: 0, failed: 0 };
  }

  console.log(`[briefing] Sending to ${recipients.length} recipient(s)…`);
  const globalCache = await buildGlobalBriefingData();
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      await sendBriefingToRecipient(recipient, globalCache);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[briefing] Failed for ${recipient.email}:`, err?.message || err);
    }
    if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
  }

  console.log(`[briefing] Done — sent ${sent}, failed ${failed}`);
  return { sent, failed };
}

module.exports = {
  sendDailyBriefings,
  sendBriefingToRecipient,
};
