/**
 * OreWire email layout — shared brand shell (matches OreWire Emails/ Loveable designs).
 */

const SERIF = "'Source Serif Pro', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, monospace";

const C = {
  navy: '#0B1220',
  gold: '#E8A93A',
  goldSoft: '#FBF3DF',
  cream: '#F5F1E8',
  white: '#ffffff',
  text: '#1A2333',
  muted: '#5A6473',
  faint: '#8A93A3',
  border: '#E5E0D5',
  panel: '#F4F1EA',
  teal: '#0E7C6B',
  tealBg: '#E6F4F1',
  green: '#0E8A4F',
  red: '#C8392E',
};

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
    xUrl: process.env.EMAIL_X_URL || 'https://x.com/Orewirenews',
    linkedinUrl: process.env.EMAIL_LINKEDIN_URL || 'https://www.linkedin.com/company/orewire/',
    instagramUrl: process.env.EMAIL_INSTAGRAM_URL || 'https://www.instagram.com/orewirenews',
    siteUrl: base,
    year: String(new Date().getFullYear()),
  };
}

function logoMarkHtml() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="background-color:${C.navy};width:32px;height:32px;border-radius:4px;text-align:center;vertical-align:middle;font-family:${SERIF};font-weight:700;font-size:20px;color:${C.white};line-height:32px;">O</td>
  <td style="padding-left:10px;vertical-align:middle;white-space:nowrap;">
    <span style="font-family:${SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:-0.01em;">OreWire</span>
  </td>
</tr></table>`;
}

function emailHeaderRow(rightHtml = '') {
  const right = rightHtml
    ? `<td style="text-align:right;vertical-align:middle;">${rightHtml}</td>`
    : '';
  return `<tr>
  <td style="background-color:${C.white};padding:20px 32px;border-bottom:1px solid ${C.border};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="vertical-align:middle;">${logoMarkHtml()}</td>
      ${right}
    </tr></table>
  </td>
</tr>`;
}

function socialLinksHtml(cfg) {
  const igSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:9px auto;"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`;
  const btn = (href, inner) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;width:36px;height:36px;border:1px solid ${C.border};border-radius:4px;text-align:center;line-height:36px;font-family:Arial,sans-serif;font-weight:700;color:${C.navy};text-decoration:none;background-color:${C.white};">${inner}</a>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;"><tr>
  <td>${btn(cfg.xUrl, '𝕏')}</td>
  <td style="padding-left:8px;">${btn(cfg.linkedinUrl, 'in')}</td>
  <td style="padding-left:8px;">${btn(cfg.instagramUrl, igSvg)}</td>
</tr></table>`;
}

function emailFooterRows({ showPreferences = true } = {}) {
  const cfg = emailConfig();
  const prefLinks = showPreferences
    ? `<p style="margin:0;font-size:12px;">
        <a href="${escapeHtml(cfg.profileUrl)}" style="color:${C.muted};text-decoration:underline;margin-right:18px;">Manage preferences</a>
        <a href="${escapeHtml(cfg.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a>
      </p>`
    : '';

  return `<tr>
  <td style="background-color:${C.cream};padding:36px 32px 28px 32px;border-top:1px solid ${C.border};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background-color:${C.navy};width:32px;height:32px;border-radius:4px;text-align:center;vertical-align:middle;font-family:${SERIF};font-weight:700;font-size:20px;color:${C.white};line-height:32px;">O</td>
      <td style="padding-left:12px;vertical-align:middle;">
        <span style="font-family:${SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:-0.01em;">OreWire</span>
      </td>
    </tr></table>
    <p style="margin:22px 0 14px 0;font-family:${SERIF};font-size:22px;line-height:1.25;font-weight:700;color:${C.navy};letter-spacing:-0.01em;">
      Mining and resource data, news, and filings. All in one place.
    </p>
    <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:${C.muted};">
      Stock prices, decoded filings, news release summaries, market news and data for 2,000+ mining and resource companies across Canada and Australia.
    </p>
    <p style="margin:0 0 18px 0;font-family:${MONO};font-size:11px;color:${C.muted};letter-spacing:0.18em;">
      TSX&nbsp;&nbsp;·&nbsp;&nbsp;TSX&#8209;V&nbsp;&nbsp;·&nbsp;&nbsp;CSE&nbsp;&nbsp;·&nbsp;&nbsp;ASX
    </p>
    ${socialLinksHtml(cfg)}
    ${prefLinks}
  </td>
</tr>
<tr>
  <td style="background-color:${C.navy};padding:18px 32px;">
    <p style="margin:0 0 10px 0;font-size:11px;line-height:1.65;color:#94A0B5;">
      <span style="font-family:${MONO};color:#7A8699;letter-spacing:0.12em;margin-right:8px;">DISCLAIMER</span>
      This platform provides information for educational purposes only. Nothing constitutes investment advice. Always do your own due diligence.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="font-family:${MONO};font-size:11px;color:#7A8699;">© ${cfg.year} OreWire Inc.</td>
      <td style="font-family:${MONO};font-size:11px;color:#7A8699;text-align:right;">
        <a href="${escapeHtml(cfg.siteUrl)}" style="color:#7A8699;text-decoration:none;">orewire.com</a>
      </td>
    </tr></table>
  </td>
