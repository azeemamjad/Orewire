const {
  C,
  SERIF,
  MONO,
  escapeHtml,
  emailConfig,
  emailDocument,
  emailHeaderRow,
  goldCtaButton,
  chip,
  cardLabel,
  tealDivider,
  watchlistContextBlock,
} = require('./layout');

function fmtExchange(ex) {
  if (!ex) return '';
  const u = (ex || '').toUpperCase();
  return u === 'TSXV' ? 'TSX-V' : ex;
}

function slugLabel(exchange, ticker) {
  const ex = fmtExchange(exchange);
  const tk = (ticker || '').toUpperCase();
  return ex && tk ? `${ex}: ${tk}` : tk || 'N/A';
}

function normalizeFilingType(filingType, displayType) {
  const raw = (displayType || filingType || 'Filing').trim();
  if (!raw) return 'Filing';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function verdictStyle(verdict) {
  const v = (verdict || '').toLowerCase();
  if (v === 'noteworthy') return { label: 'NOTEWORTHY', bg: C.teal };
  if (v === 'watch') return { label: 'WATCH', bg: '#B45309' };
  return { label: 'ROUTINE', bg: C.faint };
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

function keyFactsListHtml(facts) {
  if (!facts.length) return '';
  const items = facts.map((fact) =>
    `<li><span style="color:${C.teal};margin-right:8px;">·</span>${escapeHtml(fact)}</li>`,
  ).join('');
  return `${cardLabel('Key facts')}
    <ul style="margin:0;padding:0;list-style:none;font-size:13px;line-height:1.7;color:${C.text};">${items}</ul>`;
}

function renderWatchlistFilingAlertEmail(data) {
  const badge = verdictStyle(data.verdict);
  const tickerLine = slugLabel(data.exchange, data.ticker);
  const filingType = normalizeFilingType(data.filingType, data.displayType);
  const summary = (data.summary || '').trim();
  const keyFacts = parseKeyFacts(data.keyFacts);
  const verdictReason = (data.verdictReason || '').trim();

  const preheader = `${tickerLine} — ${filingType}`;

  const summaryCard = `
<tr><td style="padding:0 32px 24px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.tealBg};border-left:4px solid ${C.teal};border-radius:4px;"><tr>
  <td style="padding:18px 20px;">
    ${cardLabel('✦ AI Summary')}
    <p style="margin:0;font-size:14px;line-height:22px;color:${C.text};">${escapeHtml(summary || 'New filing on file for this watchlist company.')}</p>
    ${keyFacts.length ? `${tealDivider()}${keyFactsListHtml(keyFacts)}` : ''}
    ${verdictReason ? `${tealDivider()}${cardLabel('Why this matters')}<p style="margin:0;font-size:12px;color:${C.muted};font-style:italic;line-height:1.55;font-family:${SERIF};">${escapeHtml(verdictReason)}</p>` : ''}
  </td>
</tr></table>
</td></tr>`;

  const originalFiling = data.sedarUrl ? `
<tr><td style="padding:0 32px 20px 32px;">
  <p style="margin:0 0 10px 0;font-family:${SERIF};font-size:14px;font-weight:700;color:${C.navy};">Original filing</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.panel};border:1px solid ${C.border};border-radius:4px;"><tr>
  <td style="padding:16px 18px;">
    <p style="margin:0 0 6px 0;font-size:12px;line-height:1.8;"><span style="color:${C.muted};font-family:${MONO};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;margin-right:10px;">Filing type</span><span style="color:${C.text};font-weight:500;">${escapeHtml(filingType)}</span></p>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid ${C.border};">
      <a href="${escapeHtml(data.sedarUrl)}" style="color:${C.teal};text-decoration:none;font-weight:600;font-family:${MONO};font-size:11px;letter-spacing:0.05em;">VIEW ORIGINAL FILING ON SEDAR+ →</a>
    </div>
  </td>
</tr></table>
</td></tr>` : '';

  const body = `
${emailHeaderRow()}
<tr><td style="padding:32px 32px 20px 32px;background-color:${C.white};">
  <div style="margin-bottom:16px;">
    <span style="display:inline-block;background-color:${badge.bg};color:${C.white};font-family:${MONO};font-size:12px;font-weight:700;letter-spacing:0.12em;padding:4px 12px;border-radius:4px;">${escapeHtml(badge.label)}</span>
  </div>
  <div style="font-family:${MONO};font-size:20px;font-weight:700;color:${C.navy};margin-bottom:4px;letter-spacing:-0.01em;">${escapeHtml(tickerLine)}</div>
  <div style="font-family:${SERIF};font-size:16px;color:${C.muted};margin-bottom:10px;">${escapeHtml(data.companyName || '')}</div>
  <div style="margin-bottom:10px;">${chip(filingType)}</div>
</td></tr>
${summaryCard}
${originalFiling}
<tr><td style="padding:16px 32px 28px 32px;text-align:center;">
  ${goldCtaButton(data.summaryUrl, 'View full summary on OreWire →')}
  ${data.sedarUrl ? `<div style="margin-top:14px;"><a href="${escapeHtml(data.sedarUrl)}" style="font-size:12px;color:${C.teal};text-decoration:underline;font-weight:500;">View original filing on SEDAR+</a></div>` : ''}
</td></tr>
${watchlistContextBlock(data.ticker)}`;

  return emailDocument({
    title: 'Watchlist Filing Alert | OreWire',
    preheader,
    bodyRows: body,
  });
}

function filingAlertSubject(data) {
  const tickerLine = slugLabel(data.exchange, data.ticker);
  const filingType = normalizeFilingType(data.filingType, data.displayType);
  return `${tickerLine} — ${filingType}`;
}

module.exports = {
  renderWatchlistFilingAlertEmail,
  filingAlertSubject,
  normalizeFilingType,
  slugLabel,
};
