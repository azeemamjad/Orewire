import SiteLayout from "@/layouts/SiteLayout";
import OpeningDashboard from "@/components/site/OpeningDashboard";
import MarketNews from "@/components/site/MarketNews";
import HomeFeeds from "@/components/site/HomeFeeds";
import HowItWorks from "@/components/site/HowItWorks";
import Newsletter from "@/components/site/Newsletter";

const Index = () => {
  return (
    <SiteLayout variant="home">
      <main>
        <OpeningDashboard />
        <MarketNews />
        <HomeFeeds />
        <HowItWorks />
        <Newsletter />
      </main>
    </SiteLayout>
  );
};

export default Index;
