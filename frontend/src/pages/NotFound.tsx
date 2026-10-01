import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useSeo } from "@/lib/seo";

const NotFound = () => {
  const location = useLocation();

  // An unmatched route must not present itself as a normal page.
  //
  // Without this the SPA shell's own metadata stood in: the homepage title, the
  // homepage description and `index, follow`. That mattered because
  // `CompanyDetail.tsx` links every manager, director and insider-transaction name
  // to `/insider/<slug>`, and **no such route exists** — `routes.tsx` declares no
  // `/insider` path, so every one of those links lands here. That is several dead
  // internal links on each of ~2,400 company pages, all pointing at soft 404s that
  // claimed to be indexable.
  //
  // `noindex, follow` is the honest signal: the page should not be indexed, but
  // following out of it is fine. The canonical is set to the requested path so a
  // canonical left over from the previously visited route cannot linger.
  useSeo(
    {
      title: "Page not found | OreWire",
      description:
        "This page does not exist on OreWire. Browse mining and resource company profiles, decoded regulatory filings and news release summaries for TSX, TSX-V, CSE and ASX issuers.",
      canonicalPath: location.pathname,
      robots: "noindex, follow",
    },
    [location.pathname],
  );

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
