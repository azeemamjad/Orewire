/**
 * OreWire transactional email HTML (matches brand templates).
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appBaseUrl() {
  const domain = (process.env.FRONTEND_DOMAIN || 'orewire.com').replace(/^https?:\/\//, '');
  return process.env.APP_URL || `https://${domain}`;
}

function emailConfig() {
  const base = appBaseUrl().replace(/\/$/, '');
  return {
    feedUrl: process.env.EMAIL_FEED_URL || `${base}/`,
    watchlistUrl: process.env.EMAIL_WATCHLIST_URL || `${base}/watchlist`,
    profileUrl: process.env.EMAIL_PREFERENCES_URL || `${base}/profile`,
    unsubscribeUrl: process.env.EMAIL_UNSUBSCRIBE_URL || `${base}/profile`,
    xUrl: process.env.EMAIL_X_URL || 'https://x.com/orewire',
    linkedinUrl: process.env.EMAIL_LINKEDIN_URL || 'https://www.linkedin.com/company/orewire',
    year: String(new Date().getFullYear()),
  };
}

function emailShell({ preheader, innerHtml, showMarketingFooter = true }) {
  const cfg = emailConfig();
  const footerLinks = showMarketingFooter
    ? `
          <div style="padding-top:12px;font-size:12px;">
            <a href="${escapeHtml(cfg.xUrl)}" style="color:#1a2541;text-decoration:none;font-weight:600;">X</a>
            &nbsp;·&nbsp;
            <a href="${escapeHtml(cfg.linkedinUrl)}" style="color:#1a2541;text-decoration:none;font-weight:600;">LinkedIn</a>
          </div>
          <div style="padding-top:10px;font-size:12px;">
            <a href="${escapeHtml(cfg.unsubscribeUrl)}" style="color:#6b6b6b;text-decoration:underline;">Unsubscribe</a>
            &nbsp;·&nbsp;
            <a href="${escapeHtml(cfg.profileUrl)}" style="color:#6b6b6b;text-decoration:underline;">Manage preferences</a>
          </div>
          <div style="padding-top:14px;font-size:11px;color:#9a9384;">Not investment advice. © ${cfg.year} OreWire</div>`
    : `
          <div style="padding-top:14px;font-size:11px;color:#9a9384;">Not investment advice. © ${cfg.year} OreWire</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>OreWire</title>
<style>
  @media (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
  }
  a { color: #2d8a8a; }
</style>
</head>
<body style="margin:0;padding:0;background:#faf7f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f1;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #ece7dc;">
      <tr>
        <td class="px" style="background:#0f1e3d;padding:26px 32px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">
            Ore<span style="color:#d4a13a;">Wire</span>
          </div>
        </td>
      </tr>
      ${innerHtml}
      <tr>
        <td class="px" style="background:#efece6;padding:22px 32px;border-top:1px solid #e3ddcd;">
          ${footerLinks}
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Confirmation email - Morning Brief newsletter signup (public subscribe bar). */
function renderMorningBriefSubscribeEmail() {
  const cfg = emailConfig();

  const inner = `
      <tr>
        <td class="px" style="padding:32px 32px 0 32px;">
          <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#6b6b6b;margin-bottom:14px;">/// Morning brief</div>
          <div style="font-size:28px;font-weight:700;color:#0f1e3d;letter-spacing:-0.4px;line-height:1.15;">You're on the list.</div>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:18px 32px 0 32px;">
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#1a1a1a;">
            Thanks for subscribing to the <strong style="color:#0f1e3d;">Morning Brief</strong> - OreWire's daily summary of the mining market, delivered before the open.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background:#faf7f1;border:1px solid #ece7dc;border-radius:8px;">
            <tr>
              <td style="padding:18px 20px;">
                <div style="font-size:13px;font-weight:700;color:#0f1e3d;margin-bottom:8px;">What you'll get</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="padding:6px 0;font-size:14px;line-height:1.55;color:#1a1a1a;">
                    <span style="color:#d4a13a;font-weight:700;">→</span>&nbsp;&nbsp;The day's most important filings - summarized and scored
                  </td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;line-height:1.55;color:#1a1a1a;">
                    <span style="color:#d4a13a;font-weight:700;">→</span>&nbsp;&nbsp;Delivered to your inbox by <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-weight:600;">7:30am ET</span>
                  </td></tr>
                  <tr><td style="padding:6px 0;font-size:14px;line-height:1.55;color:#1a1a1a;">
                    <span style="color:#d4a13a;font-weight:700;">→</span>&nbsp;&nbsp;Free subscribers see the top 3 items; upgrade anytime for the full digest
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 6px 0;font-size:15px;line-height:1.65;color:#1a1a1a;">
            Your first briefing will arrive on the next trading morning. Until then, browse live filings and news on the site.
          </p>
        </td>
      </tr>
      <tr>
        <td class="px" align="left" style="padding:26px 32px 10px 32px;">
          <a href="${escapeHtml(cfg.feedUrl)}" style="display:inline-block;background:#d4a13a;color:#1a2541;font-size:15px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:6px;letter-spacing:0.2px;">Explore the feed →</a>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:8px 32px 32px 32px;">
          <div style="font-size:12px;color:#6b6b6b;line-height:1.6;">
            Not useful? You can unsubscribe in one click from any briefing email or your
            <a href="${escapeHtml(cfg.profileUrl)}" style="color:#2d8a8a;text-decoration:underline;">preferences</a>.
          </div>
        </td>
      </tr>`;

  return {
    subject: "You're subscribed to the Morning Brief",
    html: emailShell({
      preheader: 'Your first briefing arrives by 7:30am ET - mining filings summarized before the open.',
      innerHtml: inner,
      showMarketingFooter: true,
    }),
  };
}

