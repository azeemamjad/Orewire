import Nav from "@/components/site/Nav";
import SiteTopBar from "@/components/site/SiteTopBar";
import CommodityBar from "@/components/site/CommodityBar";
import OpeningDashboard from "@/components/site/OpeningDashboard";
import MarketNews from "@/components/site/MarketNews";
import HomeFeeds from "@/components/site/HomeFeeds";
import HowItWorks from "@/components/site/HowItWorks";
import Newsletter from "@/components/site/Newsletter";
import Footer from "@/components/site/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav showSiteTopBar={false} />
      <SiteTopBar />
      <CommodityBar />
      <main>
        <OpeningDashboard />
        <MarketNews />
        <HomeFeeds />
        <HowItWorks />
        <Newsletter />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
