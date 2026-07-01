const {
  C,
  SERIF,
  MONO,
  escapeHtml,
  emailConfig,
  appBaseUrl,
  emailDocument,
  emailHeaderRow,
  goldCtaButton,
  cardLabel,
} = require('./layout');

function renderAdminCredentialsEmail({ firstName, tempPassword, isNewAccount }) {
  const cfg = emailConfig();
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const headline = isNewAccount ? 'Your OreWire account is ready' : 'Your password was reset';
  const intro = isNewAccount
    ? 'An administrator created an OreWire account for you. Sign in with the temporary password below.'
    : 'An administrator reset your OreWire password. Use the temporary password below to sign in.';
  const loginUrl = `${cfg.siteUrl || appBaseUrl().replace(/\/$/, '')}/login`;

  const body = `
${emailHeaderRow()}
<tr><td style="padding:48px 40px 16px 40px;background-color:${C.white};">
  <p style="margin:0 0 16px 0;font-family:${MONO};font-size:11px;color:${C.gold};letter-spacing:0.15em;text-transform:uppercase;">/// Account access</p>
  <h1 style="margin:0 0 16px 0;font-family:${SERIF};font-size:32px;line-height:1.2;font-weight:700;color:${C.navy};letter-spacing:-0.02em;">${headline}</h1>
  <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:${C.muted};">${greeting}</p>
  <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:${C.muted};">${intro}</p>
</td></tr>
<tr><td style="padding:0 40px 28px 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.panel};border-radius:6px;border:1px solid ${C.border};"><tr>
  <td style="padding:24px;text-align:center;">
    <p style="margin:0 0 10px 0;font-family:${MONO};font-size:11px;color:${C.muted};letter-spacing:0.1em;text-transform:uppercase;">Temporary password</p>
    <p style="margin:0 0 16px 0;font-family:${MONO};font-size:28px;font-weight:700;color:${C.navy};letter-spacing:0.12em;">${escapeHtml(tempPassword)}</p>
    <p style="margin:0;font-size:13px;color:${C.faint};">Change this after your first login.</p>
  </td>
</tr></table>
</td></tr>
<tr><td style="padding:8px 40px 28px 40px;text-align:center;">
  ${goldCtaButton(loginUrl, 'Sign in to OreWire →')}
  <p style="margin:16px 0 0 0;font-size:13px;color:${C.muted};line-height:1.55;">
    Update your password from <a href="${escapeHtml(cfg.profileUrl)}" style="color:${C.navy};text-decoration:underline;">profile settings</a>.
  </p>
</td></tr>
<tr><td style="padding:0 40px 28px 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.panel};border-radius:6px;border:1px solid ${C.border};"><tr>
  <td style="padding:20px;">
    ${cardLabel('⚑ Didn\'t request this?')}
    <p style="margin:0;font-size:13px;line-height:1.6;color:${C.muted};">
      If you didn't expect this email, contact your administrator or
      <a href="mailto:hello@orewire.com" style="color:${C.navy};text-decoration:underline;">hello@orewire.com</a>.
    </p>
  </td>
</tr></table>
</td></tr>`;

  return {
    subject: isNewAccount ? 'Your OreWire account credentials' : 'Your OreWire password was reset',
    html: emailDocument({
      title: headline,
      preheader: 'Your temporary OreWire password',
      bodyRows: body,
      showMarketingFooter: false,
    }),
  };
}

module.exports = { renderAdminCredentialsEmail };
