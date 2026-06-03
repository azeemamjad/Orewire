const { escapeHtml, emailConfig } = require('./email-templates');

function fmtExchange(ex) {
  if (!ex) return '';
  const u = (ex || '').toUpperCase();
  return u === 'TSXV' ? 'TSX-V' : ex;
}

function slugLabel(exchange, ticker) {
  const ex = fmtExchange(exchange);
  const tk = (ticker || '').toUpperCase();
  return ex && tk ? `${ex}: ${tk}` : tk || '—';
}

function normalizeFilingType(filingType, displayType) {
  const raw = (displayType || filingType || 'Filing').trim();
  if (!raw) return 'Filing';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function verdictBadge(verdict) {
  const v = (verdict || '').toLowerCase();
  if (v === 'noteworthy') return { emoji: '🟢', label: 'NOTEWORTHY', bg: '#2d8a8a' };
  if (v === 'watch') return { emoji: '🟡', label: 'WATCH', bg: '#b45309' };
  return { emoji: '📋', label: 'ROUTINE', bg: '#6b8a9e' };
}

function parseKeyFacts(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
  } catch {
    return [];
  }
}

function renderWatchlistFilingAlertEmail(data) {
  const cfg = emailConfig();
  const badge = verdictBadge(data.verdict);
  const tickerLine = slugLabel(data.exchange, data.ticker);
  const filingType = normalizeFilingType(data.filingType, data.displayType);
  const summary = (data.summary || '').trim();
  const keyFacts = parseKeyFacts(data.keyFacts);
  const verdictReason = (data.verdictReason || '').trim();

  const factsHtml = keyFacts.length
    ? `<tr>
        <td class="px" style="padding:18px 32px 4px 32px;">
          <div style="font-size:12px;font-weight:700;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.7px;padding-bottom:8px;">Key facts</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${keyFacts.map((fact) => `<tr><td style="padding:5px 0;font-size:14px;color:#1a1a1a;line-height:1.5;">
              <span style="color:#2d8a8a;font-weight:700;">›</span>&nbsp; ${escapeHtml(fact)}
            </td></tr>`).join('')}
          </table>
        </td>
      </tr>`
    : '';

  const verdictBlock = verdictReason
    ? `<tr>
        <td class="px" style="padding:18px 32px 4px 32px;">
          <div style="border-left:3px solid #2d8a8a;padding:6px 14px;font-style:italic;font-size:14px;color:#3a3a3a;line-height:1.55;background:#f4faf9;">
            ${escapeHtml(verdictReason.startsWith('Verdict:') ? verdictReason : `Verdict: ${verdictReason}`)}
          </div>
        </td>
      </tr>`
    : '';

  const preheader = `${badge.emoji} ${tickerLine} — ${filingType}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Watchlist alert — OreWire</title>
<style>
  @media (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .ticker { font-size: 26px !important; }
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
        <td class="px" style="padding:20px 32px 12px 32px;border-bottom:1px solid #f1ecdf;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:15px;font-weight:700;letter-spacing:0.4px;color:#0f1e3d;">Ore<span style="color:#d4a13a;">Wire</span></td>
            <td align="right" style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.6px;">Watchlist alert</td>
          </tr></table>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:26px 32px 8px 32px;">
          <div>
            <span style="display:inline-block;background:${badge.bg};color:#ffffff;font-size:12px;font-weight:700;padding:6px 14px;border-radius:99px;letter-spacing:0.5px;">${badge.emoji} ${escapeHtml(badge.label)}</span>
          </div>
          <div class="ticker" style="padding-top:14px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:30px;font-weight:700;color:#0f1e3d;letter-spacing:-0.5px;">${escapeHtml(tickerLine)}</div>
          <div style="padding-top:4px;font-size:16px;color:#1a2541;font-weight:600;">${escapeHtml(data.companyName || '')}</div>
          <div style="padding-top:6px;font-size:13px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(filingType)}</div>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:18px 32px 4px 32px;">
          <div style="font-size:15px;color:#1a1a1a;line-height:1.6;">${escapeHtml(summary || 'New filing on file for this watchlist company.')}</div>
        </td>
      </tr>
      ${factsHtml}
      ${verdictBlock}
      <tr>
        <td class="px" align="left" style="padding:24px 32px 6px 32px;">
          <a href="${escapeHtml(data.summaryUrl)}" style="display:inline-block;background:#d4a13a;color:#1a2541;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:6px;letter-spacing:0.2px;">Read full summary on OreWire →</a>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding:10px 32px 28px 32px;">
          <a href="${escapeHtml(data.sedarUrl)}" style="font-size:13px;color:#2d8a8a;text-decoration:none;font-weight:600;">View original filing on SEDAR+ →</a>
        </td>
      </tr>
      <tr>
        <td class="px" style="background:#efece6;padding:22px 32px;border-top:1px solid #e3ddcd;">
          <div style="font-size:12px;color:#6b6b6b;line-height:1.6;">
            You're receiving this because <span style="font-family:'SF Mono',Menlo,Consolas,monospace;color:#1a2541;">${escapeHtml((data.ticker || '').toUpperCase())}</span> is on your watchlist.
            &nbsp;<a href="${escapeHtml(cfg.watchlistUrl)}" style="color:#2d8a8a;text-decoration:underline;font-weight:600;">Manage watchlist →</a>
          </div>
          <div style="padding-top:10px;font-size:12px;">
            <a href="${escapeHtml(cfg.unsubscribeUrl)}" style="color:#6b6b6b;text-decoration:underline;">Unsubscribe from alerts</a>
            &nbsp;·&nbsp;
            <a href="${escapeHtml(cfg.profileUrl)}" style="color:#6b6b6b;text-decoration:underline;">Manage preferences</a>
          </div>
          <div style="padding-top:14px;font-size:11px;color:#9a9384;">Not investment advice. © ${cfg.year} OreWire</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function filingAlertSubject(data) {
  const badge = verdictBadge(data.verdict);
  const tickerLine = slugLabel(data.exchange, data.ticker);
  const filingType = normalizeFilingType(data.filingType, data.displayType);
  return `${badge.emoji} ${tickerLine} — ${filingType}`;
}

module.exports = {
  renderWatchlistFilingAlertEmail,
  filingAlertSubject,
  normalizeFilingType,
  slugLabel,
};
