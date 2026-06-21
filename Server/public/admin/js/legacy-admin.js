
const API = '';  // same origin

// Pipeline log panel state (must be declared before any function that reads it)
let _plPollId    = null;
let _plLogOffset = 0;
let _plLogSource = 'all';
let _plLogClear  = false;
let _addCoPeople = [];

// ── Multi-page init (each admin/*.html sets body data-page) ──
function initAdminPage() {
  const page = document.body.dataset.page;
  if (!page) return;
  if (page === 'dashboard') loadDashboard();
  if (page === 'companies') { loadExchanges(); loadCompanies(); }
  if (page === 'filings') loadFilings();
  if (page === 'import') { loadCseStatus(); loadAsxStatus(); }
  if (page === 'scraper') {
    loadRuns();
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('name')) {
      const ex = document.getElementById('scrape-exchange');
      if (ex && sp.get('exchange')) ex.value = sp.get('exchange');
      if (sp.get('exchange') === 'ASX' && sp.get('ticker')) asxSelectCompany(sp.get('ticker'), sp.get('name'));
      else document.getElementById('scrape-company').value = sp.get('name');
    }
  }
  if (page === 'pipeline') pipelineInit();
  if (page === 'processes') processesInit();
  if (page === 'users') loadUsers();
  if (page === 'contact-messages') initContactMessages();
}
document.addEventListener('DOMContentLoaded', initAdminPage);

// ── Toast ──
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show toast-${type}`;
  setTimeout(() => el.className = '', 3000);
}

// ── Dashboard ──
async function loadDashboard() {
  try {
    const s = await fetch(`${API}/api/filings/stats`).then(r => r.json());
    document.getElementById('stat-companies').textContent   = s.companies ?? 0;
    document.getElementById('stat-filings').textContent     = s.filings ?? 0;
    document.getElementById('stat-analyzed').textContent    = s.analyzed ?? 0;
    document.getElementById('stat-noteworthy').textContent  = s.noteworthy ?? 0;
    document.getElementById('stat-watch').textContent       = s.watch ?? 0;
    document.getElementById('stat-routine').textContent     = s.routine ?? 0;
  } catch { /* ignore */ }

  try {
    const rows = await fetch(`${API}/api/filings`).then(r => r.json());
    const tbody = document.getElementById('recent-filings-body');
    const recent = rows.slice(0, 15);
    if (!recent.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No filings yet. Import company data and run the scraper.</td></tr>';
      return;
    }
    tbody.innerHTML = recent.map(f => `
      <tr>
        <td>${esc(f.company_name)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(f.pdf_filename)}">${esc(f.pdf_filename ?? '-')}</td>
        <td>${verdictBadge(f.verdict)}</td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);" title="${esc(f.ticker_summary)}">${esc(f.ticker_summary ?? '-')}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="showFiling(${f.id})">View</button></td>
      </tr>`).join('');
  } catch { /* ignore */ }
}

// ── Companies ──
async function loadExchanges() {
  try {
    const exc = await fetch(`${API}/api/companies/exchanges`).then(r => r.json());
    const sel = document.getElementById('co-exchange');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All exchanges</option>' + exc.map(e => `<option ${e===cur?'selected':''} value="${esc(e)}">${esc(e)}</option>`).join('');
  } catch { /* ignore */ }
}

let _coPage = 1;

function coChangePage(delta) {
  _coPage = Math.max(1, _coPage + delta);
  loadCompanies();
}

async function loadCompanies() {
  const search   = document.getElementById('co-search').value;
  const exchange = document.getElementById('co-exchange').value;
  const missing  = document.getElementById('co-missing').value;
  const params   = new URLSearchParams();
  if (search)   params.set('search', search);
  if (exchange) params.set('exchange', exchange);
  if (missing)  params.set('missing', missing);
  params.set('page', _coPage);
  params.set('limit', '20');

  const tbody = document.getElementById('companies-body');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Loading…</td></tr>';

  try {
    const res = await fetch(`${API}/api/companies?${params}`);
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `Server error (${res.status})`);
    }
    const rows   = result.data || [];
    const pg     = result.pagination || {};

    document.getElementById('co-count').textContent = `${pg.total ?? rows.length} companies`;
    document.getElementById('co-page-info').textContent = `Page ${pg.page ?? 1} of ${pg.totalPages ?? 1}`;
    document.getElementById('co-prev').disabled = !pg.hasPrev;
    document.getElementById('co-next').disabled = !pg.hasNext;

    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No companies found. Import an Excel file first.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(c => {
      const has = {
        desc:  !!(c.description && String(c.description).trim()),
        web:   !!(c.website && String(c.website).trim()),
        hq:    !!(c.headquarters && String(c.headquarters).trim()),
        ta:    !!(c.transfer_agent && String(c.transfer_agent).trim()),
        ppl:   !!c.has_people,
      };
      const badge = (ok, label) =>
        `<span class="badge ${ok ? 'badge-analyzed' : 'badge-pending'}" style="font-size:10px;${ok ? '' : 'opacity:0.55;'}" title="${label}: ${ok ? 'set' : 'missing'}">${ok ? '✓' : '·'} ${label}</span>`;
      return `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td><span class="badge badge-pending">${esc(c.exchange ?? '-')}</span></td>
        <td>${esc(c.ticker ?? '-')}</td>
        <td>${esc(c.sedar_ticker ?? '-')}</td>
        <td>${c.market_cap != null ? Number(c.market_cap).toLocaleString() : '-'}</td>
        <td style="display:flex;gap:4px;flex-wrap:wrap;">
          ${badge(has.desc, 'Desc')}${badge(has.web, 'Web')}${badge(has.hq, 'HQ')}${badge(has.ta, 'TA')}${badge(has.ppl, 'People')}
        </td>
        <td style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="openEditProfile(${c.id})">✎ Edit</button>
          ${c.ticker ? `<button class="btn btn-primary btn-sm" title="Pull profile from ${esc(c.exchange ?? 'exchange')} listing" onclick="quickProfile('${esc(c.ticker).replace(/'/g,"\\'")}')">▶ Profile</button>` : ''}
          <button class="btn btn-ghost btn-sm" title="Scrape SEDAR/ASX filings" onclick="quickScrape('${esc(c.name).replace(/'/g,"\\'")}','${esc(c.exchange??'')}','${esc(c.ticker??'')}')">📄 Filings</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCompany(${c.id})">✕</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Error: ${esc(e.message)}</td></tr>`;
  }
}

// Pull the company profile (description / website / HQ / transfer agent / officers)
// from its exchange listing - jumps to the Pipeline tab and runs the scrape for this ticker.
function quickProfile(ticker) {
  if (document.body.dataset.page !== 'pipeline') {
    window.location.href = `/admin/pipeline.html?pp_ticker=${encodeURIComponent(ticker)}`;
    return;
  }
  document.getElementById('pp-ticker').value = ticker;
  document.getElementById('pp-limit').value = '';
  document.getElementById('pp-refresh').value = '';
  document.getElementById('pp-dry-run').checked = false;
  profilesStart();
}

function quickScrape(name, exchange, ticker) {
  if (document.body.dataset.page !== 'scraper') {
    const q = new URLSearchParams({ name, exchange: exchange || '', ticker: ticker || '' });
    window.location.href = `/admin/scraper.html?${q}`;
    return;
  }
  if (exchange === 'ASX' && ticker) {
    document.getElementById('scrape-exchange').value = 'ASX';
    updateScraperPlaceholder();
    asxSelectCompany(ticker, name);
  } else {
    document.getElementById('scrape-exchange').value = '';
    updateScraperPlaceholder();
    document.getElementById('scrape-company').value = name;
  }
}

async function deleteCompany(id) {
  if (!confirm('Delete this company?')) return;
  await fetch(`${API}/api/companies/${id}`, { method: 'DELETE' });
  toast('Company deleted');
  loadCompanies();
}

// ── Edit Profile (manual enrichment) ──────────────────────────────────────

let _editingCompanyId = null;
let _editingPeople = [];

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('open');
  _editingCompanyId = null;
  _editingPeople = [];
}

async function openEditProfile(companyId) {
  _editingCompanyId = companyId;
  const modal = document.getElementById('profile-modal');
  const body  = document.getElementById('profile-modal-body');
  body.innerHTML = '<div class="loading">Loading…</div>';
  modal.classList.add('open');
  try {
    const r = await fetch(`${API}/api/companies/${companyId}/profile`).then(r => r.json());
    if (r.error) throw new Error(r.error);
    _editingPeople = r.people || [];
    document.getElementById('profile-modal-title').textContent =
      `Edit Profile - ${r.company.name} (${r.company.exchange || ''} ${r.company.ticker || ''})`;
    renderEditProfileForm(r.company);
  } catch (e) {
    body.innerHTML = `<p style="color:var(--danger);">Error: ${esc(e.message)}</p>`;
  }
}

function renderEditProfileForm(company) {
  const body = document.getElementById('profile-modal-body');
  body.innerHTML = `
    <div style="display:grid;gap:14px;">
      <div>
        <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Description</label>
        <textarea id="pf-description" rows="5" style="width:100%;padding:8px;font:inherit;">${esc(company.description ?? '')}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Website</label>
          <input id="pf-website" type="url" placeholder="https://…" value="${esc(company.website ?? '')}" style="width:100%;padding:8px;font:inherit;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Headquarters</label>
          <input id="pf-hq" type="text" placeholder="City, Country" value="${esc(company.headquarters ?? '')}" style="width:100%;padding:8px;font:inherit;" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">${(company.exchange ?? '').toUpperCase() === 'ASX' ? 'Share Registry' : 'Transfer Agent'}</label>
          <input id="pf-transfer-agent" type="text" placeholder="e.g. Odyssey Trust Company" value="${esc(company.transfer_agent ?? '')}" style="width:100%;padding:8px;font:inherit;" />
        </div>
        <div>
          <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Phone</label>
          <input id="pf-phone" type="text" placeholder="e.g. +1 604 631-3300" value="${esc(company.phone ?? '')}" style="width:100%;padding:8px;font:inherit;" />
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-ghost" onclick="closeProfileModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveProfile()">Save profile</button>
      </div>

      <hr style="border:none;border-top:1px solid var(--border);margin:10px 0;" />

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="section-title" style="margin:0;">Managers</div>
          <button class="btn btn-primary btn-sm" type="button" onclick="addPersonRow('manager')">+ Add manager</button>
        </div>
        <div class="table-wrap" style="max-height:220px;overflow:auto;margin-bottom:16px;">
          <table>
            <thead><tr><th>Name</th><th>Title</th><th style="width:60px;"></th></tr></thead>
            <tbody id="pf-managers-body"></tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="section-title" style="margin:0;">Directors</div>
          <button class="btn btn-primary btn-sm" type="button" onclick="addPersonRow('director')">+ Add director</button>
        </div>
        <div class="table-wrap" style="max-height:220px;overflow:auto;">
          <table>
            <thead><tr><th>Name</th><th>Title</th><th style="width:60px;"></th></tr></thead>
            <tbody id="pf-directors-body"></tbody>
          </table>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:8px;">Edit name or title and click <strong>Save</strong> on that row. Removed rows are deleted immediately.</div>
      </div>
    </div>
  `;
  renderPeopleRows();
}

function _peopleForKind(kind) {
  return _editingPeople
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => (p.kind || 'manager') === kind);
}

function renderPeopleRows() {
  renderPeopleSection('manager', 'pf-managers-body');
  renderPeopleSection('director', 'pf-directors-body');
}

function renderPeopleSection(kind, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const items = _peopleForKind(kind);
  if (!items.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">No ${kind}s yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(({ p, idx }) => personRowHtml(p, idx)).join('');
}

function personRowHtml(p, idx) {
  const persistedId = p.id != null ? String(p.id) : '';
  return `
    <tr data-idx="${idx}" data-id="${persistedId}">
      <td><input value="${esc(p.name ?? '')}" data-field="name" placeholder="Full name" style="width:100%;padding:5px;font:inherit;" /></td>
      <td><input value="${esc(p.title ?? '')}" data-field="title" placeholder="Title" style="width:100%;padding:5px;font:inherit;" /></td>
      <td style="display:flex;gap:4px;">
        <button type="button" class="btn btn-primary btn-sm" onclick="savePersonRow(${idx})" title="Save row">💾</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="removePersonRow(${idx})" title="Remove">✕</button>
      </td>
    </tr>
  `;
}

function addPersonRow(kind) {
  _editingPeople.push({ id: null, name: '', title: '', kind: kind === 'director' ? 'director' : 'manager', source: 'manual' });
  renderPeopleRows();
}

function _readPersonRow(idx) {
  const tr = document.querySelector(`tr[data-idx="${idx}"]`);
  if (!tr) return null;
  const data = {};
  tr.querySelectorAll('[data-field]').forEach(el => { data[el.dataset.field] = el.value; });
  data.kind = _editingPeople[idx]?.kind || 'manager';
  return data;
}

async function savePersonRow(idx) {
  const data = _readPersonRow(idx);
  if (!data || !data.name?.trim()) { toast('Name is required', 'err'); return; }
  const persisted = _editingPeople[idx];
  const url = persisted.id
    ? `${API}/api/companies/${_editingCompanyId}/people/${persisted.id}`
    : `${API}/api/companies/${_editingCompanyId}/people`;
  const method = persisted.id ? 'PUT' : 'POST';
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    _editingPeople[idx] = r;
    renderPeopleRows();
    toast(persisted.id ? 'Person updated' : 'Person added');
  } catch (e) { toast(e.message, 'err'); }
}

async function removePersonRow(idx) {
  const persisted = _editingPeople[idx];
  if (persisted.id) {
    if (!confirm(`Remove ${persisted.name}?`)) return;
    try {
      await fetch(`${API}/api/companies/${_editingCompanyId}/people/${persisted.id}`, { method: 'DELETE' });
      toast('Removed');
    } catch (e) { toast(e.message, 'err'); return; }
  }
  _editingPeople.splice(idx, 1);
  renderPeopleRows();
}

async function saveProfile() {
  const body = {
    description:    document.getElementById('pf-description').value.trim() || null,
    website:        document.getElementById('pf-website').value.trim() || null,
    headquarters:   document.getElementById('pf-hq').value.trim() || null,
    transfer_agent: document.getElementById('pf-transfer-agent').value.trim() || null,
    phone:          document.getElementById('pf-phone').value.trim() || null,
  };
  try {
    const r = await fetch(`${API}/api/companies/${_editingCompanyId}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    toast('Profile saved');
    loadCompanies();   // refresh badges in the list
  } catch (e) { toast(e.message, 'err'); }
}

