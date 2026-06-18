/**
 * One-time helper: extracts tab sections from ../index.html into separate admin pages.
 * Run: node admin/split-pages.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractTab(id) {
  const re = new RegExp(`<div id=\"tab-${id}\" class=\"tab-content[\\s\\S]*?</div>\\s*(?=<!-- ──|</main>)`);
  const m = src.match(re);
  return m ? m[0].replace(`id="tab-${id}" class="tab-content"`, `id="page-${id}"`) : '';
}

const scriptMatch = src.match(/<script>([\s\S]*?)<\/script>/);
const fullScript = scriptMatch ? scriptMatch[1] : '';

const tabs = ['dashboard', 'companies', 'filings', 'import', 'scraper', 'pipeline'];
const nav = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard', href: 'dashboard.html' },
  { id: 'companies', icon: '🏢', label: 'Companies', href: 'companies.html' },
  { id: 'filings', icon: '📄', label: 'Filings', href: 'filings.html' },
  { id: 'import', icon: '📥', label: 'Import Data', href: 'import.html' },
  { id: 'scraper', icon: '🤖', label: 'Run Scraper', href: 'scraper.html' },
  { id: 'pipeline', icon: '⚙️', label: 'Pipeline', href: 'pipeline.html' },
];

function sidebar(active) {
  return `<aside class="sidebar">
  <div class="logo">⛏ Mining Intel<span>SEDAR+ Filing Tracker</span></div>
  <nav><ul>
    ${nav.map((n) => `<li class="${n.id === active ? 'active' : ''}"><a href="${n.href}"><span class="icon">${n.icon}</span>${n.label}</a></li>`).join('\n    ')}
  </ul></nav>
  <div style="margin-top:auto;padding:14px 16px;border-top:1px solid var(--border);">
    <a href="/admin/logout" style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;text-decoration:none;">🚪 Logout</a>
  </div>
</aside>`;
}

function pageShell(active, bodyExtra, scripts) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${active} | Mining Intel Admin</title>
<link rel="stylesheet" href="/admin/css/admin.css" />
<style>
nav li a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 8px; width: 100%; }
.cron-builder { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px; }
.cron-preview { font-size: 12px; color: var(--muted); margin-top: 6px; }
.tab-content.active, #page-${active} { display: block; }
</style>
</head>
<body>
${sidebar(active)}
<main class="main">
${bodyExtra}
</main>
<div id="toast"></div>
${scripts}
<script src="/admin/js/shared.js"></script>
</body>
</html>`;
}

for (const tab of tabs) {
  const body = extractTab(tab).replace('class="tab-content"', 'class="tab-content active"');
  const out = pageShell(tab, body, tab === 'companies' || tab === 'dashboard' || tab === 'filings'
    ? `<div class="modal-backdrop" id="filing-modal"><div class="modal"><div class="modal-header"><h2 id="modal-title">Filing Detail</h2><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body" id="modal-body">Loading…</div></div></div>`
    : '');
  fs.writeFileSync(path.join(__dirname, `${tab}.html`), out);
  console.log('wrote', tab);
}

// Write page-specific scripts extracted heuristically - use full script for now on each page (heavy but works)
const sharedParts = `
const API = '';
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show toast-' + type;
  setTimeout(() => el.className = '', 3000);
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function verdictBadge(v) {
  if (!v) return '<span class="badge badge-pending">-</span>';
  const cls = v === 'noteworthy' ? 'badge-noteworthy' : v === 'watch' ? 'badge-watch' : 'badge-routine';
  return '<span class="badge ' + cls + '">' + esc(v) + '</span>';
}
`;
fs.writeFileSync(path.join(__dirname, 'js', 'shared.js'), sharedParts + '\n// Page scripts loaded per-page\n');

// Redirect index
fs.writeFileSync(path.join(ROOT, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="refresh" content="0;url=/admin/dashboard.html" /><title>Redirect</title></head>
<body><p>Redirecting to <a href="/admin/dashboard.html">admin dashboard</a>…</p></body></html>`);

console.log('done');
