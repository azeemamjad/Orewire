import {
  Search as SearchIcon,
  Menu,
  LogOut,
  User as UserIcon,
  ChevronDown,
  X,
  Home,
  Building2,
  Star,
  Newspaper,
  FileText,
  Globe,
  FileLock,
  ShieldCheck,
  Mail,
  Linkedin,
  Instagram,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import NotificationsMenu from "@/features/watchlist/components/NotificationsMenu";
import NavSearch from "@/components/site/NavSearch";
import SiteTopBar from "@/components/site/SiteTopBar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/features/auth/hooks";
import { logout } from "@/lib/api";

const navItems = [
  { to: "/", label: "Home", exact: true, icon: Home },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/news", label: "News Releases", icon: Newspaper },
  { to: "/filings", label: "Filings", icon: FileText },
  { to: "/market-news", label: "Market News", icon: Globe },
];

const mobileNavItems = [
  { to: "/", label: "Home", exact: true, icon: Home },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/watchlist", label: "Watchlist", icon: Star },
  { to: "/news", label: "News Releases", icon: Newspaper },
  { to: "/filings", label: "Filings", icon: FileText },
  { to: "/market-news", label: "Market News", icon: Globe },
];

const companyItems = [
  { to: "/terms", label: "Terms of Use", icon: FileLock },
  { to: "/privacy", label: "Privacy Policy", icon: ShieldCheck },
  { to: "/contact", label: "Contact Us", icon: Mail },
];

type NavProps = {
  showSiteTopBar?: boolean;
};

const Nav = ({ showSiteTopBar = true }: NavProps) => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const username = user?.username || user?.email?.split("@")[0] || "you";
  const initial = (
    user?.firstName ||
    user?.username ||
    user?.email ||
    "P"
  )
    .trim()
    .slice(0, 1)
    .toUpperCase() || "P";

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to);

  return (
    <>
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="container-page h-14 flex items-center gap-3 md:gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative w-8 h-8 rounded-lg bg-foreground grid place-items-center">
              <span className="font-display text-background text-base font-extrabold leading-none">O</span>
            </div>
            <div className="hidden sm:flex items-baseline gap-1.5">
              <span className="font-display text-lg font-extrabold tracking-tight">OreWire</span>
            </div>
          </Link>

          {/* Primary nav */}
          <nav className="hidden lg:flex items-center gap-1 text-sm shrink-0">
            {navItems.map((item) => {
              const active = isActive(item.to, item.exact);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`relative px-3 h-14 flex items-center font-medium transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{item.label}</span>
                  {active && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent" />}
                </Link>
              );
            })}
          </nav>

          {/* Global search, prominent on every page */}
          <div className="flex-1 hidden sm:flex justify-center min-w-0">
            <NavSearch />
          </div>
          <div className="flex-1 sm:hidden" />
          <Link
            to="/companies"
            aria-label="Search companies"
            className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <SearchIcon className="w-4 h-4" />
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Prominent Watchlist button */}
            <Link
              to="/watchlist"
              aria-label="Watchlist"
              className={`group hidden sm:inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[12px] font-mono uppercase tracking-widest font-bold text-[hsl(36_30%_94%)] bg-[hsl(220_45%_10%)] hover:bg-[hsl(220_45%_16%)] border border-[hsl(220_45%_10%)] transition-colors ${
                location.pathname.startsWith("/watchlist")
                  ? "ring-2 ring-accent ring-offset-1 ring-offset-background"
                  : ""
              }`}
            >
              <span>Watchlist</span>
            </Link>

            {isAuthenticated ? (
              <>
                <NotificationsMenu />
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      aria-label="Profile menu"
                      className="inline-flex items-center gap-2 pl-1.5 pr-2 h-9 rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <span className="w-6 h-6 bg-accent text-accent-foreground grid place-items-center font-mono text-[11px] font-bold">
                        {initial}
                      </span>
                      <span className="font-mono text-xs hidden md:inline max-w-[120px] truncate">@{username}</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={8} className="w-64 p-0 border-border">
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border-b border-border">
                      <span className="w-9 h-9 bg-accent text-accent-foreground grid place-items-center font-mono text-sm font-bold shrink-0">
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold truncate">@{username}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{user?.email}</div>
                      </div>
                    </div>
                    <div className="py-1">
                      <Link to="/profile" className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors">
                        <UserIcon className="w-4 h-4 text-muted-foreground" /> Manage profile
                      </Link>
                      <Link to="/watchlist" className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors">
                        <Star className="w-4 h-4 text-muted-foreground" /> Watchlist
                      </Link>
                      <Link to="/companies" className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors">
                        <Building2 className="w-4 h-4 text-muted-foreground" /> Companies
                      </Link>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors inline-flex items-center gap-2.5 border-t border-border"
                    >
                      <LogOut className="w-4 h-4 text-muted-foreground" /> Log out
                    </button>
                  </PopoverContent>
                </Popover>
              </>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center rounded-lg bg-accent text-accent-foreground px-4 h-9 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity"
              >
                Login / Sign up
              </Link>
            )}

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border hover:bg-muted transition-colors"
                  aria-label="Open menu"
                >
                  <Menu className="w-4 h-4" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="w-[320px] sm:w-[380px] p-0 bg-background border-l border-border flex flex-col"
              >
                <div className="flex items-center justify-between h-14 px-5 border-b border-border">
                  <div className="flex items-center gap-2.5">
                    <div className="relative w-7 h-7 rounded-lg bg-foreground grid place-items-center">
                      <span className="font-display text-background text-sm font-extrabold leading-none">O</span>
                    </div>
                    <span className="font-display text-base font-extrabold tracking-tight">OreWire</span>
                  </div>
                  <button
                    onClick={() => setMenuOpen(false)}
                    className="w-8 h-8 grid place-items-center border border-border hover:bg-muted transition-colors"
                    aria-label="Close menu"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <div className="px-5 pt-6 pb-2">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                      Product
                    </div>
                    <ul className="space-y-0.5">
                      {mobileNavItems.map((item) => {
                        const active = isActive(item.to, item.exact);
                        const Icon = item.icon;
                        return (
                          <li key={item.to}>
                            <Link
                              to={item.to}
                              onClick={() => setMenuOpen(false)}
                              className={`group flex items-center gap-3 px-3 h-11 text-sm font-medium border-l-2 transition-colors ${
                                active
                                  ? "border-accent bg-muted text-foreground"
                                  : "border-transparent text-foreground/75 hover:text-foreground hover:bg-muted/50"
                              }`}
                            >
                              <Icon
                                className={`w-4 h-4 ${
                                  active ? "text-accent" : "text-muted-foreground group-hover:text-foreground"
                                }`}
                              />
                              <span className="flex-1">{item.label}</span>
                              {item.to === "/watchlist" && (
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="px-5 pt-6 pb-2 border-t border-border mt-4">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
                      Company
                    </div>
                    <ul className="space-y-0.5">
                      {companyItems.map((item) => {
                        const active = isActive(item.to);
                        const Icon = item.icon;
                        return (
                          <li key={item.to}>
                            <Link
                              to={item.to}
                              onClick={() => setMenuOpen(false)}
                              className={`group flex items-center gap-3 px-3 h-11 text-sm font-medium border-l-2 transition-colors ${
                                active
                                  ? "border-accent bg-muted text-foreground"
                                  : "border-transparent text-foreground/75 hover:text-foreground hover:bg-muted/50"
                              }`}
                            >
                              <Icon
                                className={`w-4 h-4 ${
                                  active ? "text-accent" : "text-muted-foreground group-hover:text-foreground"
                                }`}
                              />
                              <span>{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                <div className="border-t border-border p-5 space-y-3">
                  {isAuthenticated ? (
                    <>
                      <div className="flex items-center gap-3 px-1">
                        <span className="w-9 h-9 bg-accent text-accent-foreground grid place-items-center font-mono text-xs font-bold">
                          {initial}
                        </span>
                        <div className="min-w-0">
                          <div className="font-mono text-xs font-semibold truncate">@{username}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{user?.email}</div>
                        </div>
                      </div>
                      <Link
                        to="/profile"
                        onClick={() => setMenuOpen(false)}
                        className="w-full inline-flex items-center justify-center gap-2 h-10 border border-border text-sm font-medium hover:bg-muted transition-colors"
                      >
                        <UserIcon className="w-4 h-4" /> Manage profile
                      </Link>
                      <button
                        onClick={() => {
                          handleLogout();
                          setMenuOpen(false);
                        }}
                        className="w-full inline-flex items-center justify-center gap-2 h-10 border border-border text-sm font-medium hover:bg-muted transition-colors"
                      >
                        <LogOut className="w-4 h-4" /> Log out
                      </button>
                    </>
                  ) : (
                    <Link
                      to="/login"
                      onClick={() => setMenuOpen(false)}
                      className="inline-flex w-full items-center justify-center h-10 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      Login / Sign up
                    </Link>
                  )}
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <a
                      href="#"
                      aria-label="X"
                      className="w-9 h-9 grid place-items-center border border-border hover:border-accent hover:text-accent transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
                        <path d="M18.244 2H21l-6.52 7.45L22 22h-6.844l-4.79-6.26L4.8 22H2l6.974-7.97L2 2h7.02l4.31 5.73L18.244 2Zm-1.2 18.2h1.86L7.04 3.7H5.06l11.984 16.5Z" />
                      </svg>
                    </a>
                    <a
                      href="#"
                      aria-label="LinkedIn"
                      className="w-9 h-9 grid place-items-center border border-border hover:border-accent hover:text-accent transition-colors"
                    >
                      <Linkedin className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href="#"
                      aria-label="Instagram"
                      className="w-9 h-9 grid place-items-center border border-border hover:border-accent hover:text-accent transition-colors"
                    >
                      <Instagram className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground text-center">TSX · TSX-V · CSE · ASX</p>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      {showSiteTopBar && <SiteTopBar />}
    </>
  );
};

export default Nav;
