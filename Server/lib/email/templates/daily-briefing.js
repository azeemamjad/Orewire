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
  pill,
  fmtPctChange,
  chunk,
} = require('./layout');

const COMMODITY_CODES = {
  gold: 'GOLDSPOT', silver: 'SILVERSPOT', copper: 'COPPERLME',
  lithium: 'LITHSHFE', iron_ore: 'IRONSGX', nickel: 'NICKLME', zinc: 'ZINCLME',
  brent: 'BRNTICE', wti: 'WTINYM', tin: 'TINLME', cobalt: 'COBALME', lead: 'LEADLME',
  platinum: 'PLATSPOT', palladium: 'PALLSPOT',
};

const INDEX_CODES = {
  GDXJ: 'GDXJETF', GDX: 'GDXETF', TSXV: 'TSXVIDX', XMM: 'XMMIDX', XGD: 'SPTSXGIDX',
  URA: 'URAETF', COPX: 'COPXETF', SIL: 'SILETF', LIT: 'LITETF', PICK: 'PICKETF',
  TSX: 'TSXIDX', XJO: 'XJOIDX', SPX: 'SPXIDX', VIX: 'VIXIDX',
};

function fmtDateLong(d = new Date()) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Toronto',
  });
}

function fmtBriefingHeaderDate(d = new Date()) {
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Toronto' }).toUpperCase();
  const rest = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto' }).toUpperCase();
  return `${day} · ${rest} · 7:30 AM ET`;
}

function fmtPrice(price, unit) {
  if (price == null) return '—';
  const n = Number(price);
  if (Number.isNaN(n)) return '—';
  const formatted = n >= 100
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return unit ? `${formatted}/${unit}` : formatted;
}

function quoteGroupHtml(title, items) {
  if (!items.length) return '';
  const rows = chunk(items, 2).map((row, ri) => {
    const cells = row.map((item, ci) => {
      const name = escapeHtml(item.label || item.key);
      const price = fmtPrice(item.price, item.unit);
      const pct = fmtPctChange(item.change_pct);
      const borderBottom = ri < Math.ceil(items.length / 2) - 1 ? `border-bottom:1px dotted ${C.border};` : '';
      return `<td class="qcol" width="50%" style="padding:6px 0;padding-right:${ci === 0 ? '10px' : '0'};padding-left:${ci === 1 ? '10px' : '0'};vertical-align:middle;${borderBottom}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="font-size:12px;font-weight:700;color:${C.navy};">${name}</td>
          <td style="text-align:right;font-family:${MONO};font-size:11px;color:${C.text};white-space:nowrap;">${price} ${pct}</td>
        </tr></table>
      </td>`;
    }).join('');
    const pad = row.length === 1 ? '<td class="qcol" width="50%"></td>' : '';
    return `<tr>${cells}${pad}</tr>`;
  }).join('');

  return `<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${C.border};">
    <div style="font-family:${MONO};font-size:9px;color:${C.muted};letter-spacing:0.16em;margin-bottom:8px;text-transform:uppercase;">${escapeHtml(title)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tbody>${rows}</tbody></table>
  </div>`;
}

function watchlistCardHtml(f) {
  const summary = escapeHtml(f.summary || f.summaryShort || 'New filing on file.');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.tealBg};border-left:4px solid ${C.teal};border-radius:4px;margin-bottom:10px;"><tr>
  <td style="padding:14px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td>
        ${pill('NOTEWORTHY', C.teal, C.white)}
        <span style="font-family:${MONO};font-weight:700;font-size:13px;color:${C.navy};margin-left:6px;">${escapeHtml(f.slugLabel)}</span>
        <span style="font-size:13px;color:${C.muted};"> ${escapeHtml(f.companyName || '')}</span>
      </td>
    </tr>
    <tr><td colspan="2" style="padding-top:6px;">${chip(f.filingType || 'Filing')}</td></tr>
    <tr><td colspan="2" style="padding-top:10px;font-size:13px;line-height:1.55;color:${C.text};">${summary}</td></tr>
    <tr><td colspan="2" style="padding-top:12px;">
      <a href="${escapeHtml(f.href)}" style="font-size:12px;color:${C.teal};font-weight:600;text-decoration:none;font-family:${MONO};letter-spacing:0.03em;">READ FULL SUMMARY →</a>
    </td></tr>
    </table>
  </td>
