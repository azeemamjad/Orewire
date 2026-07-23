const ADMIN_NAV = [
  { page: 'dashboard', href: 'dashboard.html', icon: '📊', label: 'Dashboard' },
  { page: 'companies', href: 'companies.html', icon: '🏢', label: 'Companies' },
  { page: 'market-symbols', href: 'market-symbols.html', icon: '📈', label: 'Market Symbols' },
  { page: 'filings', href: 'filings.html', icon: '📄', label: 'Filings' },
  { page: 'storage', href: 'storage.html', icon: '☁', label: 'Storage' },
  { page: 'import', href: 'import.html', icon: '📥', label: 'Import Data' },
  { page: 'scraper', href: 'scraper.html', icon: '🤖', label: 'Run Scraper' },
  { page: 'pipeline', href: 'pipeline.html', icon: '⚙️', label: 'Pipeline' },
  { page: 'relay', href: 'relay.html', icon: '🌐', label: 'Relay' },
  { page: 'proxies', href: 'proxies.html', icon: '🔌', label: 'Proxies' },
  { page: 'ai', href: 'ai.html', icon: '🧠', label: 'AI' },
  { page: 'testing', href: 'testing.html', icon: '🧪', label: 'Testing' },
  { page: 'social-automation', href: 'social-automation.html', icon: 'X', label: 'Social Automation' },
  { page: 'hosted-browser', href: 'hosted-browser.html', icon: '🕸', label: 'X Browser' },
  { page: 'va-tasks', href: 'va-tasks.html', icon: '📋', label: 'VA Tasks', badge: 'va' },
  { page: 'users', href: 'users.html', icon: '👤', label: 'Users' },
  { page: 'contact-messages', href: 'contact-messages.html', icon: '📧', label: 'Contact', badge: 'contact' },
  { page: 'processes', href: 'processes.html', icon: '🖥', label: 'System' },
];

function getPageLabel(page) {
  return ADMIN_NAV.find((item) => item.page === page)?.label || 'Admin';
}

function navBadgeHtml(badge) {
  if (badge === 'va') {
    return '<span class="nav-badge" data-va-tasks-badge hidden></span>';
  }
  if (badge === 'contact') {
    return '<span class="nav-badge" data-contact-unread-badge hidden></span>';
  }
  return '';
}

function renderSidebarHtml(page) {
  const navItems = ADMIN_NAV.map((item) => {
    const active = item.page === page ? ' class="active"' : '';
    const badge = navBadgeHtml(item.badge);
    return `<li${active}><a href="${item.href}"><span class="icon">${item.icon}</span>${item.label}${badge}</a></li>`;
  }).join('');

  return `
    <div class="logo">
      <a href="dashboard.html" class="brand-link" aria-label="OreWire Admin home">
        <span class="brand-mark" aria-hidden="true">O</span>
        <span class="brand-copy">
          <span class="brand-title">OreWire Admin</span>
          <span class="brand-subtitle">Mining intelligence operations</span>
        </span>
      </a>
    </div>
    <nav><ul>${navItems}</ul></nav>
    <div class="sidebar-footer">
      <a href="/admin/logout" class="logout-link">🚪 Logout</a>
    </div>
  `;
}

function enhanceSidebarShell() {
  const body = document.body;
  let sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main');
  if (!main) return;

  // Ensure a sidebar exists (e.g. market-symbols had an empty aside).
  if (!sidebar) {
    sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    body.insertBefore(sidebar, main);
  }

  const page = body.dataset.page || '';
  const pageLabel = getPageLabel(page);
  document.title = `${pageLabel} | OreWire Admin`;

  sidebar.innerHTML = renderSidebarHtml(page);

  if (!document.querySelector('.admin-topbar')) {
    body.insertAdjacentHTML(
      'afterbegin',
      `
        <div class="admin-overlay" data-admin-sidebar-close></div>
        <header class="admin-topbar">
          <button type="button" class="admin-topbar-btn" data-admin-sidebar-toggle aria-label="Open navigation">
            <span></span><span></span><span></span>
          </button>
          <div class="admin-topbar-brand">
            <span class="brand-mark brand-mark-sm" aria-hidden="true">O</span>
            <div class="admin-topbar-copy">
              <div class="admin-topbar-title">OreWire Admin</div>
              <div class="admin-topbar-subtitle">${pageLabel}</div>
            </div>
          </div>
          <a href="/admin/logout" class="admin-topbar-logout">Logout</a>
        </header>
      `,
    );
  }

  const closeSidebar = () => body.classList.remove('admin-sidebar-open');
  const toggleSidebar = () => body.classList.toggle('admin-sidebar-open');

  body.querySelector('[data-admin-sidebar-toggle]')?.addEventListener('click', toggleSidebar);
  body.querySelector('[data-admin-sidebar-close]')?.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });

  sidebar.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => closeSidebar());
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) closeSidebar();
  });

  main.classList.add('admin-main-shell');
}

/** Sidebar badges: contact unread + open VA tasks. */
async function refreshContactUnreadBadge() {
  try {
    const r = await fetch('/api/admin/contact-messages/unread-count');
    if (!r.ok) return;
    const data = await r.json();
    const count = Number(data.count) || 0;
    document.querySelectorAll('[data-contact-unread-badge]').forEach((el) => {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.hidden = false;
      } else {
        el.textContent = '';
        el.hidden = true;
      }
    });
  } catch {
    /* ignore */
  }
}

async function refreshVaTasksBadge() {
  try {
    const r = await fetch('/api/admin/va-tasks/open-count');
    if (!r.ok) return;
    const data = await r.json();
    const count = Number(data.count) || 0;
    document.querySelectorAll('[data-va-tasks-badge]').forEach((el) => {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.hidden = false;
      } else {
        el.textContent = '';
        el.hidden = true;
      }
    });
  } catch {
    /* ignore */
  }
}

document.addEventListener('DOMContentLoaded', () => {
  enhanceSidebarShell();
  refreshContactUnreadBadge();
  refreshVaTasksBadge();
});