// ── Filings ──
async function loadFilings() {
  const search  = document.getElementById('fi-search').value;
  const verdict = document.getElementById('fi-verdict').value;
  const params  = new URLSearchParams();
  if (search)  params.set('search', search);
  if (verdict) params.set('verdict', verdict);

  const tbody = document.getElementById('filings-body');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Loading…</td></tr>';

  try {
    const rows = await fetch(`${API}/api/filings?${params}`).then(r => r.json());
    document.getElementById('fi-count').textContent = `${rows.length} filings`;

    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No filings found. Run the scraper or sync analysis files.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(f => `
      <tr>
        <td><strong>${esc(f.company_name)}</strong></td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(f.pdf_filename)}">${esc(f.pdf_filename ?? '-')}</td>
        <td>${esc(f.filing_type ?? '-')}</td>
        <td>${verdictBadge(f.verdict)}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);" title="${esc(f.ticker_summary)}">${esc(f.ticker_summary ?? '-')}</td>
        <td><span class="badge ${f.analyzed ? 'badge-analyzed' : 'badge-pending'}">${f.analyzed ? 'Analyzed' : 'Pending'}</span></td>
        <td><button class="btn btn-ghost btn-sm" onclick="showFiling(${f.id})">View</button></td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Error: ${esc(e.message)}</td></tr>`;
  }
}

// ── Filing detail modal ──
async function showFiling(id) {
  document.getElementById('filing-modal').classList.add('open');
  document.getElementById('modal-body').innerHTML = '<div class="loading">Loading…</div>';

  try {
    const f = await fetch(`${API}/api/filings/${id}`).then(r => r.json());
    const a = f.analysis || {};

    document.getElementById('modal-title').textContent = f.company_name + ' - ' + (f.pdf_filename ?? '');

    const facts = (() => {
      try { return JSON.parse(a.key_facts || '[]'); } catch { return []; }
    })();
    const res = (() => {
      try { return JSON.parse(a.resource_estimate || 'null'); } catch { return null; }
    })();
    const insiders = (() => {
      try { return JSON.parse(a.insider_holdings || 'null'); } catch { return null; }
    })();

    document.getElementById('modal-body').innerHTML = `
      <div class="detail-row">
        <div class="detail-label">Verdict</div>
        <div class="detail-value">${verdictBadge(a.verdict)} <span style="color:var(--muted);font-size:12px;">${esc(a.verdict_reason ?? '')}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Ticker Summary</div>
        <div class="detail-value">${esc(a.ticker_summary ?? '-')}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Summary</div>
        <div class="detail-value" style="line-height:1.6;">${esc(a.summary ?? '-')}</div>
      </div>
      ${facts.length ? `
      <div class="detail-row">
        <div class="detail-label">Key Facts</div>
        <div class="detail-value"><ul class="fact-list">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
      </div>` : ''}
      <div class="detail-row">
        <div class="detail-label">Context</div>
        <div class="detail-value" style="color:var(--muted);">${esc(a.context ?? '-')}</div>
      </div>
      ${a.grade_commentary ? `
      <div class="detail-row">
        <div class="detail-label">Grade</div>
        <div class="detail-value">${esc(a.grade_commentary)}</div>
      </div>` : ''}
      <div class="detail-row">
        <div class="detail-label">Watch For</div>
        <div class="detail-value" style="color:var(--watch);">${esc(a.what_to_watch ?? '-')}</div>
      </div>
      ${a.cash_position != null ? `
      <div class="detail-row">
        <div class="detail-label">Cash Position</div>
        <div class="detail-value">$${Number(a.cash_position).toLocaleString()}M</div>
      </div>` : ''}
      ${res ? `
      <div class="detail-row">
        <div class="detail-label">Resource Est.</div>
        <div class="detail-value">${esc(res.category ?? '')} ${esc(res.tonnes_mt != null ? res.tonnes_mt + ' Mt' : '')} @ ${esc(res.grade ?? '')} - ${esc(res.contained_metal ?? '')}</div>
      </div>` : ''}
      ${insiders && insiders.length ? `
      <div class="detail-row">
        <div class="detail-label">Insiders</div>
        <div class="detail-value">${insiders.map(i => `${esc(i.name)} (${esc(i.title)}): ${Number(i.shares).toLocaleString()} shares`).join('<br>')}</div>
      </div>` : ''}
      <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;font-size:11px;color:var(--muted);">
        File: ${esc(f.pdf_filename ?? '')} &nbsp;·&nbsp; Imported: ${esc(f.created_at ?? '')}
      </div>`;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<p style="color:var(--danger);">Error: ${esc(e.message)}</p>`;
  }
}

function closeModal() {
  document.getElementById('filing-modal')?.classList.remove('open');
}
const _filingModal = document.getElementById('filing-modal');
if (_filingModal) {
  _filingModal.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ── Excel import ──
let _tempPath = null, _sheets = [], _previewData = {}, _aiResults = {}, _headerRows = {};

async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Show preview box immediately with loading state
  document.getElementById('preview-box').style.display = 'block';
  document.getElementById('sheet-tabs').innerHTML = '';
  document.getElementById('ai-assessment').innerHTML =
    '<div class="ai-loading"><div class="spinner"></div> AI is validating your data…</div>';
  document.getElementById('preview-info').textContent = '';
  document.getElementById('preview-thead').innerHTML = '';
  document.getElementById('preview-tbody').innerHTML = '';
  document.getElementById('import-btn').disabled = true;

  const fd = new FormData();
  fd.append('file', file);

  try {
    const r = await fetch(`${API}/api/upload/excel`, { method: 'POST', body: fd }).then(r => r.json());
    if (r.error) { toast(r.error, 'err'); resetImport(); return; }

    _tempPath    = r.tempPath;
    _sheets      = r.sheets;
    _previewData = r.preview;
    _aiResults   = r.aiResults || {};
    // Store the AI-determined header row per sheet so import can use it
    for (const s of r.sheets) {
      _headerRows[s] = r.preview[s]?.headerRow ?? null;
    }

    const tabs = document.getElementById('sheet-tabs');
    const sel  = document.getElementById('import-sheet-select');
    tabs.innerHTML = _sheets.map((s,i) => `<div class="sheet-tab ${i===0?'active':''}" onclick="switchPreviewSheet('${esc(s)}')">${esc(s)}</div>`).join('');
    sel.innerHTML  = _sheets.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

    switchPreviewSheet(_sheets[0]);
  } catch (err) {
    toast(err.message, 'err');
    resetImport();
  }
  e.target.value = '';
}

function switchPreviewSheet(sheet) {
  document.querySelectorAll('.sheet-tab').forEach(t => t.classList.toggle('active', t.textContent === sheet));
  document.getElementById('import-sheet-select').value = sheet;

  // AI card
  const ai  = _aiResults[sheet];
  const box = document.getElementById('ai-assessment');
  if (ai) {
    const cls     = ai.is_valid ? 'valid' : ai.confidence === 'low' ? 'unknown' : 'invalid';
    const icon    = ai.is_valid ? '✅' : ai.confidence === 'low' ? '⚠️' : '❌';
    const title   = ai.is_valid
      ? `Valid data detected: ${esc(ai.data_type)}`
      : `Wrong data: ${esc(ai.data_type)}`;
    const confBadge = `<span style="font-size:10px;opacity:.7;">(${ai.confidence} confidence)</span>`;

    // Build detected mapping chips
    const cm = ai.column_mapping || {};
    const chips = Object.entries(cm)
      .filter(([, v]) => v)
      .map(([k, v]) => `<span title="${esc(k)}">${esc(v)}</span>`)
      .join('');

    box.innerHTML = `
      <div class="ai-card ${cls}">
        <div class="ai-icon">${icon}</div>
        <div class="ai-body">
          <div class="ai-title">${title} ${confBadge}</div>
          <div class="ai-reason">${esc(ai.reason)}</div>
          ${chips ? `<div class="ai-mapping">Mapped columns: ${chips}</div>` : ''}
        </div>
      </div>`;

    // AI result is advisory only - never block the import
    document.getElementById('import-btn').disabled = false;
    document.getElementById('import-btn').title = '';
  } else {
    box.innerHTML = '';
    document.getElementById('import-btn').disabled = false;
  }

  const p = _previewData[sheet];
  if (!p) return;

  const hRow = p.headerRow != null ? `  ·  headers on row ${p.headerRow + 1}` : '';
  document.getElementById('preview-info').textContent = `${p.rowCount} rows  ·  ${p.columns.length} columns${hRow}`;
  const thead = document.getElementById('preview-thead');
  const tbody = document.getElementById('preview-tbody');
  thead.innerHTML = '<tr>' + p.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
  tbody.innerHTML = p.sample.map(row =>
    '<tr>' + p.columns.map(c => `<td style="white-space:nowrap;">${esc(row[c] ?? '')}</td>`).join('') + '</tr>'
  ).join('');
}

async function doImport() {
  const sheet = document.getElementById('import-sheet-select').value;
  const ai    = _aiResults[sheet] || {};

  const btn = document.getElementById('import-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const r = await fetch(`${API}/api/upload/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tempPath:    _tempPath,
        sheetName:   sheet,
        aiColumnMap: ai.column_mapping || null,
        headerRow:   _headerRows[sheet] ?? null,
      }),
    }).then(r => r.json());

    if (r.error) { toast(r.error, 'err'); }
    else {
      toast(`Imported ${r.inserted} companies (${r.skipped} skipped)`, 'ok');
      resetImport();
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import into Database';
  }
}

