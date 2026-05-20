import { Menu } from "lucide-react";
import { Link } from "react-router-dom";

const Nav = () => (
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
        <a href="/#pricing" className="hover:text-primary text-foreground/80">Pricing</a>
        <a href="/#login" className="hover:text-primary text-foreground/80">Login</a>
      </nav>

      <div className="flex items-center gap-2">
        <a href="#cta" className="hidden sm:inline-flex items-center bg-accent text-accent-foreground px-4 h-10 text-sm font-semibold hover:opacity-90 transition-opacity">
          Start Free Trial
        </a>
        <button className="md:hidden p-2"><Menu className="w-5 h-5" /></button>
      </div>
    </div>
  </header>
);

export default Nav;
