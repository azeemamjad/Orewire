const { escapeHtml, emailConfig } = require('./email-templates');

const COMMODITY_CODES = {
  gold: 'GOLDSPOT', silver: 'SLVRSPOT', copper: 'COPRLME', uranium: 'URANUXC',
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

function fmtPrice(price, unit) {
  if (price == null) return '-';
  const n = Number(price);
  if (Number.isNaN(n)) return '-';
  if (unit === 'oz' && n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (unit === 'bbl' || unit === 'lb') return n.toFixed(2);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtChangeHtml(pct) {
  if (pct == null || Number.isNaN(Number(pct))) {
    return '<span style="color:#6b6b6b;">-</span>';
  }
  const n = Number(pct);
  const up = n >= 0;
  const color = up ? '#1f8a4c' : '#c2410c';
  const arrow = up ? '▲' : '▼';
  const sign = up ? '+' : '';
  return `<span style="color:${color};font-weight:500;">${arrow}&nbsp;${sign}${n.toFixed(2)}%</span>`;
}

function quoteCell(item, codeFn) {
  const code = codeFn(item);
  const unitSuffix = item.unit ? `<span style="color:#6b6b6b;font-weight:400;">/${escapeHtml(item.unit)}</span>` : '';
  return `<td class="qrow" width="50%" style="padding:7px 8px;border-bottom:1px solid #f1ecdf;vertical-align:middle;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle;">
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:10.5px;color:#2d8a8a;font-weight:600;letter-spacing:0.3px;">${escapeHtml(code)}</div>
      <div style="font-size:12px;color:#1a2541;font-weight:500;padding-top:1px;">${escapeHtml(item.label)}</div>
    </td>
    <td align="right" style="vertical-align:middle;white-space:nowrap;">
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#1a2541;font-weight:600;">${fmtPrice(item.price, item.unit)}${unitSuffix}</div>
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11px;padding-top:1px;">${fmtChangeHtml(item.change_pct)}</div>
    </td>
  </tr></table>
</td>`;
}

function quoteRows(items, codeFn) {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    rows.push(`<tr>${quoteCell(left, codeFn)}${right ? quoteCell(right, codeFn) : '<td width="50%" style="padding:7px 8px;border-bottom:1px solid #f1ecdf;"></td>'}</tr>`);
  }
  return rows.join('');
}

function sectionHeader(title, accent = '#d4a13a') {
  return `<tr><td class="px" style="padding:30px 32px 6px 32px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="border-left:3px solid ${accent};padding-left:10px;font-size:16px;font-weight:700;color:#1a2541;letter-spacing:0.2px;">${escapeHtml(title)}</td>
  </tr></table>
</td></tr>`;
}

function watchlistCard(f) {
  return `<tr><td class="px" style="padding:10px 32px 0 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #d4a13a;border-left:3px solid #d4a13a;border-radius:6px;">
    <tr><td style="padding:14px 16px;">
      <div><span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12.5px;color:#1a2541;font-weight:700;">${escapeHtml(f.slugLabel)}</span> <span style="color:#6b6b6b;font-size:12px;">· ${escapeHtml(f.companyName || '')} · ${escapeHtml(f.filingType)}</span></div>
      <div style="font-size:13.5px;color:#3a3a3a;padding-top:5px;line-height:1.45;">${escapeHtml(f.summaryShort || 'New filing on file.')}</div>
      <div style="padding-top:8px;"><a href="${escapeHtml(f.href)}" style="color:#2d8a8a;font-size:12.5px;font-weight:600;text-decoration:none;">View filing →</a></div>
    </td></tr>
  </table>
</td></tr>`;
}

function noteworthyCard(f) {
  return `<tr><td class="px" style="padding:10px 32px 0 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafaf6;border:1px solid #ece7dc;border-radius:6px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td>
          <span style="display:inline-block;background:#2d8a8a;color:#fff;font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:99px;letter-spacing:0.4px;">NOTEWORTHY</span>
          &nbsp;<span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#1a2541;font-weight:600;">${escapeHtml(f.slugLabel)}</span>
        </td>
        <td align="right" style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(f.filingType)}</td>
      </tr></table>
      <div style="padding:8px 0 4px 0;font-size:15px;font-weight:600;color:#1a2541;">${escapeHtml(f.companyName || '')}</div>
      <div style="font-size:14px;color:#3a3a3a;line-height:1.5;">${escapeHtml(f.summary || f.summaryShort || '')}</div>
      <div style="padding-top:10px;"><a href="${escapeHtml(f.href)}" style="color:#2d8a8a;font-size:13px;font-weight:600;text-decoration:none;">Read full summary →</a></div>
    </td></tr>
  </table>
</td></tr>`;
}

function watchRow(f, last) {
  const border = last ? '' : 'border-bottom:1px solid #f1ecdf;';
  return `<tr><td style="padding:11px 16px;${border}">
  <div><span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;color:#1a2541;font-weight:600;">${escapeHtml(f.slugLabel)}</span> <span style="color:#6b6b6b;font-size:12px;">· ${escapeHtml(f.companyName || '')} · ${escapeHtml(f.filingType)}</span></div>
  <div style="font-size:13px;color:#3a3a3a;padding-top:3px;line-height:1.45;">${escapeHtml(f.summaryShort || '')}</div>
</td></tr>`;
}

function newsRow(n, last) {
  const border = last ? '' : 'border-bottom:1px solid #f1ecdf;';
  return `<tr><td style="padding:9px 16px;${border}">
  <div style="font-size:13px;color:#3a3a3a;line-height:1.45;">
    <span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11.5px;color:#1a2541;font-weight:600;">${escapeHtml(n.slugLabel)}</span>
    ${n.companyName ? `<span style="color:#6b6b6b;font-size:12px;"> · ${escapeHtml(n.companyName)}</span>` : ''}
    <span style="color:#3a3a3a;"> - ${escapeHtml(n.line)}</span>
  </div>
</td></tr>`;
}

function routineLines(items) {
  return items.map((f) =>
    `<div><span style="font-family:'SF Mono',Menlo,Consolas,monospace;color:#1a2541;">${escapeHtml(f.slugLabel)}</span> <span style="color:#6b6b6b;">-</span> ${escapeHtml(f.summaryShort || f.filingType)}.</div>`,
  ).join('');
}

function renderDailyBriefing(data, opts = {}) {
  const cfg = emailConfig();
  const dateLong = fmtDateLong();
  const firstName = opts.firstName;
  const preheader = data.watchlistCount > 0
    ? `Your daily briefing - ${data.watchlistCount} watchlist filing${data.watchlistCount === 1 ? '' : 's'}, ${data.counts.noteworthy} noteworthy today`
    : `Your daily briefing - ${data.counts.noteworthy} noteworthy filings today`;

  const commodityRows = quoteRows(
    data.commodities,
    (c) => COMMODITY_CODES[c.key] || c.key.toUpperCase().replace('_', ''),
  );
  const indexRows = quoteRows(
    data.indexes,
    (c) => INDEX_CODES[c.key] || `${c.key}IDX`,
  );
  const currencyRows = quoteRows(
    data.currencies,
    (c) => `${c.key}FX`,
  );

  let watchlistBlock = '';
  if (opts.userId != null) {
    watchlistBlock += sectionHeader('Your watchlist', '#d4a13a');
    watchlistBlock += `<tr><td class="px" style="padding:6px 32px 0 32px;"><div style="font-size:12px;color:#6b6b6b;padding-left:13px;">${data.watchlistCount} of your watchlist companies filed in the last 24 hours</div></td></tr>`;
    if (data.watchlistFilings.length) {
      watchlistBlock += data.watchlistFilings.map((f) => watchlistCard(f)).join('');
    } else {
      watchlistBlock += `<tr><td class="px" style="padding:10px 32px 0 32px;"><div style="font-size:13px;color:#6b6b6b;padding-left:13px;">No watchlist filings in the last 24 hours. <a href="${escapeHtml(cfg.watchlistUrl)}" style="color:#2d8a8a;font-weight:600;text-decoration:none;">Manage watchlist →</a></div></td></tr>`;
    }
  }

  const noteworthyBlock = data.noteworthy.length
    ? data.noteworthy.map((f) => noteworthyCard(f)).join('')
    : `<tr><td class="px" style="padding:10px 32px 0 32px;"><div style="font-size:13px;color:#6b6b6b;">No noteworthy filings in the last 24 hours.</div></td></tr>`;

  const watchBlock = data.watch.length
    ? `<tr><td class="px" style="padding:10px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #ece7dc;border-radius:6px;">${data.watch.map((f, i) => watchRow(f, i === data.watch.length - 1)).join('')}</table></td></tr>`
    : `<tr><td class="px" style="padding:10px 32px 0 32px;"><div style="font-size:13px;color:#6b6b6b;">No watch-list filings today.</div></td></tr>`;

  const newsBlock = data.news.length
    ? `<tr><td class="px" style="padding:10px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #ece7dc;border-radius:6px;">${data.news.map((n, i) => newsRow(n, i === data.news.length - 1)).join('')}</table></td></tr>`
    : '';

  const routineBlock = data.routine.length
    ? `<tr><td class="px" style="padding:8px 32px 4px 32px;"><div style="font-size:12.5px;color:#6b6b6b;line-height:1.85;">${routineLines(data.routine)}</div></td></tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Morning Briefing | OreWire</title>
<style>
  @media (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 18px !important; padding-right: 18px !important; }
    .qrow { display: block !important; width: 100% !important; }
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
  <td class="px" style="background:#0f1e3d;padding:22px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:18px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">Ore<span style="color:#d4a13a;">Wire</span></td>
      <td align="right" style="font-size:12px;color:#a9b4cc;font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(dateLong)}</td>
    </tr><tr>
      <td colspan="2" style="padding-top:8px;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.2px;">Morning Briefing</td>
    </tr></table>
  </td>
</tr>
<tr>
  <td class="px" style="padding:18px 32px 8px 32px;background:#ffffff;border-bottom:1px solid #f1ecdf;">
    <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:1px;font-weight:600;padding-bottom:6px;">Commodities · Spot</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${commodityRows}</table>
    <div style="padding-top:18px;font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:1px;font-weight:600;padding-bottom:6px;">Indexes · Markets</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${indexRows}</table>
    <div style="padding-top:18px;font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:1px;font-weight:600;padding-bottom:6px;">Currencies · FX</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${currencyRows}</table>
    <div style="padding:14px 0 6px 0;font-size:12px;color:#6b6b6b;">Live market data · <a href="${escapeHtml(cfg.feedUrl)}" style="color:#2d8a8a;text-decoration:none;font-weight:600;">orewire.com</a></div>
  </td>
</tr>
${watchlistBlock}
${sectionHeader('Noteworthy', '#2d8a8a')}
<tr><td class="px" style="padding:0 32px;"><div style="font-size:12px;color:#6b6b6b;padding:4px 0 0 0;">${data.counts.noteworthy} material filing${data.counts.noteworthy === 1 ? '' : 's'} in the last 24 hours</div></td></tr>
${noteworthyBlock}
${sectionHeader('Watch', '#d4a13a')}
<tr><td class="px" style="padding:0 32px;"><div style="font-size:12px;color:#6b6b6b;padding:4px 0 0 0;">${data.counts.watch} items worth a glance</div></td></tr>
${watchBlock}
${sectionHeader('News wire', '#6b8a9e')}
<tr><td class="px" style="padding:0 32px;"><div style="font-size:12px;color:#6b6b6b;padding:4px 0 0 0;">${data.counts.news} headlines</div></td></tr>
${newsBlock}
${sectionHeader('Routine ticker', '#c8c2b3')}
<tr><td class="px" style="padding:0 32px;"><div style="font-size:12px;color:#6b6b6b;padding:4px 0 0 0;">${data.counts.routine} routine updates</div></td></tr>
${routineBlock}
<tr><td style="padding:28px 0 0 0;"></td></tr>
<tr>
  <td class="px" style="background:#efece6;padding:22px 32px;border-top:1px solid #e3ddcd;">
    <div style="font-size:12px;color:#6b6b6b;line-height:1.6;">This is your daily briefing from <strong style="color:#1a2541;">OreWire</strong>. Not investment advice.</div>
    <div style="padding-top:10px;font-size:12px;">
      <a href="${escapeHtml(cfg.unsubscribeUrl)}" style="color:#6b6b6b;text-decoration:underline;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="${escapeHtml(cfg.profileUrl)}" style="color:#6b6b6b;text-decoration:underline;">Manage preferences</a>
    </div>
    <div style="padding-top:12px;font-size:12px;">
      <a href="${escapeHtml(cfg.xUrl)}" style="color:#1a2541;text-decoration:none;font-weight:600;">X</a>
      &nbsp;·&nbsp;
      <a href="${escapeHtml(cfg.linkedinUrl)}" style="color:#1a2541;text-decoration:none;font-weight:600;">LinkedIn</a>
    </div>
    <div style="padding-top:14px;font-size:11px;color:#9a9384;">© ${cfg.year} OreWire</div>
  </td>
</tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function briefingSubject() {
  const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
  return `Morning Briefing - ${d}`;
}

module.exports = {
  renderDailyBriefing,
  briefingSubject,
  fmtDateLong,
};
