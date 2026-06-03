const {
  renderWelcomeEmail,
  renderOtpEmail,
  renderMorningBriefSubscribeEmail,
} = require('./email-templates');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.AUTH_FROM_EMAIL || 'OreWire <no-reply@orewire.com>';
const BRIEFING_FROM_EMAIL = process.env.BRIEFING_FROM_EMAIL || 'OreWire Briefing <briefing@orewire.com>';
const ALERTS_FROM_EMAIL = process.env.ALERTS_FROM_EMAIL || 'OreWire Alerts <alerts@orewire.com>';

async function sendEmailViaResend(to, subject, html, from = FROM_EMAIL) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend failed: ${res.status} ${body}`);
  }
}

async function sendOtpEmail({ email, code, purpose, ttlMinutes }) {
  const { subject, html } = renderOtpEmail({ code, purpose, ttlMinutes });
  await sendEmailViaResend(email.toLowerCase(), subject, html);
}

async function sendWelcomeEmail({ email, firstName }) {
  const html = renderWelcomeEmail({ firstName });
  await sendEmailViaResend(
    email.toLowerCase(),
    "You're in — welcome to OreWire",
    html,
  );
}

/** Morning Brief public subscribe confirmation (no-reply@orewire.com). */
async function sendMorningBriefSubscribeEmail({ email }) {
  const { subject, html } = renderMorningBriefSubscribeEmail();
  await sendEmailViaResend(email.toLowerCase(), subject, html, FROM_EMAIL);
}

async function sendBriefingEmail({ email, subject, html }) {
  await sendEmailViaResend(email.toLowerCase(), subject, html, BRIEFING_FROM_EMAIL);
}

async function sendWatchlistAlertEmail({ email, subject, html }) {
  await sendEmailViaResend(email.toLowerCase(), subject, html, ALERTS_FROM_EMAIL);
}

/** @deprecated use sendWatchlistAlertEmail */
async function sendWatchlistNewsAlertEmail(opts) {
  return sendWatchlistAlertEmail(opts);
}

module.exports = {
  sendEmailViaResend,
  sendOtpEmail,
  sendWelcomeEmail,
  sendMorningBriefSubscribeEmail,
  sendBriefingEmail,
  sendWatchlistAlertEmail,
  sendWatchlistNewsAlertEmail,
};
