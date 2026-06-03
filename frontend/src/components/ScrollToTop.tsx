import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Reset window scroll on every route change (SPA navigation keeps scroll position otherwise). */
export default function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname, search, hash]);

  return null;
}
