const {
  C,
  SERIF,
  MONO,
  escapeHtml,
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
  return ex && tk ? `${ex}: ${tk}` : tk || '—';
}

function headlineTypeFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('drill') && (t.includes('result') || t.includes('assay') || t.includes('intercept'))) return 'DRILL RESULTS';
  if (t.includes('resource') && (t.includes('update') || t.includes('estimate'))) return 'RESOURCE UPDATE';
  if (t.includes('feasibility') || t.includes('technical report') || t.includes('43-101')) return 'TECHNICAL REPORT';
  if (t.includes('placement') || t.includes('financing') || t.includes('bought deal')) return 'FINANCING';
  if (t.includes('acquisition') || t.includes('merger')) return 'M&A';
  if (t.includes('permit') || t.includes('approval')) return 'PERMIT UPDATE';
  if (t.includes('quarter') || /\bq[1-4]\b/.test(t)) return 'QUARTERLY UPDATE';
  if (t.includes('offtake') || t.includes('agreement')) return 'COMMERCIAL AGREEMENT';
  return 'NEWS RELEASE';
}

function sentimentStyle(sentiment) {
  const s = (sentiment || 'neutral').toLowerCase();
  if (s === 'bullish') return { label: 'NOTEWORTHY', bg: C.teal };
  if (s === 'bearish') return { label: 'WATCH', bg: '#C8392E' };
  return { label: 'NEWS', bg: C.faint };
}

function splitKeyFacts(summary, max = 3) {
  if (!summary) return [];
  const parts = summary
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);
  if (parts.length <= 1) return [];
  return parts.slice(0, max);
}

function verdictText(sentiment, summary) {
  const s = (sentiment || 'neutral').toLowerCase();
  const tail = (summary || '').trim();
  if (s === 'bullish') {
    return tail
      ? `Positive signal for watchlist holders — ${tail}`
      : 'Positive signal for watchlist holders based on this release.';
  }
  if (s === 'bearish') {
    return tail
      ? `Worth monitoring closely — ${tail}`
      : 'Worth monitoring closely; review the full release on OreWire.';
  }
  return tail || 'Review the full summary on OreWire for investor context.';
}

function renderWatchlistNewsAlertEmail(data) {
  const badge = sentimentStyle(data.sentiment);
  const tickerLine = slugLabel(data.exchange, data.ticker);
  const headlineType = headlineTypeFromTitle(data.title);
  const summary = (data.summary || data.description || data.title || '').trim();
  const keyFacts = splitKeyFacts(summary);
  const whyText = verdictText(data.sentiment, summary);

  const preheader = `${tickerLine} — ${headlineType}`;

  const keyFactsHtml = keyFacts.length
    ? `${tealDivider()}${cardLabel('Key facts')}
      <ul style="margin:0;padding:0;list-style:none;font-size:13px;line-height:1.7;color:${C.text};">
        ${keyFacts.map((fact) => `<li><span style="color:${C.teal};margin-right:8px;">·</span>${escapeHtml(fact)}</li>`).join('')}
      </ul>`
    : '';

  const summaryCard = `
<tr><td style="padding:0 32px 24px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.tealBg};border-left:4px solid ${C.teal};border-radius:4px;"><tr>
  <td style="padding:18px 20px;">
    ${cardLabel('✦ AI Summary')}
    <p style="margin:0;font-size:14px;line-height:22px;color:${C.text};">${escapeHtml(summary)}</p>
    ${keyFactsHtml}
    ${tealDivider()}
    ${cardLabel('Why this matters')}
    <p style="margin:0;font-size:12px;color:${C.muted};font-style:italic;line-height:1.55;font-family:${SERIF};">${escapeHtml(whyText)}</p>
  </td>
</tr></table>
</td></tr>`;

  const fullRelease = data.title ? `
<tr><td style="padding:0 32px 24px 32px;">
  <p style="margin:0 0 10px 0;font-family:${SERIF};font-size:14px;font-weight:700;color:${C.navy};">Full news release</p>
  <div style="background-color:${C.panel};border:1px solid ${C.border};border-radius:4px;padding:16px 18px;font-size:12px;line-height:1.7;color:${C.text};">
    <p style="margin:0 0 10px 0;font-weight:700;color:${C.navy};">${escapeHtml(data.title)}</p>
    <p style="margin:0 0 12px 0;">${escapeHtml(summary)}</p>
    <p style="margin:0;">
      <a href="${escapeHtml(data.summaryUrl)}" style="color:${C.teal};text-decoration:none;font-weight:600;font-family:${MONO};font-size:11px;letter-spacing:0.05em;">CONTINUE READING ON OREWIRE →</a>
    </p>
  </div>
</td></tr>` : '';

  const body = `
${emailHeaderRow()}
<tr><td style="padding:32px 32px 20px 32px;background-color:${C.white};">
  <div style="margin-bottom:16px;">
    <span style="display:inline-block;background-color:${badge.bg};color:${C.white};font-family:${MONO};font-size:12px;font-weight:700;letter-spacing:0.12em;padding:4px 12px;border-radius:4px;">${escapeHtml(badge.label)}</span>
  </div>
  <div style="font-family:${MONO};font-size:20px;font-weight:700;color:${C.navy};margin-bottom:4px;letter-spacing:-0.01em;">${escapeHtml(tickerLine)}</div>
  <div style="font-family:${SERIF};font-size:16px;color:${C.muted};margin-bottom:10px;">${escapeHtml(data.companyName || '')}</div>
  <div style="margin-bottom:10px;">${chip(headlineType)}</div>
</td></tr>
${summaryCard}
${fullRelease}
<tr><td style="padding:20px 32px 28px 32px;text-align:center;">
  ${goldCtaButton(data.summaryUrl, 'View on OreWire →')}
  ${data.originalUrl ? `<div style="margin-top:14px;"><a href="${escapeHtml(data.originalUrl)}" style="font-size:12px;color:${C.teal};text-decoration:underline;font-weight:500;">View original source</a></div>` : ''}
</td></tr>
${watchlistContextBlock(data.ticker)}`;

  return emailDocument({
    title: 'Watchlist News Alert | OreWire',
    preheader,
    bodyRows: body,
  });
}

function newsAlertSubject(data) {
  const tickerLine = slugLabel(data.exchange, data.ticker);
  const headlineType = headlineTypeFromTitle(data.title);
  return `${tickerLine} — ${headlineType}`;
}

module.exports = {
  renderWatchlistNewsAlertEmail,
  newsAlertSubject,
  headlineTypeFromTitle,
  slugLabel,
};
