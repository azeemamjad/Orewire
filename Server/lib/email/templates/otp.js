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
} = require('./layout');

const OTP_COPY = {
  register: {
    kicker: '/// Confirm your email',
    kickerColor: C.teal,
    headline: 'Verify your email address',
    intro: 'Thanks for creating an OreWire account. Enter the code below to confirm your email and activate your access to AI-translated mining intelligence.',
    subject: 'Your OreWire verification code',
    ctaLabel: 'Confirm email address →',
  },
  login_2fa: {
    kicker: '/// Sign-in verification',
    kickerColor: C.teal,
    headline: 'Verify your sign-in',
    intro: 'Enter the code below to sign in to your OreWire account.',
    subject: 'Your OreWire sign-in code',
    ctaLabel: 'Continue to OreWire →',
  },
  reset_password: {
    kicker: '/// Account security',
    kickerColor: C.gold,
    headline: 'Reset your password',
    intro: 'We received a request to reset the password for your OreWire account. Enter the code below to choose a new password.',
    subject: 'Your OreWire password reset code',
    ctaLabel: 'Reset password →',
  },
};

function renderOtpEmail({ code, purpose, ttlMinutes }) {
  const copy = OTP_COPY[purpose] || OTP_COPY.register;
  const safeCode = escapeHtml(code);
  const cfg = emailConfig();
  const loginUrl = `${cfg.siteUrl || appBaseUrl().replace(/\/$/, '')}/login`;

  const body = `
${emailHeaderRow()}
<tr><td style="padding:48px 40px 16px 40px;background-color:${C.white};">
  <p style="margin:0 0 16px 0;font-family:${MONO};font-size:11px;color:${copy.kickerColor};letter-spacing:0.15em;text-transform:uppercase;">${copy.kicker}</p>
  <h1 style="margin:0 0 16px 0;font-family:${SERIF};font-size:32px;line-height:1.2;font-weight:700;color:${C.navy};letter-spacing:-0.02em;">${copy.headline}</h1>
  <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:${C.muted};">${copy.intro}</p>
</td></tr>
<tr><td style="padding:0 40px 28px 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.panel};border-radius:6px;border:1px solid ${C.border};"><tr>
  <td style="padding:24px;text-align:center;">
    <p style="margin:0 0 10px 0;font-family:${MONO};font-size:11px;color:${C.muted};letter-spacing:0.1em;text-transform:uppercase;">Your confirmation code</p>
    <p style="margin:0 0 16px 0;font-family:${MONO};font-size:42px;font-weight:700;color:${C.navy};letter-spacing:0.18em;">${safeCode}</p>
    <p style="margin:0;font-size:13px;color:${C.faint};">Code expires in ${ttlMinutes} minutes.</p>
  </td>
</tr></table>
</td></tr>
<tr><td style="padding:8px 40px 28px 40px;text-align:center;">
  ${goldCtaButton(loginUrl, copy.ctaLabel)}
</td></tr>
<tr><td style="padding:0 40px;"><div style="border-top:1px solid ${C.border};line-height:1px;font-size:0;">&nbsp;</div></td></tr>
<tr><td style="padding:28px 40px 48px 40px;">
  <p style="margin:0 0 8px 0;font-family:${SERIF};font-size:16px;font-weight:700;color:${C.navy};">Didn't sign up?</p>
  <p style="margin:0;font-size:14px;line-height:1.6;color:${C.muted};">
    You can safely ignore this email. If someone is using your address without permission,
    <a href="mailto:hello@orewire.com" style="color:${C.navy};text-decoration:underline;">contact us</a> and we'll investigate.
  </p>
</td></tr>`;

  return {
    subject: copy.subject,
    html: emailDocument({
      title: copy.headline,
      preheader: `Your verification code is ${safeCode}`,
      bodyRows: body,
      showMarketingFooter: false,
    }),
  };
}

module.exports = { renderOtpEmail };
