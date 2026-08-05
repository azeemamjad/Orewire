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
  return `${day} · ${rest}`;
}

// "TUESDAY, AUG 4" — the snapshot line names the weekday, so carry the date
// with it rather than making the reader scroll back to the masthead.
function fmtSnapshotDay(d = new Date()) {
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Toronto' }).toUpperCase();
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' }).toUpperCase();
  return `${weekday}, ${date}`;
}

// `symbol` is '$' for commodities only. Index levels and FX rates are not
// dollar amounts, so they render bare.
function fmtPrice(price, unit, symbol = '') {
  if (price == null) return 'N/A';
  const n = Number(price);
  if (Number.isNaN(n)) return 'N/A';
  const formatted = n >= 100
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const withSymbol = `${symbol}${formatted}`;
  return unit ? `${withSymbol}/${unit}` : withSymbol;
}

function quoteGroupHtml(title, items, symbol = '') {
  if (!items.length) return '';
  const lastIndex = items.length - 1;
  const rowCount = Math.ceil(items.length / 2);
  const rows = chunk(items, 2).map((row, ri) => {
    const cells = row.map((item, ci) => {
      const index = ri * 2 + ci;
      const name = escapeHtml(item.label || item.key);
      const price = fmtPrice(item.price, item.unit, symbol);
      const pct = fmtPctChange(item.change_pct);
      const borderBottom = ri < rowCount - 1 ? `border-bottom:1px dotted ${C.border};` : '';
      const gutter = ci === 0 ? 'padding-right:14px;' : 'padding-left:14px;';
      const lastClass = index === lastIndex ? ' qcol-last' : '';
      return `<td class="qcol${lastClass}" width="50%" style="padding-top:4px;padding-bottom:4px;${gutter}vertical-align:middle;${borderBottom}">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr>
          <td align="left" style="font-size:12px;font-weight:700;color:${C.navy};padding-right:8px;">${name}</td>
          <td align="right" style="text-align:right;font-family:${MONO};font-size:11px;color:${C.text};white-space:nowrap;">${price}</td>
          <td align="right" width="70" style="width:70px;text-align:right;font-family:${MONO};font-size:11px;white-space:nowrap;padding-left:10px;">${pct}</td>
        </tr></table>
      </td>`;
    }).join('');
    const pad = row.length === 1 ? '<td class="qcol qcol-pad" width="50%"></td>' : '';
    return `<tr>${cells}${pad}</tr>`;
  }).join('');

  return `<div style="margin-top:10px;padding-top:10px;border-top:1px solid ${C.border};">
    <div style="font-family:${MONO};font-size:9px;color:${C.muted};letter-spacing:0.16em;margin-bottom:5px;text-transform:uppercase;">${escapeHtml(title)}</div>
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
  const snapshotDay = fmtSnapshotDay();

  const preheader = data.watchlistCount > 0
    ? `Your daily briefing: ${data.watchlistCount} watchlist filing${data.watchlistCount === 1 ? '' : 's'}, ${data.counts.noteworthy} noteworthy today`
    : `Your daily briefing: ${data.counts.noteworthy} noteworthy filings today`;

  // Masthead gets its own full-width row: title left, dateline right. The date
  // is nowrap and the title is not, so on a very narrow phone the title wraps
  // rather than the two overrunning the container.
  const headerBelow = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="vertical-align:bottom;">
        <div class="mast-title" style="font-family:${SERIF};font-size:26px;line-height:1.15;color:${C.navy};font-weight:700;letter-spacing:-0.015em;">Morning Briefing</div>
      </td>
      <td style="vertical-align:bottom;text-align:right;padding-left:10px;white-space:nowrap;">
        <div class="mast-date" style="font-family:${MONO};font-size:11px;line-height:1.4;color:${C.muted};letter-spacing:0.06em;">${escapeHtml(headerDate)}</div>
        <div class="mast-date" style="font-family:${MONO};font-size:10px;line-height:1.4;color:${C.faint};letter-spacing:0.06em;">7:30 AM ET</div>
      </td>
    </tr></table>`;

  const marketSnapshot = `
<tr><td class="px" style="background-color:${C.panel};padding:18px 32px 18px 32px;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td class="stackcol" style="vertical-align:middle;"><div style="font-family:${SERIF};font-size:15px;font-weight:700;color:${C.navy};">Market Snapshot</div></td>
    <td class="stackcol stackcol-tight" style="text-align:right;vertical-align:middle;padding-left:12px;font-family:${MONO};font-size:10px;color:${C.muted};letter-spacing:0.06em;">AS OF 7:30 AM ET · ${escapeHtml(snapshotDay)}</td>
  </tr></table>
  ${quoteGroupHtml('Commodities', data.commodities || [], '$')}
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
<tr><td class="px" style="padding:32px 32px 8px 32px;background-color:${C.white};">
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
<tr><td class="px" style="padding:24px 32px 8px 32px;background-color:${C.white};">
  <p style="margin:0 0 4px 0;font-family:${SERIF};font-size:20px;font-weight:700;color:${C.navy};letter-spacing:-0.01em;">From the market</p>
  <p style="margin:0 0 14px 0;font-size:12px;color:${C.muted};">Noteworthy news releases and filings across TSX, TSX-V, CSE, and ASX in the last 24 hours</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${C.border};border-radius:6px;border-collapse:separate;">
    <tbody>${marketRows}</tbody>
  </table>
  <div style="margin-top:12px;text-align:center;">
    <a href="${escapeHtml(cfg.feedUrl)}" style="font-family:${MONO};font-size:11px;color:${C.teal};font-weight:600;text-decoration:none;letter-spacing:0.05em;">VIEW ALL NOTEWORTHY ON OREWIRE →</a>
  </div>
</td></tr>`;

  const ctaSection = `
<tr><td class="px" style="padding:24px 32px 32px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.goldSoft};border-radius:8px;"><tr>
  <td style="padding:28px 24px;text-align:center;">
    <p style="margin:0 0 6px 0;font-family:${SERIF};font-size:18px;font-weight:700;color:${C.navy};">Looking for a specific company?</p>
    <p style="margin:0 0 18px 0;font-size:13px;color:${C.muted};line-height:1.55;">Search the full feed or add companies to your watchlist for instant alerts.</p>
    ${goldCtaButton(cfg.feedUrl, 'Browse the full feed →')}
  </td>
</tr></table>
</td></tr>`;

  const body = `
${emailHeaderRow('', headerBelow)}
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
  const d = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Toronto',
  });
  return `Mining Morning Briefing: ${d}`;
}

module.exports = {
  renderDailyBriefing,
  briefingSubject,
  fmtDateLong,
  COMMODITY_CODES,
  INDEX_CODES,
};
