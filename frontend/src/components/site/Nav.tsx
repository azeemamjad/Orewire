import { LogOut, Menu, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
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

const Nav = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 bg-background/90 backdrop-blur border-b border-border">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary grid place-items-center">
            <span className="font-display text-primary-foreground text-base font-extrabold leading-none">O</span>
          </div>
          <span className="font-display text-xl font-extrabold tracking-tight">Orewire</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm">
          <a href="/#feed" className="hover:text-primary text-foreground/80">Feed</a>
          <Link to="/companies" className="hover:text-primary text-foreground/80">Companies</Link>
          <Link to="/watchlist" className="hover:text-primary text-foreground/80">Watchlist</Link>
          <Link to="/jobs" className="hover:text-primary text-foreground/80">Jobs</Link>
          <a href="/#pricing" className="hover:text-primary text-foreground/80">Pricing</a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            to="/watchlist"
            className="hidden sm:inline-flex items-center bg-accent text-accent-foreground px-4 h-10 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Open Watchlist
          </Link>

          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="hidden sm:inline-flex items-center justify-center w-10 h-10 border border-border bg-surface text-foreground/80 hover:text-primary hover:border-accent transition-colors"
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
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              to="/login"
              className="hidden sm:inline-flex items-center text-sm text-foreground/80 hover:text-primary transition-colors"
            >
              Account
            </Link>
          )}

          <button className="md:hidden p-2"><Menu className="w-5 h-5" /></button>
        </div>
      </div>
    </header>
  );
};

export default Nav;
