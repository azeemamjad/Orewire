import { LogOut, Menu, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import NotificationsMenu from "@/components/site/NotificationsMenu";
import NavSearch from "@/components/site/NavSearch";
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
  { to: "/", label: "Home" },
  { to: "/companies", label: "Companies" },
  { to: "/watchlist", label: "Watchlist", highlight: true },
  { to: "/news", label: "News Releases" },
  { to: "/filings", label: "Filings" },
  { to: "/market-news", label: "Market News" },
];

const Nav = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 h-14 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="relative w-8 h-8 bg-foreground grid place-items-center">
            <span className="font-display text-background text-base font-extrabold leading-none">O</span>
            <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 bg-[hsl(var(--up))] animate-pulse-dot" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-extrabold tracking-tight">Orewire</span>
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border border-border px-1 py-0.5 leading-none hidden sm:inline-block">
              Beta
            </span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-1 text-sm shrink-0">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`relative px-3 h-14 flex items-center gap-1.5 font-medium transition-colors ${
                isActive(item.to)
                  ? "text-foreground"
                  : item.highlight
                    ? "text-accent hover:text-accent/80"
                    : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.highlight && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot" />
              )}
              {item.label}
              {isActive(item.to) && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent" />}
            </Link>
          ))}
        </nav>

        <NavSearch />

        <div className="flex items-center gap-2 ml-auto shrink-0">
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

          <button className="md:hidden p-2"><Menu className="w-5 h-5" /></button>
        </div>
      </div>
    </header>
  );
};

export default Nav;
