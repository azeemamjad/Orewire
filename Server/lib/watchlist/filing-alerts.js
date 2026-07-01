const db = require('../../db');
const { sendWatchlistAlertEmail } = require('../email');
const {
  renderWatchlistFilingAlertEmail,
  filingAlertSubject,
} = require('../email-templates/watchlist-filing-alert');

const SEND_DELAY_MS = Number(process.env.WATCHLIST_FILING_SEND_DELAY_MS || 200);
const LOOKBACK_HOURS = Number(process.env.WATCHLIST_FILING_LOOKBACK_HOURS || 24);

function appBase() {
  return (process.env.APP_URL || `https://${(process.env.FRONTEND_DOMAIN || 'orewire.com').replace(/^https?:\/\//, '')}`).replace(/\/$/, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function filingsForUserMorning(userId, since) {
  const r = await db.query(
    `SELECT f.id, f.company_id, f.company_name, f.filing_type, f.source_url, f.created_at,
            COALESCE(NULLIF(f.exchange, ''), c.exchange) AS exchange,
            c.ticker,
            a.verdict, a.summary, a.verdict_reason, a.key_facts, a.display_type
       FROM filings f
       INNER JOIN watchlist w ON w.user_id = $1 AND w.item_type = 'company' AND w.company_id = f.company_id
       INNER JOIN companies c ON c.id = f.company_id
       LEFT JOIN ai_output a ON a.filing_id = f.id
      WHERE f.created_at > $2
        AND NOT EXISTS (
          SELECT 1 FROM watchlist_filing_email_sent s
           WHERE s.user_id = $1 AND s.filing_id = f.id
        )
      ORDER BY f.created_at ASC`,
    [userId, since],
  );
  return r.rows;
}

function backendApiBase() {
  if (process.env.API_PUBLIC_URL) return process.env.API_PUBLIC_URL.replace(/\/$/, '');
  const domain = (process.env.BACKEND_DOMAIN || '').replace(/^https?:\/\//, '');
  if (domain) return `https://${domain}/api`;
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/api`;
}

function buildFilingPayload(row) {
  const base = appBase();
  const verdict = row.verdict
    ? row.verdict.charAt(0).toUpperCase() + row.verdict.slice(1).toLowerCase()
    : null;

  let sedarUrl = row.source_url;
  if (!sedarUrl || !String(sedarUrl).startsWith('http')) {
    sedarUrl = `${backendApiBase()}/filings/${row.id}/document`;
  }

  return {
    filingId: row.id,
    companyName: row.company_name,
    ticker: row.ticker,
    exchange: row.exchange,
    filingType: row.filing_type,
    displayType: row.display_type,
    verdict,
    summary: row.summary || row.verdict_reason || 'Analysis pending — view the filing on OreWire.',
    verdictReason: row.verdict_reason,
    keyFacts: row.key_facts,
    summaryUrl: `${base}/filings/${row.id}`,
    sedarUrl,
  };
}

async function sendFilingAlertToUser(user, filingRow) {
  const payload = buildFilingPayload(filingRow);
  const html = renderWatchlistFilingAlertEmail(payload);
  const subject = filingAlertSubject(payload);

  await sendWatchlistAlertEmail({
    email: user.email,
    subject,
    html,
  });

  await db.query(
    `INSERT INTO watchlist_filing_email_sent (user_id, filing_id) VALUES ($1, $2)
     ON CONFLICT (user_id, filing_id) DO NOTHING`,
    [user.user_id, payload.filingId],
  );
}

async function getAlertRecipients() {
  const r = await db.query(
    `SELECT id AS user_id, email, first_name
       FROM users
      WHERE email_verified = TRUE
        AND COALESCE(watchlist_alerts_enabled, TRUE) = TRUE`,
  );
  return r.rows;
}

/**
 * Morning job: email each user for watchlist filings from the last LOOKBACK_HOURS.
 */
async function sendMorningWatchlistFilingAlerts() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[watchlist-filing] RESEND_API_KEY not set — skipping');
    return { sent: 0, skipped: true };
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const recipients = await getAlertRecipients();
  if (!recipients.length) {
    console.log('[watchlist-filing] No recipients');
    return { sent: 0, users: 0 };
  }

  console.log(`[watchlist-filing] Morning run — ${recipients.length} user(s), since ${since.toISOString()}`);

  let totalSent = 0;
  let usersWithAlerts = 0;

  for (const user of recipients) {
    const filings = await filingsForUserMorning(user.user_id, since);
    if (!filings.length) continue;

    usersWithAlerts++;
    for (const filing of filings) {
      try {
        await sendFilingAlertToUser(user, filing);
        totalSent++;
      } catch (err) {
        console.error(
          `[watchlist-filing] Failed ${user.email} filing #${filing.id}:`,
          err?.message || err,
        );
      }
      if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
    }
  }

  console.log(`[watchlist-filing] Done — ${totalSent} email(s) to ${usersWithAlerts} user(s)`);
  return { sent: totalSent, users: usersWithAlerts };
}

module.exports = {
  sendMorningWatchlistFilingAlerts,
};
