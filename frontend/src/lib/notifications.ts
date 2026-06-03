export type AppNotification = {
  id: string;
  title: string;
  body: string;
  href?: string;
  createdAt: string;
  read: boolean;
};

const STORAGE_KEY = "orewire-notifications";

function load(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: AppNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function getNotifications(): AppNotification[] {
  return load().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getUnreadCount(): number {
  return load().filter((n) => !n.read).length;
}

function notifyChange() {
  window.dispatchEvent(new Event("orewire-notifications-change"));
}

export function markNotificationRead(id: string) {
  const items = load().map((n) => (n.id === id ? { ...n, read: true } : n));
  save(items);
  notifyChange();
}

export function markAllNotificationsRead() {
  save(load().map((n) => ({ ...n, read: true })));
  notifyChange();
}

export function addNotification(
  input: Omit<AppNotification, "id" | "read" | "createdAt"> & { id?: string; createdAt?: string },
) {
  const items = load();
  const next: AppNotification = {
    id: input.id ?? `n-${Date.now()}`,
    title: input.title,
    body: input.body,
    href: input.href,
    createdAt: input.createdAt ?? new Date().toISOString(),
    read: false,
  };
  save([next, ...items.filter((n) => n.id !== next.id)].slice(0, 50));
  notifyChange();
}

export const NOTIFICATIONS_STORAGE_KEY = STORAGE_KEY;
