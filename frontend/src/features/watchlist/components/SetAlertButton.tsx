import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { checkItemAlert, setItemAlert } from "@/lib/api";
import { bumpItemAlertWatermark } from "@/lib/watchlist-alerts";

type SetAlertButtonProps = {
  itemType: "company" | "commodity" | "index" | "currency";
  itemKey: string;
  companyId?: number;
  size?: "sm" | "md";
  /** Button label when alerts are off (e.g. "News alerts" on company pages) */
  label?: string;
  activeLabel?: string;
};

const SetAlertButton = ({
  itemType,
  itemKey,
  companyId,
  size = "md",
  label = "Set alert",
  activeLabel = "Alert on",
}: SetAlertButtonProps) => {
  const [on, setOn] = useState(false);
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      checkItemAlert(itemType, itemKey).then(setOn);
    } else {
      setOn(false);
    }
  }, [itemType, itemKey, isAuthenticated, loading]);

  const toggle = async () => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`);
      return;
    }
    try {
      const next = !on;
      await setItemAlert(itemType, itemKey, companyId, next);
      setOn(next);
      if (next) bumpItemAlertWatermark();
      toast.success(next ? "Alerts on: major updates will appear in your notifications" : "Alerts turned off");
    } catch {
      toast.error("Could not update alert");
    }
  };

  if (size === "sm") {
    return (
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium transition-colors ${
          on
            ? "border border-[hsl(var(--up))] bg-[hsl(var(--up))]/10 text-[hsl(var(--up))]"
            : "bg-accent text-accent-foreground hover:bg-accent/90"
        }`}
      >
        {on ? <Check className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
        {on ? activeLabel : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-2 text-sm font-medium h-9 rounded-md px-3 transition-colors ${
        on
          ? "border border-[hsl(var(--up))] bg-[hsl(var(--up))]/10 text-[hsl(var(--up))]"
          : "bg-foreground text-background hover:bg-foreground/90"
      }`}
    >
      {on ? <Check className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {on ? activeLabel : label}
    </button>
  );
};

export default SetAlertButton;
