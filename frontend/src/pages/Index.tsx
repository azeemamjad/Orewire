import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import CommodityBar from "@/components/site/CommodityBar";
import Movers from "@/components/site/Movers";
import LiveFeed from "@/components/site/LiveFeed";
import HowItWorks from "@/components/site/HowItWorks";
import Pricing from "@/components/site/Pricing";
import Newsletter from "@/components/site/Newsletter";
import Footer from "@/components/site/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <MarketStrip />
      <CommodityBar />
      <main>
        <Movers />
        <LiveFeed />
        <HowItWorks />
        <Pricing />
        <Newsletter />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
