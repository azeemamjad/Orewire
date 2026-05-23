import { Twitter, Linkedin } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="bg-background border-t border-border">
    <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-12 grid md:grid-cols-12 gap-8">
      <div className="md:col-span-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-primary grid place-items-center">
            <span className="font-display text-primary-foreground text-base font-extrabold leading-none">O</span>
          </div>
          <span className="font-display text-xl font-extrabold tracking-tight">Orewire</span>
        </div>
        <p className="text-sm text-foreground/60 max-w-sm">
          Junior mining intelligence — translated by AI. TSX-V · CSE · ASX.
        </p>
        <div className="flex items-center gap-3 mt-5">
          <a href="#" aria-label="X" className="w-8 h-8 grid place-items-center border border-border hover:border-accent">
            <Twitter className="w-3.5 h-3.5" />
          </a>
          <a href="#" aria-label="LinkedIn" className="w-8 h-8 grid place-items-center border border-border hover:border-accent">
            <Linkedin className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="md:col-span-3 text-sm">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Product</div>
        <ul className="space-y-2 text-foreground/70">
          <li><a href="/#feed" className="hover:text-foreground">Feed</a></li>
          <li><Link to="/companies" className="hover:text-foreground">Companies</Link></li>
          <li><a href="/#pricing" className="hover:text-foreground">Pricing</a></li>
          <li><Link to="/login" className="hover:text-foreground">Login</Link></li>
        </ul>
      </div>
      <div className="md:col-span-4 text-sm">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Company</div>
        <ul className="space-y-2 text-foreground/70">
          <li><a href="#" className="hover:text-foreground">Terms</a></li>
          <li><a href="#" className="hover:text-foreground">Privacy</a></li>
          <li><a href="mailto:hello@orewire.com" className="hover:text-foreground">hello@orewire.com</a></li>
        </ul>
      </div>
    </div>
    <div className="border-t border-border bg-primary text-primary-foreground">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-5 text-[11px] font-mono leading-relaxed">
        <span className="uppercase tracking-widest opacity-60 mr-2">Disclaimer</span>
        This platform provides information for educational purposes only. Nothing constitutes investment advice. Always do your own due diligence.
      </div>
      <div className="border-t border-primary-foreground/10">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-4 flex justify-between items-center text-[11px] font-mono opacity-70">
          <span>© 2026 Orewire Inc.</span>
          <span>orewire.com</span>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
