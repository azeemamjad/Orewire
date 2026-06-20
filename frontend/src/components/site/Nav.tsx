import { LogOut, Menu, UserRound, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import NotificationsMenu from "@/components/site/NotificationsMenu";
import NavSearch from "@/components/site/NavSearch";
import SiteTopBar from "@/components/site/SiteTopBar";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { logout } from "@/lib/api";

const NAV_ITEMS = [
  { to: "/", label: "Home", exact: true },
  { to: "/companies", label: "Companies" },
  { to: "/watchlist", label: "Watchlist", highlight: true },
  { to: "/news", label: "News Releases" },
  { to: "/filings", label: "Filings" },
  { to: "/market-news", label: "Market News" },
];

const COMPANY_ITEMS = [
  { to: "/terms", label: "Terms of Use" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/contact", label: "Contact Us" },
];

const Nav = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <div className="sticky top-0 z-40">
      <header className="bg-background/90 backdrop-blur-md border-b border-border">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 h-14 flex items-center gap-3 md:gap-4">
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative w-8 h-8 bg-foreground grid place-items-center">
              <span className="font-display text-background text-base font-extrabold leading-none">O</span>
              <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 bg-[hsl(var(--up))] animate-pulse-dot" />
            </div>
            <div className="hidden sm:flex items-baseline gap-1.5">
              <span className="font-display text-lg font-extrabold tracking-tight">OreWire</span>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-1 text-sm shrink-0">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.to, item.exact);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`relative px-3 h-14 flex items-center gap-1.5 font-medium transition-colors ${
                    active
                      ? "text-foreground"
                      : item.highlight
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.highlight && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
                  )}
                  <span className={item.highlight ? "font-semibold" : ""}>{item.label}</span>
                  {active && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent" />}
                  {item.highlight && !active && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent/40" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1 flex justify-center min-w-0">
            <NavSearch />
          </div>

          <div className="flex items-center gap-2 shrink-0">
          {isAuthenticated && <NotificationsMenu />}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="hidden sm:inline-flex items-center justify-center w-9 h-9 border border-border bg-surface text-foreground/80 hover:text-primary hover:border-accent transition-colors"
                  aria-label="Profile"
                >
                  <UserRound className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Signed in as
                </DropdownMenuLabel>
                <div className="px-2 pb-2 text-sm truncate" title={user?.email}>
                  {user?.email || "Account"}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")} className="cursor-pointer">
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden sm:inline-flex items-center px-3 h-9 text-sm text-foreground/80 hover:text-foreground transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center bg-accent text-accent-foreground px-4 h-9 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Sign up
              </Link>
            </>
          )}

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="lg:hidden inline-flex items-center justify-center w-9 h-9 border border-border hover:bg-muted transition-colors"
                aria-label="Open menu"
              >
                <Menu className="w-4 h-4" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              showCloseButton={false}
              className="w-[min(100vw,380px)] sm:w-[380px] p-0 bg-background border-l border-border flex flex-col"
            >
              <div className="flex items-center justify-between h-14 px-4 sm:px-5 border-b border-border shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative w-7 h-7 bg-foreground grid place-items-center shrink-0">
                    <span className="font-display text-background text-sm font-extrabold leading-none">O</span>
                  </div>
                  <span className="font-display text-base font-extrabold tracking-tight truncate">OreWire</span>
                </div>
                <SheetClose asChild>
                  <button
                    type="button"
                    className="shrink-0 w-10 h-10 grid place-items-center border border-border bg-background text-foreground hover:bg-muted hover:border-foreground/30 active:bg-muted/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label="Close menu"
                  >
                    <X className="w-5 h-5" strokeWidth={2} />
                  </button>
                </SheetClose>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pt-6">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Product</div>
                <ul className="space-y-0.5">
                  {NAV_ITEMS.map((item) => {
                    const active = isActive(item.to, item.exact);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className={`flex items-center gap-3 px-3 h-11 text-sm font-medium border-l-2 transition-colors ${
                            active ? "border-accent bg-muted text-foreground" : "border-transparent text-foreground/75 hover:bg-muted/50"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3 mt-6 pt-6 border-t border-border">Company</div>
                <ul className="space-y-0.5">
                  {COMPANY_ITEMS.map((item) => {
                    const active = isActive(item.to);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={() => setMenuOpen(false)}
                          className={`flex items-center gap-3 px-3 h-11 text-sm font-medium border-l-2 transition-colors ${
                            active ? "border-accent bg-muted text-foreground" : "border-transparent text-foreground/75 hover:bg-muted/50"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      </header>
      <SiteTopBar />
    </div>
  );
};

export default Nav;