function resetImport() {
  _tempPath = null; _sheets = []; _previewData = {}; _aiResults = {}; _headerRows = {};
  document.getElementById('preview-box').style.display = 'none';
  document.getElementById('ai-assessment').innerHTML = '';
}

// Drag & drop (import page only)
const dz = document.getElementById('dropzone');
if (dz) {
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const fakeEvent = { target: { files: [file], value: '' } };
    handleExcelUpload(fakeEvent);
  });
}

// ── Sync analyses ──
async function syncAnalyses() {
  const btn = document.querySelector('[onclick="syncAnalyses()"]');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  const res = document.getElementById('sync-result');
  res.textContent = '';

  try {
    const r = await fetch(`${API}/api/upload/sync-analyses`, { method: 'POST' }).then(r => r.json());
    if (r.error) {
      res.style.color = 'var(--danger)';
      res.textContent = '✗ ' + r.error;
    } else {
      res.style.color = 'var(--success)';
      res.textContent = `✓ Imported ${r.imported} | Skipped ${r.skipped}` +
        (r.errors.length ? ` | ${r.errors.length} errors` : '');
      toast(`Sync complete: ${r.imported} imported`, 'ok');
    }
  } catch (e) {
    res.style.color = 'var(--danger)';
    res.textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Sync Analysis Files';
  }
}

// ── TSX/TSXV Seeder ──
async function seedTsx() {
  const btn = document.getElementById('seed-tsx-btn');
  const res = document.getElementById('seed-result');
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  res.textContent = '';
  document.getElementById('seed-preview').style.display = 'none';

  try {
    const r = await fetch(`${API}/api/seeder/tsx`, { method: 'POST' }).then(r => r.json());
    if (r.error) {
      res.style.color = 'var(--danger)';
      res.innerHTML = '✗ ' + esc(r.error);
    } else {
      res.style.color = 'var(--success)';
      const sheetLines = (r.sheets || []).map(s => `${s.name}: +${s.inserted} new, ${s.skipped} skipped`).join(' &nbsp;·&nbsp; ');
      res.innerHTML = `✓ Total: <strong>${r.inserted} new companies</strong>, ${r.skipped} already existed`
        + (sheetLines ? `<br><span style="font-size:12px;color:var(--muted);">${sheetLines}</span>` : '')
        + (r.errors.length ? `<br><span style="color:var(--danger);font-size:12px;">${r.errors.length} row error(s)</span>` : '');
      toast(`Seeded ${r.inserted} new companies`, 'ok');
    }
  } catch (e) {
    res.style.color = 'var(--danger)';
    res.textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Seed from TSX / TSXV';
  }
}

async function previewTsx() {
  const res     = document.getElementById('seed-result');
  const preBox  = document.getElementById('seed-preview');
  res.style.color = 'var(--muted)';
  res.textContent = 'Fetching preview…';
  preBox.style.display = 'none';

  try {
    const r = await fetch(`${API}/api/seeder/tsx/preview`).then(r => r.json());
    if (r.error) { res.style.color = 'var(--danger)'; res.innerHTML = '✗ ' + esc(r.error); return; }

    res.textContent = '';
    let html = '';
    for (const [sheet, p] of Object.entries(r.preview)) {
      html += `<div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:6px;">${esc(sheet)} - ${p.rowCount} rows</div>
        <div class="table-wrap" style="max-height:160px;overflow:auto;">
          <table>
            <thead><tr>${p.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${p.sample.map(row => '<tr>' + p.columns.map(c => `<td style="white-space:nowrap;">${esc(row[c] ?? '')}</td>`).join('') + '</tr>').join('')}</tbody>
          </table>
        </div>
      </div>`;
    }
    preBox.innerHTML = html;
    preBox.style.display = 'block';
  } catch (e) {
    res.style.color = 'var(--danger)';
    res.textContent = '✗ ' + e.message;
  }
}

