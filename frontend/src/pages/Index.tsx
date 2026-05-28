import Nav from "@/components/site/Nav";
import MarketStrip from "@/components/site/MarketStrip";
import CommodityBar from "@/components/site/CommodityBar";
import SearchHero from "@/components/site/SearchHero";
import Movers from "@/components/site/Movers";
import NewsFeed from "@/components/site/NewsFeed";
import CommoditySidebar from "@/components/site/CommoditySidebar";
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
        {/* Search + Bento grid in one section */}
        <section className="border-b border-border bg-background">
          <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
            <SearchHero />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5">
                <Movers />
              </div>
              <div className="lg:col-span-4">
                <NewsFeed />
              </div>
              <div className="lg:col-span-3 space-y-4">
                <CommoditySidebar />
              </div>
            </div>
          </div>
        </section>

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
