import { Linkedin, Instagram } from "lucide-react";
import { Link } from "react-router-dom";

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M18.244 2H21l-6.52 7.45L22 22h-6.844l-4.79-6.26L4.8 22H2l6.974-7.97L2 2h7.02l4.31 5.73L18.244 2Zm-1.2 18.2h1.86L7.04 3.7H5.06l11.984 16.5Z" />
  </svg>
);

const socialLinks = [
  { href: "https://x.com/Orewirenews", label: "X", Icon: XIcon },
  { href: "https://www.linkedin.com/company/orewire/", label: "LinkedIn", Icon: Linkedin },
  { href: "https://www.instagram.com/orewirenews", label: "Instagram", Icon: Instagram },
];

const productLinks = [
  { to: "/", label: "Home" },
  { to: "/companies", label: "Companies" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/news", label: "News Releases" },
  { to: "/filings", label: "Filings" },
  { to: "/market-news", label: "Market News" },
];

const companyLinks = [
  { to: "/terms", label: "Terms of Use" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/contact", label: "Contact Us" },
];

const Footer = () => (
  <footer className="bg-background border-t border-border">
    <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-12 md:py-14">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-12 lg:gap-16 pb-10 md:pb-12 border-b border-border">
        <div className="md:col-span-7 lg:col-span-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-primary grid place-items-center">
              <span className="font-display text-primary-foreground text-base font-extrabold leading-none">O</span>
            </div>
            <span className="font-display text-xl font-extrabold tracking-tight">OreWire</span>
          </div>
          <h3 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight leading-tight max-w-xl">
            Mining and resource data, news, and filings. All in one place.
          </h3>
          <p className="text-sm text-foreground/60 mt-4 max-w-xl leading-relaxed">
            Stock prices, decoded filings, news release summaries, market news and data for 2,000+ mining and resource companies across Canada and Australia.
          </p>
          <div className="font-mono text-[11px] tracking-widest text-muted-foreground mt-5">
            TSX · TSX-V · CSE · ASX
          </div>
          <div className="flex items-center gap-3 mt-5">
            {socialLinks.map(({ href, label, Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="w-9 h-9 grid place-items-center border border-border hover:border-accent hover:text-accent transition-colors"
              >
                <Icon className="w-3.5 h-3.5" />
              </a>
            ))}
          </div>
        </div>

        <div className="md:col-span-5 lg:col-span-6 grid grid-cols-2 gap-6 sm:gap-10 md:gap-6 lg:gap-10 md:justify-items-end">
          <div className="text-sm w-full md:w-auto">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Product</div>
            <ul className="space-y-2.5 text-foreground/70">
              {productLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-foreground transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-sm w-full md:w-auto">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Company</div>
            <ul className="space-y-2.5 text-foreground/70">
              {companyLinks.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="hover:text-foreground transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div className="border-t border-border bg-[hsl(219_45%_10%)] text-[hsl(36_30%_94%)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-5 text-[11px] font-mono leading-relaxed">
        <span className="uppercase tracking-widest opacity-60 mr-2">Disclaimer</span>
        This platform provides information for educational purposes only. Nothing constitutes investment advice. Always do your own due diligence.
      </div>
      <div className="border-t border-[hsl(36_30%_94%/0.1)]">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-4 flex justify-between items-center text-[11px] font-mono opacity-70">
          <span>© 2026 OreWire Inc.</span>
          <span>orewire.com</span>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