// ── CSE Seeder ──
async function loadCseStatus() {
  try {
    const s = await fetch(`${API}/api/seeder/cse/status`).then(r => r.json());
    const btn = document.getElementById('seed-cse-btn');
    const statusEl = document.getElementById('seed-cse-status');
    if (!s.allowed) {
      btn.disabled = true;
      btn.title = `Next seed available at ${new Date(s.nextSeed).toLocaleString()}`;
      const hrs = Math.floor(s.minutesLeft / 60);
      const mins = s.minutesLeft % 60;
      statusEl.textContent = `⏳ Cooldown: ${hrs}h ${mins}m left`;
      statusEl.style.color = 'var(--watch)';
    } else {
      btn.disabled = false;
      btn.title = '';
      if (s.lastSeed) {
        const ago = Math.round((Date.now() - new Date(s.lastSeed).getTime()) / 3600000);
        statusEl.textContent = `Last seeded ${ago}h ago`;
        statusEl.style.color = 'var(--muted)';
      } else {
        statusEl.textContent = 'Never seeded';
        statusEl.style.color = 'var(--muted)';
      }
    }
  } catch { /* ignore */ }
}

async function seedCse() {
  const btn    = document.getElementById('seed-cse-btn');
  const res    = document.getElementById('seed-cse-result');
  const logBox = document.getElementById('seed-cse-logs');
  btn.disabled = true;
  btn.textContent = 'Running browser…';
  res.textContent = '';
  logBox.innerHTML = '';
  logBox.style.display = 'block';

  try {
    const resp = await fetch(`${API}/api/seeder/cse`, { method: 'POST' });
    const r = await resp.json();

    if (!resp.ok && resp.status === 429) {
      res.style.color = 'var(--watch)';
      res.innerHTML = '⏳ ' + esc(r.error);
      loadCseStatus();
      return;
    }

    // Show scraper log lines
    if (r.logs && r.logs.length) {
      logBox.innerHTML = r.logs.map(l => `<div class="log-out">${esc(l)}</div>`).join('');
      logBox.scrollTop = logBox.scrollHeight;
    }

    if (r.error) {
      res.style.color = 'var(--danger)';
      res.innerHTML = '✗ ' + esc(r.error);
    } else {
      res.style.color = 'var(--success)';
      res.innerHTML = `✓ <strong>${r.inserted} new CSE companies</strong> added, ${r.skipped} already existed`
        + (r.errors.length ? `<br><span style="color:var(--danger);font-size:12px;">${r.errors.length} row error(s)</span>` : '');
      toast(`CSE seed: ${r.inserted} new companies`, 'ok');
    }
    loadCseStatus();
  } catch (e) {
    res.style.color = 'var(--danger)';
    res.textContent = '✗ ' + e.message;
    logBox.style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Seed CSE';
  }
}

// ── ASX Seeder ──
async function loadAsxStatus() {
  try {
    const s = await fetch(`${API}/api/seeder/asx/status`).then(r => r.json());
    const btn = document.getElementById('seed-asx-btn');
    const statusEl = document.getElementById('seed-asx-status');
    if (!s.allowed) {
      btn.disabled = true;
      btn.title = `Next seed available at ${new Date(s.nextSeed).toLocaleString()}`;
      const hrs = Math.floor(s.minutesLeft / 60);
      const mins = s.minutesLeft % 60;
      statusEl.textContent = `⏳ Cooldown: ${hrs}h ${mins}m left`;
      statusEl.style.color = 'var(--watch)';
    } else {
      btn.disabled = false;
      btn.title = '';
      if (s.lastSeed) {
        const ago = Math.round((Date.now() - new Date(s.lastSeed).getTime()) / 3600000);
        statusEl.textContent = `Last seeded ${ago}h ago`;
        statusEl.style.color = 'var(--muted)';
      } else {
        statusEl.textContent = 'Never seeded';
        statusEl.style.color = 'var(--muted)';
      }
    }
  } catch { /* ignore */ }
}

async function seedAsx() {
  const btn    = document.getElementById('seed-asx-btn');
  const res    = document.getElementById('seed-asx-result');
  const logBox = document.getElementById('seed-asx-logs');
  btn.disabled = true;
  btn.textContent = 'Running browser…';
  res.textContent = '';
  logBox.innerHTML = '';
  logBox.style.display = 'block';

  try {
    const resp = await fetch(`${API}/api/seeder/asx`, { method: 'POST' });
    const r = await resp.json();

    if (!resp.ok && resp.status === 429) {
      res.style.color = 'var(--watch)';
      res.innerHTML = '⏳ ' + esc(r.error);
      loadAsxStatus();
      return;
    }

    if (r.logs && r.logs.length) {
      logBox.innerHTML = r.logs.map(l => `<div class="log-out">${esc(l)}</div>`).join('');
      logBox.scrollTop = logBox.scrollHeight;
    }

    if (r.error) {
      res.style.color = 'var(--danger)';
      res.innerHTML = '✗ ' + esc(r.error);
    } else {
      res.style.color = 'var(--success)';
      res.innerHTML = `✓ <strong>${r.inserted} new ASX companies</strong> added, ${r.skipped} already existed`
        + (r.errors && r.errors.length ? `<br><span style="color:var(--danger);font-size:12px;">${r.errors.length} row error(s)</span>` : '');
      toast(`ASX seed: ${r.inserted} new companies`, 'ok');
    }
    loadAsxStatus();
  } catch (e) {
    res.style.color = 'var(--danger)';
    res.textContent = '✗ ' + e.message;
    logBox.style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Seed ASX';
  }
}

// ── Companies pagination (declared above loadCompanies) ──

// ── Scraper ──
let _pollId = null;
let _asxSelectedTicker = '';

function updateScraperPlaceholder() {
  const exch     = document.getElementById('scrape-exchange').value;
  const sedarWrap = document.getElementById('scrape-company-wrap');
  const asxWrap  = document.getElementById('scrape-asx-wrap');
  const runBtn   = document.getElementById('run-btn');
  if (exch === 'ASX') {
    sedarWrap.style.display = 'none';
    asxWrap.style.display   = 'block';
    runBtn.textContent      = '▶ Run ASX Scraper';
  } else {
    sedarWrap.style.display = 'block';
    asxWrap.style.display   = 'none';
    runBtn.textContent      = '▶ Run Scraper';
  }
}

async function asxCompanySearch() {
  const q = document.getElementById('scrape-asx-company').value.trim();
  _asxSelectedTicker = '';
  document.getElementById('asx-ticker-badge').style.display = 'none';

  const ac = document.getElementById('asx-autocomplete');
  if (q.length < 2) { ac.style.display = 'none'; return; }

  try {
    const companies = await fetch(`${API}/api/companies?search=${encodeURIComponent(q)}&exchange=ASX`).then(r => r.json());
    if (!companies.length) { ac.style.display = 'none'; return; }
    ac.innerHTML = companies.slice(0, 10).map(c =>
      `<div class="asx-ac-item" onclick="asxSelectCompany('${esc(c.ticker)}','${esc(c.name).replace(/'/g,'\\&apos;')}')">
        <span>${esc(c.name)}</span><span class="ac-ticker">${esc(c.ticker)}</span>
      </div>`
    ).join('');
    ac.style.display = 'block';
  } catch {}
}

function asxSelectCompany(ticker, name) {
  _asxSelectedTicker = ticker;
  document.getElementById('scrape-asx-company').value = name;
  document.getElementById('asx-autocomplete').style.display = 'none';
  document.getElementById('asx-ticker-label').textContent = ticker;
  document.getElementById('asx-ticker-badge').style.display = 'block';
}

// Close autocomplete when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#scrape-asx-wrap')) {
    const ac = document.getElementById('asx-autocomplete');
    if (ac) ac.style.display = 'none';
  }
});

async function runScraper() {
  const exchange = document.getElementById('scrape-exchange').value;
  const mode     = document.getElementById('scrape-mode').value;
  const isASX    = exchange === 'ASX';

  let company;
  if (isASX) {
    if (!_asxSelectedTicker) { toast('Select an ASX company from the dropdown', 'err'); return; }
    company = _asxSelectedTicker;
  } else {
    company = document.getElementById('scrape-company').value.trim();
    if (!company) { toast('Enter a company name', 'err'); return; }
  }

  const btn = document.getElementById('run-btn');
  btn.disabled    = true;
  btn.textContent = 'Starting…';

  try {
    const body = { company, mode, exchange: exchange || undefined };
    const r = await fetch(`${API}/api/scraper/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());

    if (r.error) { toast(r.error, 'err'); return; }

    const label = isASX
      ? `${document.getElementById('scrape-asx-company').value} (${_asxSelectedTicker})`
      : company;
    toast(`Scraper started for "${label}"`, 'ok');
    showLog(r.id, label);
    loadRuns();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled    = false;
    btn.textContent = isASX ? '▶ Run ASX Scraper' : '▶ Run Scraper';
  }
}

function showLog(id, company) {
  const section = document.getElementById('log-section');
  section.style.display = 'block';
  document.getElementById('log-company').textContent = company;

  if (_pollId) clearInterval(_pollId);
  const box = document.getElementById('log-box');
  box.innerHTML = '';
  let lastLen = 0;

  _pollId = setInterval(async () => {
    try {
      const r = await fetch(`${API}/api/scraper/status/${id}`).then(r => r.json());
      const badge = document.getElementById('log-status');
      badge.textContent  = r.status.toUpperCase();
      badge.className    = 'badge ' + (r.status === 'done' ? 'badge-analyzed' : r.status === 'error' ? 'badge-noteworthy' : 'badge-pending');

      const newLogs = r.logs.slice(lastLen);
      lastLen = r.logs.length;
      for (const l of newLogs) {
        const div = document.createElement('div');
        div.className = l.t === 'err' ? 'log-err' : 'log-out';
        div.textContent = l.msg;
        box.appendChild(div);
      }
      box.scrollTop = box.scrollHeight;

      if (r.status === 'done' || r.status === 'error') {
        clearInterval(_pollId);
        _pollId = null;
        loadRuns();
      }
    } catch { /* ignore */ }
  }, 1500);
}

async function loadRuns() {
  try {
    const runs = await fetch(`${API}/api/scraper/runs`).then(r => r.json());
    const list = document.getElementById('runs-list');
    if (!runs.length) { list.textContent = 'No runs yet.'; return; }
    list.innerHTML = runs.slice(0, 10).map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <span>${esc(r.company)} <span style="color:var(--muted);font-size:11px;">(${r.mode})</span></span>
        <span class="badge ${r.status==='done'?'badge-analyzed':r.status==='error'?'badge-noteworthy':'badge-pending'}">${r.status}</span>
      </div>`).join('');
  } catch { /* ignore */ }
}