</tr></table>`;
}

function marketRowHtml(item, isFirst) {
  const borderTop = isFirst ? 'none' : `1px solid ${C.border}`;
  return `<tr><td style="padding:12px 14px;border-top:${borderTop};vertical-align:top;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="vertical-align:top;padding-right:10px;">
        <div style="margin-bottom:3px;">
          <span style="font-family:${MONO};font-weight:700;font-size:12px;color:${C.navy};">${escapeHtml(item.slugLabel)}</span>
          <span style="color:${C.faint};margin:0 6px;">·</span>
          <span style="font-size:12px;color:${C.muted};font-weight:600;">${escapeHtml(item.companyName || '')}</span>
        </div>
        <div style="font-size:13px;line-height:1.5;color:${C.text};">${escapeHtml(item.summaryShort || item.summary || item.line || '')}</div>
      </td>
      <td style="vertical-align:middle;text-align:right;white-space:nowrap;">
        <a href="${escapeHtml(item.href)}" style="display:inline-block;width:28px;height:28px;line-height:26px;text-align:center;border:1px solid ${C.border};border-radius:4px;color:${C.teal};font-weight:700;text-decoration:none;font-size:14px;">→</a>
      </td>
    </tr></table>
  </td></tr>`;
}

function renderDailyBriefing(data, opts = {}) {
  const cfg = emailConfig();
  const headerDate = fmtBriefingHeaderDate();
  const snapshotDate = fmtDateLong().toUpperCase();

  const preheader = data.watchlistCount > 0
    ? `Your daily briefing — ${data.watchlistCount} watchlist filing${data.watchlistCount === 1 ? '' : 's'}, ${data.counts.noteworthy} noteworthy today`
    : `Your daily briefing — ${data.counts.noteworthy} noteworthy filings today`;

  const headerRight = `<div style="font-family:${SERIF};font-size:15px;color:${C.navy};font-weight:600;">Morning Briefing</div>
    <div style="font-family:${MONO};font-size:10px;color:${C.muted};letter-spacing:0.1em;margin-top:2px;">${escapeHtml(headerDate)}</div>`;

  const marketSnapshot = `
<tr><td style="background-color:${C.panel};padding:18px 24px 20px 24px;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td><div style="font-family:${SERIF};font-size:14px;font-weight:700;color:${C.navy};">Market Snapshot</div></td>
    <td style="text-align:right;font-family:${MONO};font-size:10px;color:${C.muted};letter-spacing:0.08em;">AS OF 7:30 AM ET · ${escapeHtml(snapshotDate.split(',')[0].toUpperCase())}</td>
  </tr></table>
  ${quoteGroupHtml('Commodities', data.commodities || [])}
  ${quoteGroupHtml('Indexes', data.indexes || [])}
  ${quoteGroupHtml('Currencies', data.currencies || [])}
</td></tr>`;

  let watchlistSection = '';
  if (opts.userId != null) {
    const cards = (data.watchlistFilings || []).map((f) => watchlistCardHtml(f)).join('');
    const empty = !cards
      ? `<p style="margin:0;font-size:13px;color:${C.muted};">No watchlist filings in the last 24 hours. <a href="${escapeHtml(cfg.watchlistUrl)}" style="color:${C.teal};font-weight:600;text-decoration:none;">Manage watchlist →</a></p>`
      : cards;
    watchlistSection = `
<tr><td style="padding:32px 32px 8px 32px;background-color:${C.white};">
  <p style="margin:0 0 4px 0;font-family:${SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:-0.01em;">From your watchlist</p>
  <p style="margin:0 0 16px 0;font-size:12px;color:${C.muted};">Noteworthy news releases and filings from companies you follow</p>
  ${empty}
</td></tr>`;
  }

  const marketItems = [
    ...(data.noteworthy || []),
    ...(data.watch || []).map((f) => ({ ...f, summaryShort: f.summaryShort || f.summary })),
  ];
  const marketRows = marketItems.length
    ? marketItems.map((item, i) => marketRowHtml(item, i === 0)).join('')
    : `<tr><td style="padding:16px 14px;font-size:13px;color:${C.muted};">No noteworthy market filings in the last 24 hours.</td></tr>`;

  const marketSection = `
<tr><td style="padding:24px 32px 8px 32px;background-color:${C.white};">
  <p style="margin:0 0 4px 0;font-family:${SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:-0.01em;">From the market</p>
  <p style="margin:0 0 14px 0;font-size:12px;color:${C.muted};">Noteworthy news releases and filings across TSX, TSX-V, CSE, and ASX — last 24 hours</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${C.border};border-radius:6px;border-collapse:separate;">
    <tbody>${marketRows}</tbody>
  </table>
  <div style="margin-top:12px;text-align:center;">
    <a href="${escapeHtml(cfg.feedUrl)}" style="font-family:${MONO};font-size:11px;color:${C.teal};font-weight:600;text-decoration:none;letter-spacing:0.05em;">VIEW ALL NOTEWORTHY ON OREWIRE →</a>
  </div>
</td></tr>`;

  const ctaSection = `
<tr><td style="padding:24px 32px 32px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.goldSoft};border-radius:8px;"><tr>
  <td style="padding:28px 24px;text-align:center;">
    <p style="margin:0 0 6px 0;font-family:${SERIF};font-size:18px;font-weight:700;color:${C.navy};">Looking for a specific company?</p>
    <p style="margin:0 0 18px 0;font-size:13px;color:${C.muted};line-height:1.55;">Search the full feed or add companies to your watchlist for instant alerts.</p>
    ${goldCtaButton(cfg.feedUrl, 'Browse the full feed →')}
  </td>
</tr></table>
</td></tr>`;

  const body = `
${emailHeaderRow(headerRight)}
${marketSnapshot}
${watchlistSection}
${marketSection}
${ctaSection}`;

  return emailDocument({
    title: 'Morning Briefing | OreWire',
    preheader,
    bodyRows: body,
  });
}

function briefingSubject() {
  const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
  return `Morning Briefing — ${d}`;
}

module.exports = {
  renderDailyBriefing,
  briefingSubject,
  fmtDateLong,
  COMMODITY_CODES,
  INDEX_CODES,
};
