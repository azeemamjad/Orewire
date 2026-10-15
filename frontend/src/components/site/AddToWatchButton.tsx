import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/hooks";
import { addToWatchlist } from "@/lib/api";
import { useSignupModal } from "@/hooks/use-signup-modal";

/**
 * AddToWatchButton — small "Watchlist" button used on feed cards.
 *
 * Design ported from the Lovable export (src/components/site/AddToWatchButton.tsx).
 *
 * Behaviour rewritten to drop Supabase (`supabase.from("watchlist_items")`) and
 * use OreWire's own API through the established pattern:
 *   - anonymous visitors: open the SignupModal with context "watchlist"
 *   - signed in:         POST /api/watchlist via addToWatchlist() (@/lib/api)
 *
 * Key format note: the server stores a free-form `item_key` (see
 * Server/routes/api/watchlist.js) and the repo derives company keys as
 * `<EXCHANGE><TICKER>` — e.g. `TSXVSCZ`. The export's `market`/`ticker` props
 * are joined the same way.
 */

const toItemKey = (market: string, ticker: string) =>
  `${(market || "").toUpperCase().replace(/[^A-Z0-9]/g, "")}${(ticker || "").toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

const AddToWatchButton = ({ ticker, market, name, className = "" }: { ticker: string; market: string; name: string; className?: string }) => {
  const { isAuthenticated, loading } = useAuth();
  const { openSignup } = useSignupModal();
  const navigate = useNavigate();
  const label = market ? `${market}: ${ticker}` : ticker;
  const itemKey = toItemKey(market, ticker);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    if (!isAuthenticated) {
      openSignup({ context: "watchlist", ticker: label });
      return;
    }
    if (!itemKey) {
      toast.error(`${name || "This item"} has no ticker, so it can't be watched yet.`);
      return;
    }
    try {
      await addToWatchlist("company", itemKey);
      toast.success(`${label} added to your watchlist`, {
        action: { label: "View", onClick: () => navigate("/watchlist") },
      });
    } catch {
      toast.error(`Could not add ${label} to your watchlist`);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      aria-label={`Add ${label} to watchlist`}
      className={`inline-flex items-center gap-1 h-6 px-2 border border-border text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors shrink-0 ${className}`}
    >
      <Plus className="w-3 h-3" /> Watchlist
    </button>
  );
};

export default AddToWatchButton;