</tr>`;
}

function emailDocument({ title, preheader, bodyRows, showMarketingFooter = true }) {
  const footer = emailFooterRows({ showPreferences: showMarketingFooter });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;600;700&amp;display=swap" rel="stylesheet">
<style>
  @media (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .qcol { display: block !important; width: 100% !important; }
  }
  a { color: ${C.teal}; }
</style>
</head>
<body style="margin:0;padding:0;background:${C.cream};font-family:${SANS};color:${C.text};-webkit-font-smoothing:antialiased;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.cream};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;margin:0 auto;background-color:${C.white};border-collapse:collapse;font-family:${SANS};color:${C.text};">
<tbody>
${bodyRows}
${footer}
</tbody>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function goldCtaButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
  <td style="background-color:${C.gold};border-radius:6px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:15px;font-weight:600;color:${C.navy};text-decoration:none;letter-spacing:0.01em;">${label}</a>
  </td>
</tr></table>`;
}

function chip(label) {
  return `<span style="display:inline-block;background-color:${C.white};color:${C.muted};font-family:${MONO};font-size:9px;font-weight:600;letter-spacing:0.1em;padding:2px 7px;border:1px solid ${C.border};border-radius:3px;margin-right:4px;vertical-align:middle;">${escapeHtml(label)}</span>`;
}

function pill(label, bg = C.teal, fg = C.white) {
  return `<span style="display:inline-block;background-color:${bg};color:${fg};font-family:${MONO};font-size:9px;font-weight:700;letter-spacing:0.1em;padding:3px 8px;border-radius:3px;vertical-align:middle;">${escapeHtml(label)}</span>`;
}

function cardLabel(text) {
  return `<div style="font-family:${MONO};font-size:11px;font-weight:700;color:${C.muted};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">${text}</div>`;
}

function tealDivider() {
  return `<div style="border-top:1px solid ${C.teal}33;margin:16px 0;line-height:1px;font-size:0;">&nbsp;</div>`;
}

function featureRow(num, icon, title, body) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:12px;border:1px solid ${C.border};border-radius:4px;background-color:${C.white};"><tr>
  <td style="padding:20px;vertical-align:top;width:60px;">
    <div style="font-family:${MONO};font-size:11px;color:${C.muted};letter-spacing:0.1em;margin-bottom:8px;">${escapeHtml(num)}</div>
    <div style="font-size:22px;color:${C.gold};line-height:1;">${icon}</div>
  </td>
  <td style="padding:20px 20px 20px 4px;vertical-align:top;">
    <p style="margin:0 0 6px 0;font-family:${SERIF};font-size:17px;font-weight:700;color:${C.navy};">${escapeHtml(title)}</p>
    <p style="margin:0;font-size:14px;line-height:1.55;color:${C.muted};">${body}</p>
  </td>
</tr></table>`;
}

function numberedItem(n, text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:12px;"><tr>
  <td style="width:32px;vertical-align:top;">
    <div style="font-family:${MONO};font-size:12px;color:${C.gold};font-weight:700;letter-spacing:0.05em;padding-top:2px;">0${escapeHtml(n)}</div>
  </td>
  <td style="vertical-align:top;">
    <p style="margin:0;font-size:15px;line-height:1.55;color:${C.text};">${text}</p>
  </td>
</tr></table>`;
}

function watchlistContextBlock(ticker) {
  const cfg = emailConfig();
  const tk = escapeHtml((ticker || '').toUpperCase());
  return `<tr><td style="padding:0 32px 28px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.panel};border-radius:6px;"><tr>
  <td style="padding:14px 16px;text-align:center;">
    <p style="margin:0 0 6px 0;font-size:11px;color:${C.muted};">
      You are receiving this because <span style="font-family:${MONO};font-weight:700;color:${C.navy};">${tk}</span> is on your watchlist.
    </p>
    <p style="margin:0;font-size:11px;">
      <a href="${escapeHtml(cfg.watchlistUrl)}" style="color:${C.teal};text-decoration:none;font-weight:600;">Manage watchlist</a>
      <span style="color:${C.faint};margin:0 8px;">·</span>
      <a href="${escapeHtml(cfg.profileUrl)}" style="color:${C.teal};text-decoration:none;font-weight:600;">Alert settings</a>
    </p>
  </td>
</tr></table>
</td></tr>`;
}

function fmtPctChange(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return `<span style="color:${C.faint};">—</span>`;
  const n = Number(pct);
  const positive = n >= 0;
  const color = positive ? C.green : C.red;
  return `<span style="color:${color};font-weight:700;">${positive ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%</span>`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = {
  C,
  SERIF,
  SANS,
  MONO,
  escapeHtml,
  appBaseUrl,
  emailConfig,
  emailDocument,
  emailHeaderRow,
  emailFooterRows,
  goldCtaButton,
  chip,
  pill,
  cardLabel,
  tealDivider,
  featureRow,
  numberedItem,
  watchlistContextBlock,
  fmtPctChange,
  chunk,
};
