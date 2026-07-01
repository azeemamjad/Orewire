import type { ReactNode } from "react";
import Nav from "@/components/site/Nav";
import SiteTopBar from "@/components/site/SiteTopBar";
import CommodityBar from "@/components/site/CommodityBar";
import MorningBrief from "@/components/site/MorningBrief";
import SearchHeroBar from "@/components/site/SearchHeroBar";
import Footer from "@/components/site/Footer";

export type SiteLayoutProps = {
  children: ReactNode;
  /** Home page: SiteTopBar + CommodityBar under nav */
  variant?: "default" | "home";
  morningBrief?: boolean;
  searchHeroBar?: boolean;
  className?: string;
};

const SiteLayout = ({
  children,
  variant = "default",
  morningBrief = false,
  searchHeroBar = false,
  className = "min-h-screen bg-background text-foreground",
}: SiteLayoutProps) => (
  <div className={className}>
    <Nav showSiteTopBar={variant !== "home"} />
    {variant === "home" && (
      <>
        <SiteTopBar />
        <CommodityBar />
      </>
    )}
    {morningBrief && <MorningBrief />}
    {searchHeroBar && <SearchHeroBar />}
    {children}
    <Footer />
  </div>
);

export default SiteLayout;
