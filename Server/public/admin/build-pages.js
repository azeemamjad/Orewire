const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start);
  if (start < 0 || end < 0) return '';
  return src.slice(start, end);
}

const tabs = {
  dashboard: extractBetween('<!-- ── DASHBOARD ── -->', '<!-- ── COMPANIES ── -->'),
  companies: extractBetween('<!-- ── COMPANIES ── -->', '<!-- ── FILINGS ── -->'),
  filings: extractBetween('<!-- ── FILINGS ── -->', '<!-- ── IMPORT ── -->'),
  import: extractBetween('<!-- ── IMPORT ── -->', '<!-- ── SCRAPER ── -->'),
  scraper: extractBetween('<!-- ── SCRAPER ── -->', '<!-- ── PIPELINE ── -->'),
  pipeline: extractBetween('<!-- ── PIPELINE ── -->', '</main>'),
};

const modals = extractBetween('<!-- ── FILING DETAIL MODAL ── -->', '<!-- Toast -->');

const nav = [
  ['dashboard', '📊', 'Dashboard', 'dashboard.html'],
  ['companies', '🏢', 'Companies', 'companies.html'],
  ['filings', '📄', 'Filings', 'filings.html'],
  ['import', '📥', 'Import Data', 'import.html'],
  ['scraper', '🤖', 'Run Scraper', 'scraper.html'],
  ['pipeline', '⚙️', 'Pipeline', 'pipeline.html'],
];

function shell(page, body, extra = '') {
  const side = nav
    .map(([id, icon, label, href]) => {
      const active = id === page ? ' class="active"' : '';
      return `<li${active}><a href="${href}"><span class="icon">${icon}</span>${label}</a></li>`;
    })
    .join('\n      ');

  const content = body
    .replace(/class="tab-content active"/g, 'class="tab-content active"')
    .replace(/class="tab-content"/g, 'class="tab-content active"')
    .replace(/id="tab-/g, 'id="page-');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${page} | Mining Intel Admin</title>
<link rel="stylesheet" href="/admin/css/admin.css" />
<style>
nav li a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 8px; width: 100%; }
.cron-builder { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.cron-preview { font-size: 12px; color: var(--muted); margin-top: 6px; }
</style>
</head>
<body data-page="${page}">
<aside class="sidebar">
  <div class="logo">⛏ Mining Intel<span>SEDAR+ Filing Tracker</span></div>
  <nav><ul>
      ${side}
  </ul></nav>
  <div style="margin-top:auto;padding:14px 16px;border-top:1px solid var(--border);">
    <a href="/admin/logout" style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;text-decoration:none;">🚪 Logout</a>
  </div>
</aside>
<main class="main">
${content}
</main>
${modals}
${extra}
<div id="toast"></div>
<script src="/admin/js/cron-schedule.js"></script>
<script src="/admin/js/legacy-admin.js"></script>
</body>
</html>`;
}

for (const [page, tabBody] of Object.entries(tabs)) {
  let body = tabBody;
  let extra = '';
  if (page === 'companies') {
    extra = fs.readFileSync(path.join(__dirname, 'companies-add-modal.html'), 'utf8');
    body = body.replace(
      '<button class="btn btn-ghost btn-sm" onclick="_coPage=1;loadCompanies()">↻ Refresh</button>',
      '<button class="btn btn-primary btn-sm" onclick="openAddCompanyModal()">+ Add company</button>\n      <button class="btn btn-ghost btn-sm" onclick="_coPage=1;loadCompanies()">↻ Refresh</button>'
    );
  }
  fs.writeFileSync(path.join(__dirname, `${page}.html`), shell(page, body, extra));
  console.log('built', page);
}

fs.writeFileSync(
  path.join(ROOT, 'index.html'),
  `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta http-equiv="refresh" content="0;url=/admin/dashboard.html"/><title>Admin</title></head><body><a href="/admin/dashboard.html">Admin panel</a></body></html>`
);

console.log('index redirect ok');
