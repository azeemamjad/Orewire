const {
  C,
  SERIF,
  MONO,
  emailConfig,
  emailDocument,
  emailHeaderRow,
  goldCtaButton,
  featureRow,
  numberedItem,
} = require('./layout');

function renderWelcomeEmail() {
  const cfg = emailConfig();

  const body = `
${emailHeaderRow()}
<tr><td style="padding:48px 40px 8px 40px;background-color:${C.white};">
  <p style="margin:0 0 16px 0;font-family:${MONO};font-size:11px;color:${C.gold};letter-spacing:0.15em;text-transform:uppercase;">/// Welcome aboard</p>
  <h1 style="margin:0 0 20px 0;font-family:${SERIF};font-size:34px;line-height:1.15;font-weight:700;color:${C.navy};letter-spacing:-0.02em;">Welcome to OreWire.</h1>
  <p style="margin:0 0 32px 0;font-size:16px;line-height:1.6;color:${C.muted};">
    You now have access to AI-translated mining intelligence from 2,000+ companies across the TSX, TSX-V, CSE, and ASX.
  </p>
  <p style="margin:0 0 24px 0;font-family:${SERIF};font-size:18px;font-weight:700;color:${C.navy};">Here's what you get:</p>
</td></tr>
<tr><td style="padding:0 40px 8px 40px;">
  ${featureRow('01', '📬', 'Morning briefing', 'Every weekday at 7:30am ET. The most important filings and news releases, summarized and scored before the market opens.')}
  ${featureRow('02', '🔔', 'Watchlist alerts', 'Add companies you follow. When they publish a news release or file a regulatory document, you get an email with the full AI summary within the hour.')}
  ${featureRow('03', '✦', 'Live feed', 'Every filing and news release translated in real time. Filter by exchange, commodity, or significance on orewire.com.')}
</td></tr>
<tr><td style="padding:32px 40px 40px 40px;text-align:center;">
  ${goldCtaButton(cfg.feedUrl, 'Explore the feed →')}
</td></tr>
<tr><td style="padding:0 40px;"><div style="border-top:1px solid ${C.border};line-height:1px;font-size:0;">&nbsp;</div></td></tr>
<tr><td style="padding:32px 40px 8px 40px;">
  <p style="margin:0 0 20px 0;font-family:${SERIF};font-size:20px;font-weight:700;color:${C.navy};">Start here:</p>
  ${numberedItem('1', "Browse today's feed and see what has been filed in the last 24 hours.")}
  ${numberedItem('2', 'Add companies to your watchlist from any company page.')}
  ${numberedItem('3', 'Check your inbox tomorrow morning at 7:30am ET for your first briefing.')}
</td></tr>
<tr><td style="padding:32px 40px 48px 40px;text-align:center;">
  <p style="margin:0;font-size:14px;color:${C.muted};line-height:1.6;">
    Questions? <a href="mailto:hello@orewire.com" style="color:${C.navy};text-decoration:underline;">Reply to this email.</a>
  </p>
</td></tr>`;

  return emailDocument({
    title: 'Welcome to OreWire',
    preheader: "You're in. Your first briefing arrives at 7:30am ET.",
    bodyRows: body,
  });
}

module.exports = { renderWelcomeEmail };
