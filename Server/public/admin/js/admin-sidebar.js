/** Updates unread contact badge in admin sidebar on every page. */
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

document.addEventListener('DOMContentLoaded', refreshContactUnreadBadge);