// ── Helpers ──
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function verdictBadge(v) {
  if (!v) return '<span class="badge badge-pending">-</span>';
  const cls = v === 'noteworthy' ? 'badge-noteworthy' : v === 'watch' ? 'badge-watch' : 'badge-routine';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

// ── Init ──
// (per-page init runs via initAdminPage on DOMContentLoaded)

// ════════════════════════════════════════════════════════════════════════════
// ── Pipeline ──
// ════════════════════════════════════════════════════════════════════════════

function mountPipelineCronBuilders() {
  const mount = (id, prefix, label) => {
    const el = document.getElementById(id);
    if (el && typeof cronBuilderHtml === 'function') el.innerHTML = cronBuilderHtml(prefix, label);
  };
  mount('pl-main-cron-mount', 'pl-main', 'Filing pipeline schedule');
  mount('pl-asx-cron-mount', 'pl-asx', 'ASX pipeline schedule');
  mount('pl-news-cron-mount', 'pl-news', 'News releases schedule');
  mount('pl-prof-cron-mount', 'pl-prof', 'Profile scrape schedule');
  mount('pl-seed-cron-mount', 'pl-seed', 'Company list seeders schedule');
}

function plLogsQuery(offset) {
  const src = encodeURIComponent(_plLogSource || 'all');
  return `${API}/api/pipeline/logs?offset=${offset}&source=${src}`;
}

async function refreshLogSourceDropdown() {
  const sel = document.getElementById('pl-log-source');
  if (!sel) return false;
  const prevSource = _plLogSource || 'all';
  try {
    const data = await fetch(`${API}/api/pipeline/log-sources`).then((r) => r.json());
    const prev = sel.value || prevSource;
    sel.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `All logs (${data.sources?.find((s) => s.id === 'all')?.logCount ?? 0})`;
    sel.appendChild(allOpt);

    const running = data.running || [];
    if (running.length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = 'Running now';
      for (const s of running) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `● ${s.label} (${s.logCount} lines)`;
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    }

    const idle = (data.idle || []).filter((s) => s.logCount > 0);
    if (idle.length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = 'Recent (idle)';
      for (const s of idle) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.label} (${s.logCount} lines)`;
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    }

    const valid = [...sel.options].some((o) => o.value === prev);
    sel.value = valid ? prev : prevSource;
    _plLogSource = sel.value;
    return prevSource !== _plLogSource;
  } catch { /* ignore */ }
  return false;
}

async function onLogSourceChange() {
  const sel = document.getElementById('pl-log-source');
  _plLogSource = sel?.value || 'all';
  await pipelineReloadLogs();
}

function plSwitchTab(name, opts = {}) {
  document.querySelectorAll('.pl-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.plTab === name);
  });
  document.querySelectorAll('.pl-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `pl-panel-${name}`);
  });
  if (name === 'logs' && !opts.skipReload) pipelineReloadLogs();
}

async function pipelineInit() {
  mountPipelineCronBuilders();
  const params = new URLSearchParams(window.location.search);
  if (params.get('pp_ticker')) {
    const t = document.getElementById('pp-ticker');
    if (t) t.value = params.get('pp_ticker');
  }
  if (params.get('log')) _plLogSource = params.get('log');
  if (params.get('tab') === 'logs') plSwitchTab('logs', { skipReload: true });
  await pipelineLoadConfig();
  await refreshLogSourceDropdown();
  await pipelineReloadLogs();
  await pipelinePollStatus();
  if (!_plPollId) {
    _plPollId = setInterval(pipelinePollStatus, 2500);
  }
  try {
    const r = await fetch(`${API}/api/pipeline/profiles/status`).then((x) => x.json());
    if (r.running) {
      setProfilesRunningUI(true);
      profilesPollStatus();
    }
  } catch { /* ignore */ }
  try {
    const r = await fetch(`${API}/api/pipeline/transfer-agents/status`).then((x) => x.json());
    if (r.running) {
      setTaRunningUI(true, { skipTab: true });
      taPollStatus();
    }
  } catch { /* ignore */ }
}

async function pipelineLoadConfig() {
  try {
    const cfg = await fetch(`${API}/api/pipeline/config`).then(r => r.json());
    if (cfg.mainScheduleParts) cronApplyBuilder('pl-main', cfg.mainScheduleParts);
    if (cfg.asxScheduleParts) cronApplyBuilder('pl-asx', cfg.asxScheduleParts);
    if (cfg.newsScheduleParts) cronApplyBuilder('pl-news', cfg.newsScheduleParts);
    if (cfg.profilesScheduleParts) cronApplyBuilder('pl-prof', cfg.profilesScheduleParts);
    if (cfg.seederScheduleParts) cronApplyBuilder('pl-seed', cfg.seederScheduleParts);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    set('pl-concurrency', cfg.concurrency || 5);
    set('pl-ai-concurrency', cfg.analysisConcurrency || 2);
    set('pl-daysback', cfg.daysBack || 30);
    setChk('pl-seed-on-start', cfg.seedOnStart);
    setChk('pl-analyze', cfg.analyze);
    setChk('pl-enabled', cfg.enabled);
    set('pl-asx-concurrency', cfg.asxConcurrency ?? cfg.concurrency ?? 5);
    set('pl-asx-ai-concurrency', cfg.asxAnalysisConcurrency ?? cfg.analysisConcurrency ?? 2);
    set('pl-asx-daysback', cfg.asxDaysBack ?? cfg.daysBack ?? 30);
    setChk('pl-asx-seed-on-start', cfg.asxSeedOnStart !== false);
    setChk('pl-asx-analyze', cfg.asxAnalyze !== false ? cfg.asxAnalyze : cfg.analyze);
    setChk('pl-asx-enabled', cfg.asxEnabled);
    setChk('pl-news-enabled', cfg.newsEnabled);
    setChk('pl-prof-enabled', cfg.profilesEnabled);
    setChk('pl-seed-cron-enabled', cfg.seederEnabled);
    set('pp-delay', cfg.profilesDelay || 2500);
    updateCronPreviews(cfg);
  } catch { /* ignore */ }
}

function updateCronPreviews(cfg) {
  const setPrev = (id, parts) => {
    const el = document.getElementById(id);
    if (el) el.textContent = cronDescribe(parts);
  };
  setPrev('pl-main-preview', cfg?.mainScheduleParts);
  setPrev('pl-asx-preview', cfg?.asxScheduleParts);
  setPrev('pl-news-preview', cfg?.newsScheduleParts);
  setPrev('pl-prof-preview', cfg?.profilesScheduleParts);
  setPrev('pl-seed-preview', cfg?.seederScheduleParts);
}

async function pipelinePollStatus() {
  try {
    const s = await fetch(`${API}/api/pipeline/status`).then(r => r.json());
    renderPipelineStatus(s);
    const sourceChanged = await refreshLogSourceDropdown();
    if (sourceChanged) await pipelineReloadLogs();
    else await pipelineFetchLogs();
  } catch { /* ignore */ }
}

function renderPipelineStatus(s) {
  const dot    = document.getElementById('pl-dot');
  const label  = document.getElementById('pl-status-label');
  const sub    = document.getElementById('pl-status-sub');
  const wrap   = document.getElementById('pl-progress-wrap');
  const fill   = document.getElementById('pl-progress-fill');
  const startB = document.getElementById('pl-start-btn');
  const stopB  = document.getElementById('pl-stop-btn');

  dot.className = `pl-hero-dot status-dot ${s.status}`;
  label.textContent = s.status === 'running' ? (s.currentPhase ? `Running - ${s.currentPhase}` : 'Running') : 'Idle';

  if (s.status === 'running') {
    const p = s.progress || {};
    const ap = s.analysisProgress || {};
    const done  = p.done  || 0;
    const total = p.total || 0;
    const pct   = total > 0 ? Math.round(done / total * 100) : 0;
    const aiDone  = ap.done  || 0;
    const aiTotal = ap.total || 0;
    const aiPct   = aiTotal > 0 ? Math.round(aiDone / aiTotal * 100) : 0;
    let statusText = '';
    if (total > 0) statusText += `${done}/${total} downloads (${pct}%)`;
    if (aiTotal > 0) statusText += `${total > 0 ? ' · ' : ''}${aiDone}/${aiTotal} analyzed (${aiPct}%)`;
    if (p.errors || ap.errors) statusText += `${total > 0 || aiTotal > 0 ? ' · ' : ''}${(p.errors || 0) + (ap.errors || 0)} errors`;
    sub.textContent = statusText || (s.currentPhase === 'seeding' ? 'Seeding company lists…' : 'Initializing…');
    wrap.style.display = total > 0 ? 'block' : 'none';
    fill.style.width   = `${pct}%`;
    startB.style.display = 'none';
    stopB.style.display  = 'inline-flex';
  } else {
    const when = s.stoppedAt ? `Last run: ${new Date(s.stoppedAt).toLocaleString()}` : 'Never run';
    sub.textContent = when;
    wrap.style.display   = 'none';
    startB.style.display = 'inline-flex';
    stopB.style.display  = 'none';
  }

  // Stats
  const p = s.progress || {};
  document.getElementById('pl-stat-total').textContent = p.total  ?? '-';
  document.getElementById('pl-stat-done').textContent  = p.done   ?? '-';
  document.getElementById('pl-stat-err').textContent   = p.errors ?? '-';
  document.getElementById('pl-stat-phase').textContent = s.currentPhase || '-';

  // AI stats
  const ap = s.analysisProgress || {};
  const aiTotal = ap.total || 0;
  const aiDone  = ap.done  || 0;
  const aiErr   = ap.errors || 0;
  const aiPct   = aiTotal > 0 ? Math.round(aiDone / aiTotal * 100) : 0;
  document.getElementById('pl-stat-ai-total').textContent = aiTotal || '-';
  document.getElementById('pl-stat-ai-done').textContent  = aiDone  || '-';
  document.getElementById('pl-stat-ai-err').textContent   = aiErr   || '-';
  document.getElementById('pl-stat-ai-pct').textContent  = aiTotal > 0 ? `${aiPct}%` : '-';

  // Cron status
  const cronEl = document.getElementById('pl-cron-status');
  if (cronEl) {
    if (s.cronEnabled) {
      cronEl.innerHTML = `<span style="color:var(--success);">● Enabled</span> - <span style="color:var(--muted);">${esc(s.scheduleDescription || s.schedule)}</span>`;
    } else {
      cronEl.innerHTML = `<span style="color:var(--muted);">Disabled</span>`;
    }
  }

  const asxCronEl = document.getElementById('pl-asx-cron-status');
  if (asxCronEl) {
    if (s.cronAsxEnabled) {
      asxCronEl.innerHTML = `<span style="color:var(--success);">● Enabled</span> - <span style="color:var(--muted);">${esc(s.asxScheduleDescription || s.asxSchedule)}</span>`;
    } else {
      asxCronEl.innerHTML = `<span style="color:var(--muted);">Disabled</span>`;
    }
  }

  const newsCronEl = document.getElementById('pl-news-cron-status');
  if (newsCronEl) {
    if (s.newsEnabled) {
      newsCronEl.innerHTML = `<span style="color:var(--success);">● Enabled</span> - ${esc(s.newsScheduleDescription || s.newsSchedule)}${s.newsRunning ? ' <span style="color:var(--accent);">(running)</span>' : ''}`;
    } else {
      newsCronEl.innerHTML = `<span style="color:var(--muted);">Disabled</span>`;
    }
  }

  const profCronEl = document.getElementById('pl-prof-cron-status');
  if (profCronEl) {
    profCronEl.innerHTML = s.profilesEnabled
      ? `<span style="color:var(--success);">● Enabled</span> - ${esc(s.profilesScheduleDescription || s.profilesSchedule)}`
      : `<span style="color:var(--muted);">Disabled</span>`;
  }

  const seedCronEl = document.getElementById('pl-seed-cron-status');
  if (seedCronEl) {
    seedCronEl.innerHTML = s.seederEnabled
      ? `<span style="color:var(--success);">● Enabled</span> - ${esc(s.seederScheduleDescription || s.seederSchedule)}`
      : `<span style="color:var(--muted);">Disabled</span>`;
  }
}

function plLogBoxEmpty() {
  const box = document.getElementById('pl-log-box');
  return !box || box.children.length === 0;
}

function renderPlLogEmpty(message) {
  const box = document.getElementById('pl-log-box');
  if (!box) return;
  box.innerHTML = `<div class="pl-log-empty">${esc(message || 'No log lines for this process yet.')}</div>`;
}

function appendPipelineLogEntries(entries) {
  const box = document.getElementById('pl-log-box');
  if (!box || !entries?.length) return;
  const empty = box.querySelector('.pl-log-empty');
  if (empty) empty.remove();
  const autoscrl = document.getElementById('pl-autoscroll')?.checked !== false;
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = `ll-${entry.level || 'log'}`;
    const ts = new Date(entry.t).toLocaleTimeString();
    div.textContent = `[${ts}] ${entry.msg}`;
    box.appendChild(div);
  }
  if (autoscrl) box.scrollTop = box.scrollHeight;
}

async function pipelineReloadLogs() {
  const box = document.getElementById('pl-log-box');
  if (!box) return;
  _plLogClear = false;
  _plLogOffset = 0;
  box.innerHTML = '';
  try {
    const data = await fetch(plLogsQuery(0)).then((r) => r.json());
    if (data.logs?.length) {
      appendPipelineLogEntries(data.logs);
    } else if ((data.total ?? 0) === 0) {
      renderPlLogEmpty('No log lines for this process yet.');
    }
    _plLogOffset = data.total || 0;
  } catch {
    renderPlLogEmpty('Could not load logs - check that the server is running.');
  }
}

async function pipelineFetchLogs() {
  try {
    if (_plLogClear) return;
    const data = await fetch(plLogsQuery(_plLogOffset)).then((r) => r.json());
    if ((data.total ?? 0) < _plLogOffset) {
      await pipelineReloadLogs();
      return;
    }
    if (!data.logs || data.logs.length === 0) {
      if ((data.total ?? 0) > 0 && plLogBoxEmpty()) await pipelineReloadLogs();
      else if ((data.total ?? 0) === 0 && plLogBoxEmpty()) renderPlLogEmpty();
      return;
    }
    appendPipelineLogEntries(data.logs);
    _plLogOffset = data.total;
  } catch { /* ignore */ }
}

function pipelineClearLogs() {
  _plLogOffset = 0;
  pipelineReloadLogs();
}

async function pipelineStart() {
  try {
    const r = await fetch(`${API}/api/pipeline/start`, { method: 'POST' }).then(r => r.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('Pipeline started');
    _plLogOffset = 0;
    document.getElementById('pl-log-box').innerHTML = '';
    await pipelinePollStatus();
  } catch (err) { toast(err.message, 'err'); }
}

async function pipelineStop() {
  try {
    const r = await fetch(`${API}/api/pipeline/stop`, { method: 'POST' }).then(r => r.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('Stop signal sent');
  } catch (err) { toast(err.message, 'err'); }
}

async function pipelineSaveConfig() {
  const cfg = {
    mainScheduleParts: cronReadBuilder('pl-main'),
    asxScheduleParts: cronReadBuilder('pl-asx'),
    newsScheduleParts: cronReadBuilder('pl-news'),
    profilesScheduleParts: cronReadBuilder('pl-prof'),
    seederScheduleParts: cronReadBuilder('pl-seed'),
    concurrency: parseInt(document.getElementById('pl-concurrency').value),
    analysisConcurrency: parseInt(document.getElementById('pl-ai-concurrency').value),
    daysBack: parseInt(document.getElementById('pl-daysback').value),
    seedOnStart: document.getElementById('pl-seed-on-start').checked,
    analyze: document.getElementById('pl-analyze').checked,
    enabled: document.getElementById('pl-enabled').checked,
    asxConcurrency: parseInt(document.getElementById('pl-asx-concurrency')?.value),
    asxAnalysisConcurrency: parseInt(document.getElementById('pl-asx-ai-concurrency')?.value),
    asxDaysBack: parseInt(document.getElementById('pl-asx-daysback')?.value),
    asxSeedOnStart: document.getElementById('pl-asx-seed-on-start')?.checked,
    asxAnalyze: document.getElementById('pl-asx-analyze')?.checked,
    asxEnabled: document.getElementById('pl-asx-enabled').checked,
    newsEnabled: document.getElementById('pl-news-enabled')?.checked,
    profilesEnabled: document.getElementById('pl-prof-enabled')?.checked,
    profilesDelay: parseInt(document.getElementById('pp-delay')?.value) || 2500,
    seederEnabled: document.getElementById('pl-seed-cron-enabled')?.checked,
  };
  try {
    const r = await fetch(`${API}/api/pipeline/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    }).then(r => r.json());
    if (r.error) { toast(r.error, 'err'); return; }
    const msg = document.getElementById('pl-config-msg');
    msg.style.display = 'inline';
    setTimeout(() => { msg.style.display = 'none'; }, 2000);
    toast('Config saved');
    updateCronPreviews(r);
    renderPipelineStatus({ ...r, status: 'idle', progress: {} });
  } catch (err) { toast(err.message, 'err'); }
}

