import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/lib/notifications";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const NotificationsMenu = () => {
  const { isAuthenticated } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    if (!isAuthenticated) {
      setItems([]);
      setUnread(0);
      return;
    }
    setItems(getNotifications());
    setUnread(getUnreadCount());
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "orewire-notifications") refresh();
    };
    const onLocal = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("orewire-notifications-change", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("orewire-notifications-change", onLocal);
    };
  }, [refresh]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refresh();
  };

  const onRead = (id: string) => {
    markNotificationRead(id);
    refresh();
  };

  const onReadAll = () => {
    markAllNotificationsRead();
    refresh();
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative inline-flex items-center justify-center w-9 h-9 border border-border bg-surface text-foreground/80 hover:text-primary hover:border-accent transition-colors"
          aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-mono font-bold leading-4 text-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <DropdownMenuLabel className="p-0 font-display text-sm font-semibold text-foreground">
            Notifications
          </DropdownMenuLabel>
          {unread > 0 && (
            <button
              type="button"
              onClick={onReadAll}
              className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[min(360px,70vh)] overflow-y-auto">
          {!isAuthenticated ? (
            <div className="px-4 py-6 text-sm text-muted-foreground leading-relaxed">
              <p className="mb-3">Sign in to get alerts.</p>
              <p className="text-xs mb-4">
                Set alerts on companies, commodities, indexes, or currencies and major updates show up here.
              </p>
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center bg-accent text-accent-foreground px-4 h-9 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Sign in
              </Link>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground leading-relaxed">
              <p className="mb-3">You&apos;re all caught up.</p>
              <p className="text-xs">
                Use{" "}
                <strong className="font-medium text-foreground">Set alert</strong> on a company, commodity, index, or currency to get major updates here.
              </p>
            </div>
          ) : (
            items.map((n) =>
              n.href ? (
                <DropdownMenuItem
                  key={n.id}
                  asChild
                  className={`cursor-pointer flex flex-col items-start gap-1 px-3 py-2.5 rounded-none border-b border-border last:border-0 ${
                    n.read ? "opacity-70" : "bg-muted/30"
                  }`}
                >
                  <Link
                    to={n.href}
                    className="w-full"
                    onClick={() => {
                      onRead(n.id);
                      setOpen(false);
                    }}
                  >
                    <NotificationRow n={n} />
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  key={n.id}
                  className={`cursor-pointer flex flex-col items-start gap-1 px-3 py-2.5 rounded-none border-b border-border last:border-0 ${
                    n.read ? "opacity-70" : "bg-muted/30"
                  }`}
                  onSelect={() => onRead(n.id)}
                >
                  <NotificationRow n={n} />
                </DropdownMenuItem>
              ),
            )
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

function NotificationRow({ n }: { n: AppNotification }) {
  return (
    <>
      <div className="flex w-full items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{n.title}</span>
        {!n.read && <span className="shrink-0 w-2 h-2 rounded-full bg-accent mt-1.5" aria-hidden />}
      </div>
      <span className="text-xs text-muted-foreground leading-snug line-clamp-2">{n.body}</span>
      <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(n.createdAt)}</span>
    </>
  );
}

export default NotificationsMenu;