/** Welcome email - sent after email verification (registration complete). */
function renderWelcomeEmail({ firstName } = {}) {
  const cfg = emailConfig();
  const greeting = firstName ? escapeHtml(firstName) : 'there';

  const inner = `
      <tr>
        <td class="px" style="padding:36px 32px 8px 32px;">
          <div style="font-size:26px;font-weight:700;color:#0f1e3d;letter-spacing:-0.3px;">You're in.</div>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:14px 32px 0 32px;">
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#1a1a1a;">
            Hi ${greeting} - OreWire monitors <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-weight:600;">2,000+</span> mining companies across Canada and Australia - every filing, every news release - so you don't have to.
          </p>
          <p style="margin:0 0 8px 0;font-size:15px;line-height:1.65;color:#1a1a1a;font-weight:600;">
            Here's what happens next:
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;">
            <tr><td style="padding:8px 0;font-size:15px;color:#1a1a1a;line-height:1.55;">
              <span style="color:#d4a13a;font-weight:700;">①</span>&nbsp;&nbsp;Your daily briefing arrives every morning at <span style="font-family:'SF Mono',Menlo,Consolas,monospace;">7:30am ET</span>.
            </td></tr>
            <tr><td style="padding:8px 0;font-size:15px;color:#1a1a1a;line-height:1.55;">
              <span style="color:#d4a13a;font-weight:700;">②</span>&nbsp;&nbsp;Browse the live feed at <a href="${escapeHtml(cfg.feedUrl)}" style="color:#2d8a8a;text-decoration:none;font-weight:600;">orewire.com</a>.
            </td></tr>
            <tr><td style="padding:8px 0;font-size:15px;color:#1a1a1a;line-height:1.55;">
              <span style="color:#d4a13a;font-weight:700;">③</span>&nbsp;&nbsp;<a href="${escapeHtml(cfg.watchlistUrl)}" style="color:#2d8a8a;text-decoration:none;font-weight:600;">Add companies to your watchlist</a> for instant alerts.
            </td></tr>
          </table>
          <p style="margin:0 0 6px 0;font-size:15px;line-height:1.65;color:#1a1a1a;">
            That's it. No tabs to refresh, no SEDAR filings to dig through.
          </p>
        </td>
      </tr>
      <tr>
        <td class="px" align="left" style="padding:28px 32px 36px 32px;">
          <a href="${escapeHtml(cfg.feedUrl)}" style="display:inline-block;background:#d4a13a;color:#1a2541;font-size:15px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:6px;letter-spacing:0.2px;">Explore the feed →</a>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:0 32px 8px 32px;">
          <div style="font-size:12px;color:#6b6b6b;line-height:1.6;">
            Welcome aboard, from the <strong style="color:#1a2541;">OreWire</strong> team.
          </div>
        </td>
      </tr>`;

  return emailShell({
    preheader: "You're in. Here's what happens next.",
    innerHtml: inner,
    showMarketingFooter: true,
  });
}

const OTP_COPY = {
  register: {
    headline: 'Verify your email',
    action: 'complete your OreWire registration',
    subject: 'Your OreWire verification code',
  },
  login_2fa: {
    headline: 'Sign-in verification',
    action: 'sign in to your OreWire account',
    subject: 'Your OreWire sign-in code',
  },
  reset_password: {
    headline: 'Reset your password',
    action: 'reset your OreWire password',
    subject: 'Your OreWire password reset code',
  },
};

/** Branded OTP / verification code email. */
function renderOtpEmail({ code, purpose, ttlMinutes }) {
  const copy = OTP_COPY[purpose] || OTP_COPY.register;
  const safeCode = escapeHtml(code);

  const inner = `
      <tr>
        <td class="px" style="padding:36px 32px 8px 32px;">
          <div style="font-size:26px;font-weight:700;color:#0f1e3d;letter-spacing:-0.3px;">${copy.headline}</div>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:14px 32px 0 32px;">
          <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:#1a1a1a;">
            Enter this code to ${escapeHtml(copy.action)}:
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" style="background:#faf7f1;border:1px solid #ece7dc;border-radius:8px;padding:22px 16px;">
                <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0f1e3d;">${safeCode}</div>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;color:#6b6b6b;">
            This code expires in <strong style="color:#1a1a1a;">${ttlMinutes} minutes</strong>. If you didn't request it, you can safely ignore this email.
          </p>
        </td>
      </tr>`;

  return {
    subject: copy.subject,
    html: emailShell({
      preheader: `Your verification code is ${safeCode}`,
      innerHtml: inner,
      showMarketingFooter: false,
    }),
  };
}

module.exports = {
  escapeHtml,
  emailConfig,
  renderMorningBriefSubscribeEmail,
  renderWelcomeEmail,
  renderOtpEmail,
  appBaseUrl,
};