async function pipelineNewsStart() {
  try {
    const r = await fetch(`${API}/api/pipeline/news/start`, { method: 'POST' }).then(x => x.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('News pipeline started');
    await pipelinePollStatus();
  } catch (err) { toast(err.message, 'err'); }
}

async function pipelineSeedersStart() {
  try {
    const r = await fetch(`${API}/api/pipeline/seeders/start`, { method: 'POST' }).then(x => x.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('Seeders started');
  } catch (err) { toast(err.message, 'err'); }
}

async function pipelineCronToggle(enabled, which = 'main') {
  const map = {
    main: { enabled, label: 'Main pipeline' },
    asx: { asxEnabled: enabled, label: 'ASX pipeline' },
    news: { newsEnabled: enabled, label: 'News pipeline' },
    profiles: { profilesEnabled: enabled, label: 'Profile scrape' },
    seeders: { seederEnabled: enabled, label: 'Company seeders' },
  };
  const body = map[which] || map.main;
  const label = body.label;
  delete body.label;
  try {
    await fetch(`${API}/api/pipeline/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    toast(enabled ? `${label} enabled` : `${label} disabled`);
  } catch { /* ignore */ }
}

async function pipelineStartAsx() {
  try {
    const r = await fetch(`${API}/api/pipeline/asx/start`, { method: 'POST' }).then(r => r.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('ASX pipeline started');
    _plLogOffset = 0;
    document.getElementById('pl-log-box').innerHTML = '';
    await pipelinePollStatus();
  } catch (err) { toast(err.message, 'err'); }
}

// --- Company profile scraper (MarketScreener) -------------------------------

let _ppPollTimer = null;
let _taPollTimer = null;

async function profilesStart() {
  const body = {};
  const limit   = parseInt(document.getElementById('pp-limit').value);
  const ticker  = document.getElementById('pp-ticker').value.trim();
  const refresh = parseInt(document.getElementById('pp-refresh').value);
  const delay   = parseInt(document.getElementById('pp-delay').value);
  const dryRun  = document.getElementById('pp-dry-run').checked;
  if (!isNaN(limit))   body.limit = limit;
  if (ticker)          body.ticker = ticker;
  if (!isNaN(refresh)) body.refreshDays = refresh;
  if (!isNaN(delay))   body.delay = delay;
  if (dryRun)          body.dryRun = true;
  try {
    const r = await fetch(`${API}/api/pipeline/profiles/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('Profile scrape started');
    await pipelineReloadLogs();
    setProfilesRunningUI(true);
    profilesPollStatus();
    await pipelinePollStatus();
  } catch (err) { toast(err.message, 'err'); }
}

function setProfilesRunningUI(running) {
  const btn = document.getElementById('pp-start-btn');
  const status = document.getElementById('pp-status');
  if (!status) return;
  if (running) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
    status.textContent = 'Running';
    status.className = 'pl-status-pill running';
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Run profiles'; }
    status.textContent = 'Idle';
    status.className = 'pl-status-pill';
  }
}

async function profilesPollStatus() {
  if (_ppPollTimer) clearInterval(_ppPollTimer);
  _ppPollTimer = setInterval(async () => {
    try {
      const r = await fetch(`${API}/api/pipeline/profiles/status`).then((x) => x.json());
      await pipelineFetchLogs();
      if (!r.running) {
        clearInterval(_ppPollTimer);
        _ppPollTimer = null;
        setProfilesRunningUI(false);
        await pipelineFetchLogs();
      }
    } catch { /* ignore */ }
  }, 2000);
}

// --- Transfer-agent scraper (SEDAR+ / TSX / TSX-V) --------------------------

async function transferAgentsStart() {
  const body = {};
  const limit  = parseInt(document.getElementById('ta-limit').value);
  const ticker = document.getElementById('ta-ticker').value.trim();
  if (!isNaN(limit)) body.limit = limit;
  if (ticker)        body.ticker = ticker;
  if (document.getElementById('ta-all').checked)     body.all = true;
  if (document.getElementById('ta-dry-run').checked) body.dryRun = true;
  try {
    const r = await fetch(`${API}/api/pipeline/transfer-agents/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((x) => x.json());
    if (r.error) {
      if (r.running) {
        toast('Already running - switched to Live log', 'ok');
        _plLogSource = 'transfer-agents';
        const sel = document.getElementById('pl-log-source');
        if (sel) sel.value = 'transfer-agents';
        setTaRunningUI(true, { skipTab: true });
        taPollStatus();
        plSwitchTab('logs');
        await pipelineReloadLogs();
        return;
      }
      toast(r.error, 'err');
      return;
    }
    toast('Transfer-agent scrape started');
    await pipelineReloadLogs();
    setTaRunningUI(true);
    taPollStatus();
    await pipelinePollStatus();
  } catch (err) { toast(err.message, 'err'); }
}

function setTaRunningUI(running, opts = {}) {
  const btn = document.getElementById('ta-start-btn');
  const stopBtn = document.getElementById('ta-stop-btn');
  const status = document.getElementById('ta-status');
  if (!status) return;
  if (running) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    status.textContent = 'Running';
    status.className = 'pl-status-pill running';
    if (!opts.skipTab) {
      _plLogSource = 'transfer-agents';
      const sel = document.getElementById('pl-log-source');
      if (sel) sel.value = 'transfer-agents';
      plSwitchTab('logs');
      pipelineReloadLogs();
    }
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Run scrape'; }
    if (stopBtn) stopBtn.style.display = 'none';
    status.textContent = 'Idle';
    status.className = 'pl-status-pill';
  }
}

async function taPollStatus() {
  if (_taPollTimer) clearInterval(_taPollTimer);
  _taPollTimer = setInterval(async () => {
    try {
      const r = await fetch(`${API}/api/pipeline/transfer-agents/status`).then((x) => x.json());
      await pipelineFetchLogs();
      if (!r.running) {
        clearInterval(_taPollTimer);
        _taPollTimer = null;
        setTaRunningUI(false);
        await pipelineFetchLogs();
      }
    } catch { /* ignore */ }
  }, 2000);
}

async function transferAgentsStop() {
  try {
    const r = await fetch(`${API}/api/pipeline/transfer-agents/stop`, { method: 'POST' }).then((x) => x.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast('Stop signal sent');
    setTaRunningUI(false);
  } catch (err) { toast(err.message, 'err'); }
}

// ── System monitor ──
let _sysPollId = null;

async function processesInit() {
  await refreshSystemMonitor();
  if (!_sysPollId) _sysPollId = setInterval(refreshSystemMonitor, 4000);
}

async function refreshSystemMonitor() {
  try {
    const data = await fetch(`${API}/api/system/processes`).then((r) => r.json());
    if (data.error) throw new Error(data.error);

    document.getElementById('sys-ram-used').textContent = `${data.host?.ramUsedPct ?? '-'}%`;
    document.getElementById('sys-ram-sub').textContent = `${data.host?.ramFree ?? '-'} free of ${data.host?.ramTotal ?? '-'}`;
    document.getElementById('sys-server-ram').textContent = `${data.server?.ramMB ?? '-'} MB`;
    document.getElementById('sys-server-uptime').textContent = `Uptime ${data.server?.uptime ?? '-'} · ${data.logCount ?? 0} log lines`;
    document.getElementById('sys-cpus').textContent = data.host?.cpus ?? '-';
    document.getElementById('sys-load').textContent = `Load ${(data.host?.loadAvg || []).join(', ') || '-'}`;
    document.getElementById('sys-platform').textContent = data.host?.platform ?? '-';
    document.getElementById('sys-host-uptime').textContent = `Host uptime ${data.host?.uptime ?? '-'}`;
    document.getElementById('sys-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;

    const diskBody = document.getElementById('sys-disk-body');
    const disks = data.disk || [];
    if (!disks.length) {
      diskBody.innerHTML = '<tr class="empty-row"><td colspan="4">No disk stats available</td></tr>';
    } else {
      diskBody.innerHTML = disks.map((d) => `
        <tr><td>${esc(d.mount)}</td><td>${esc(d.total)}</td><td>${esc(d.free)}</td><td>${d.usedPct != null ? d.usedPct + '%' : '-'}</td></tr>`).join('');
    }

    const procBody = document.getElementById('sys-proc-body');
    const procs = data.processes || [];
    if (!procs.length) {
      procBody.innerHTML = '<tr class="empty-row"><td colspan="7">No processes</td></tr>';
    } else {
      procBody.innerHTML = procs.map((p) => {
        const st = p.status || 'unknown';
        const stCls = st === 'running' ? 'status-running' : `status-${st}`;
        const canStop = ['transfer-agents', 'profiles'].includes(p.id) && st === 'running' && p.id !== 'server';
        return `<tr>
          <td><strong>${esc(p.label || p.id)}</strong></td>
          <td class="${stCls}">${esc(st)}</td>
          <td>${p.metrics?.pid ?? p.pid ?? '-'}</td>
          <td>${p.metrics?.ramMB != null ? p.metrics.ramMB + ' MB' : '-'}</td>
          <td>${esc(p.metrics?.cpu ?? '-')}</td>
          <td>${esc(p.runningFor ?? '-')}</td>
          <td>${canStop ? `<button class="btn btn-ghost btn-sm" onclick="stopSystemJob('${esc(p.id)}')">Stop</button>` : ''}
              ${p.id === 'transfer-agents' && st === 'running' ? `<a class="btn btn-ghost btn-sm" href="pipeline.html?tab=logs&amp;log=transfer-agents">Logs</a>` : ''}</td>
        </tr>`;
      }).join('');
    }
  } catch (err) {
    document.getElementById('sys-proc-body').innerHTML = `<tr class="empty-row"><td colspan="7">Error: ${esc(err.message)}</td></tr>`;
  }
}

async function stopSystemJob(id) {
  try {
    const r = await fetch(`${API}/api/system/jobs/${encodeURIComponent(id)}/stop`, { method: 'POST' }).then((x) => x.json());
    if (r.error) { toast(r.error, 'err'); return; }
    toast(r.message || 'Stopped');
    await refreshSystemMonitor();
  } catch (err) { toast(err.message, 'err'); }
}

async function clearStaleJobs() {
  try {
    const r = await fetch(`${API}/api/system/jobs/reset-stale`, { method: 'POST' }).then((x) => x.json());
    toast(`Cleared ${r.cleared ?? 0} stale job(s)`);
    await refreshSystemMonitor();
  } catch (err) { toast(err.message, 'err'); }
}

// ── Add company (admin) ──
function addCoVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function addCoChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function addCoPersonRowHtml(p, idx) {
  return `
    <tr data-idx="${idx}">
      <td><input value="${esc(p.name ?? '')}" data-field="name" placeholder="Full name" /></td>
      <td><input value="${esc(p.title ?? '')}" data-field="title" placeholder="Title" /></td>
      <td><button type="button" class="btn btn-danger btn-sm" onclick="removeAddCoPersonRow(${idx})" title="Remove">✕</button></td>
    </tr>`;
}

function _addCoPeopleForKind(kind) {
  return _addCoPeople
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => (p.kind || 'manager') === kind);
}

function renderAddCoPeopleRows() {
  renderAddCoPeopleSection('manager', 'add-co-managers-body');
  renderAddCoPeopleSection('director', 'add-co-directors-body');
}

function renderAddCoPeopleSection(kind, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const items = _addCoPeopleForKind(kind);
  if (!items.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Optional — click &ldquo;+ Add ${kind}&rdquo;.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(({ p, idx }) => addCoPersonRowHtml(p, idx)).join('');
}

function collectAllAddCoPersonRows() {
  const rows = [..._addCoPeople];
  document.querySelectorAll('#add-co-managers-body tr[data-idx], #add-co-directors-body tr[data-idx]').forEach((tr) => {
    const idx = parseInt(tr.dataset.idx, 10);
    if (!Number.isFinite(idx) || !rows[idx]) return;
    tr.querySelectorAll('[data-field]').forEach((el) => { rows[idx][el.dataset.field] = el.value; });
  });
  return rows;
}

function collectAddCoPeople() {
  return collectAllAddCoPersonRows()
    .filter((p) => p.name?.trim())
    .map((p) => ({
      name: p.name.trim(),
      title: (p.title || '').trim() || null,
      kind: p.kind === 'director' ? 'director' : 'manager',
    }));
}

function addCoPersonRow(kind) {
  const rows = collectAllAddCoPersonRows();
  rows.push({ name: '', title: '', kind: kind === 'director' ? 'director' : 'manager' });
  _addCoPeople = rows;
  renderAddCoPeopleRows();
}

function removeAddCoPersonRow(idx) {
  const rows = collectAllAddCoPersonRows();
  rows.splice(idx, 1);
  _addCoPeople = rows;
  renderAddCoPeopleRows();
}

function openAddCompanyModal() {
  const form = document.getElementById('add-co-form');
  if (form) form.reset();
  _addCoPeople = [];
  renderAddCoPeopleRows();
  document.getElementById('add-co-modal').classList.add('open');
}
function closeAddCompanyModal() {
  document.getElementById('add-co-modal').classList.remove('open');
}
async function submitAddCompany(e) {
  e.preventDefault();
  const body = {
    name: addCoVal('add-co-name'),
    ticker: addCoVal('add-co-ticker'),
    exchange: addCoVal('add-co-exchange'),
    sedar_ticker: addCoVal('add-co-sedar') || null,
    ms_slug: addCoVal('add-co-ms-slug') || null,
    market_cap: addCoVal('add-co-market-cap') || null,
    total_float: addCoVal('add-co-total-float') || null,
    shares_outstanding: addCoVal('add-co-shares') || null,
    sector: addCoVal('add-co-sector') || null,
    listing_date: addCoVal('add-co-listing-date') || null,
    region: addCoVal('add-co-region') || null,
    has_gold: addCoChecked('add-co-gold'),
    has_silver: addCoChecked('add-co-silver'),
    has_copper: addCoChecked('add-co-copper'),
    description: addCoVal('add-co-description') || null,
    website: addCoVal('add-co-website') || null,
    phone: addCoVal('add-co-phone') || null,
    headquarters: addCoVal('add-co-headquarters') || null,
    transfer_agent: addCoVal('add-co-transfer-agent') || null,
    people: collectAddCoPeople(),
  };
  try {
    const r = await fetch(`${API}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(x => x.json());
    if (r.error) { toast(r.error, 'err'); return; }
    const n = r.people?.length ?? 0;
    toast(n > 0 ? `Company added with ${n} person${n === 1 ? '' : 's'}` : 'Company added');
    closeAddCompanyModal();
    document.getElementById('add-co-form')?.reset();
    _addCoPeople = [];
    renderAddCoPeopleRows();
    loadCompanies();
    loadExchanges();
  } catch (err) { toast(err.message, 'err'); }
}

// ── Users (admin) ──
async function loadUsers() {
  const tbody = document.getElementById('users-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Loading…</td></tr>';
  try {
    const data = await fetch(`${API}/api/admin/users`).then((r) => r.json());
    const items = data.items || [];
    const totalEl = document.getElementById('users-total');
    if (totalEl) totalEl.textContent = String(data.total ?? items.length);
    if (!items.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No registered users yet.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((u) => {
      const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
      const created = u.createdAt ? new Date(u.createdAt).toLocaleString() : '—';
      return `<tr>
        <td>${esc(name)}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.username || '—')}</td>
        <td>${u.emailVerified ? '✓' : '—'}</td>
        <td>${u.watchlistAlertsEnabled ? 'On' : 'Off'}</td>
        <td style="font-size:12px;color:var(--muted);">${esc(created)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(err.message)}</td></tr>`;
  }
}

// ── Contact messages (admin) ──
let _contactFilter = 'all';
let _contactSelectedId = null;

function initContactMessages() {
  const filterSel = document.getElementById('contact-filter');
  if (filterSel) {
    filterSel.value = _contactFilter;
    filterSel.addEventListener('change', () => {
      _contactFilter = filterSel.value;
      _contactSelectedId = null;
      loadContactMessages();
      renderContactDetailEmpty();
    });
  }
  loadContactMessages();
  renderContactDetailEmpty();
}

function renderContactDetailEmpty() {
  const el = document.getElementById('contact-detail');
  if (!el) return;
  el.innerHTML = '<div class="contact-detail-empty">Select a message to read details</div>';
}

async function loadContactMessages() {
  const tbody = document.getElementById('contact-messages-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Loading…</td></tr>';
  try {
    const data = await fetch(`${API}/api/admin/contact-messages?filter=${encodeURIComponent(_contactFilter)}`).then((r) => r.json());
    const items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No messages in this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((m) => {
      const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '—';
      const unread = !m.read;
      return `<tr class="${unread ? 'contact-row-unread' : ''}" style="cursor:pointer" onclick="selectContactMessage(${m.id})">
        <td>${unread ? '● ' : ''}${esc(m.subject)}</td>
        <td>${esc(m.name)}</td>
        <td style="font-size:12px;color:var(--muted);">${esc(when)}</td>
        <td>${unread ? '<span style="color:var(--danger);font-weight:700;">Unread</span>' : 'Read'}</td>
      </tr>`;
    }).join('');
    if (typeof refreshContactUnreadBadge === 'function') refreshContactUnreadBadge();
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">${esc(err.message)}</td></tr>`;
  }
}

async function selectContactMessage(id) {
  _contactSelectedId = id;
  const el = document.getElementById('contact-detail');
  if (!el) return;
  el.innerHTML = '<div class="contact-detail-empty">Loading…</div>';
  try {
    await fetch(`${API}/api/admin/contact-messages/${id}/read`, { method: 'POST' });
    const m = await fetch(`${API}/api/admin/contact-messages/${id}`).then((r) => r.json());
    const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '—';
    const readWhen = m.readAt ? new Date(m.readAt).toLocaleString() : '—';
    el.innerHTML = `
      <div class="contact-detail-card">
        <h2 style="font-size:18px;margin-bottom:12px;">${esc(m.subject)}</h2>
        <div class="contact-detail-meta">
          <div><strong>From:</strong> ${esc(m.name)}${m.company ? ` · ${esc(m.company)}` : ''}</div>
          <div><strong>Email:</strong> ${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '—'}</div>
          <div><strong>Received:</strong> ${esc(when)}</div>
          <div><strong>Status:</strong> ${m.read ? `Read (${esc(readWhen)})` : 'Unread'}</div>
        </div>
        <div class="contact-detail-body">${esc(m.message)}</div>
      </div>`;
    loadContactMessages();
    if (typeof refreshContactUnreadBadge === 'function') refreshContactUnreadBadge();
  } catch (err) {
    el.innerHTML = `<div class="contact-detail-empty">${esc(err.message)}</div>`;
  }
}
