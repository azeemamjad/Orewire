const {
  C,
  MONO,
  SERIF,
  escapeHtml,
  emailConfig,
  emailDocument,
  emailHeaderRow,
  goldCtaButton,
  featureRow,
} = require('./layout');

function renderMorningBriefSubscribeEmail() {
  const cfg = emailConfig();

  const body = `
${emailHeaderRow()}
<tr><td style="padding:48px 40px 8px 40px;background-color:${C.white};">
  <p style="margin:0 0 16px 0;font-family:${MONO};font-size:11px;color:${C.gold};letter-spacing:0.15em;text-transform:uppercase;">/// Morning brief</p>
  <h1 style="margin:0 0 20px 0;font-family:${SERIF};font-size:34px;line-height:1.15;font-weight:700;color:${C.navy};letter-spacing:-0.02em;">You're on the list.</h1>
  <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:${C.muted};">
    Thanks for subscribing to the <strong style="color:${C.navy};">Morning Brief</strong> — OreWire's daily summary of the mining market, delivered before the open.
  </p>
</td></tr>
<tr><td style="padding:0 40px 8px 40px;">
  ${featureRow('01', '📬', 'Morning briefing', 'Every weekday at <span style="font-family:' + MONO + ';font-weight:600;">7:30am ET</span>. The most important filings and news releases, summarized and scored before the market opens.')}
  ${featureRow('02', '🔔', 'Watchlist alerts', 'Add companies you follow. When they publish a news release or file a regulatory document, you get an email with the full AI summary within the hour.')}
  ${featureRow('03', '✦', 'Live feed', 'Every filing and news release translated in real time. Filter by exchange, commodity, or significance on orewire.com.')}
</td></tr>
<tr><td style="padding:32px 40px 40px 40px;text-align:center;">
  ${goldCtaButton(cfg.feedUrl, 'Explore the feed →')}
  <p style="margin:20px 0 0 0;font-size:12px;color:${C.muted};line-height:1.6;">
    Your first briefing arrives on the next trading morning. Not useful?
    <a href="${escapeHtml(cfg.unsubscribeUrl)}" style="color:${C.navy};text-decoration:underline;">Unsubscribe</a> anytime.
  </p>
</td></tr>`;

  return {
    subject: "You're subscribed to the Morning Brief",
    html: emailDocument({
      title: 'Morning Brief — OreWire',
      preheader: 'Your first briefing arrives by 7:30am ET — mining filings summarized before the open.',
      bodyRows: body,
    }),
  };
}

module.exports = { renderMorningBriefSubscribeEmail };
