import type { HTMLAttributes, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { useSignupModal } from "@/hooks/use-signup-modal";

/**
 * FeedGate — the signed-out gate shared by both homepage feed sections
 * ("Live news releases" and "Filing intelligence").
 *
 * Design ported from the Lovable export's gate in
 * src/components/site/HomeFeeds.tsx, where a single `FeedList` rendered it for
 * both sections. It lives here once for the same reason: the two sections must
 * stay identical, so neither owns its own copy.
 *
 * Structure, top to bottom:
 *   1. the caller's teaser rows (`children`) blurred and dimmed to 70%
 *   2. a gradient that fades those rows into the page background
 *   3. an overlay `card-surface` card holding the copy and the CTA
 *
 * Step 3 is what the export added over the gate we had before, which was a bare
 * button floating on the gradient with no card and no headline.
 *
 * Copy is the canonical overlay copy — "See every filing, free" / "Sign up
 * free". The CTA opens the signup modal with the "feed" context instead of
 * linking to /register, which is what makes that context's headline reachable.
 *
 * Row counts belong to the caller: each section decides how many rows are
 * visible and how many are teased (5 and 5 on the homepage), so nothing here
 * slices or fetches. Data, query keys and row markup all stay with the caller,
 * which also keeps the shared row primitive (FeedRow) the single row design.
 */
const FeedGate = ({ children }: { children: ReactNode }) => {
  const { openSignup } = useSignupModal();

  return (
    <div className="relative mt-2">
      <div
        {...inertAttr}
        aria-hidden="true"
        className="pointer-events-none select-none blur-sm opacity-70"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-background/30 via-background/70 to-background">
        <div className="card-surface bg-card px-6 py-5 text-center shadow-lg">
          <div className="font-display text-lg font-bold mb-3">See every filing, free</div>
          <button
            type="button"
            onClick={() => openSignup({ context: "feed" })}
            className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-5 h-10 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Sign up free <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * The teaser is decorative: it is hidden from assistive tech with `aria-hidden`
 * (as in the export) and, because the rows inside it are real links, also made
 * inert so they cannot be tabbed into — an aria-hidden subtree must not contain
 * focusable elements. React 18's DOM typings predate `inert`, so the attribute
 * is passed through as the empty string, which is what renders it.
 */
const inertAttr = { inert: "" } as unknown as HTMLAttributes<HTMLDivElement>;

export default FeedGate;
