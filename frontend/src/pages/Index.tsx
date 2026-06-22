import Nav from "@/components/site/Nav";
import CommodityBar from "@/components/site/CommodityBar";
import SearchHero from "@/components/site/SearchHero";
import Movers from "@/components/site/Movers";
import NewsFeed from "@/components/site/NewsFeed";
import MarketNews from "@/components/site/MarketNews";
import NewsReleases from "@/components/site/NewsReleases";
import Filings from "@/components/site/Filings";
import CommoditySidebar from "@/components/site/CommoditySidebar";
import LiveFeed from "@/components/site/LiveFeed";
import HowItWorks from "@/components/site/HowItWorks";
import Newsletter from "@/components/site/Newsletter";
import Footer from "@/components/site/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <CommodityBar />
      <main>
        <section className="border-b border-border bg-background">
          <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
            <SearchHero />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:h-[780px]">
              <Movers />
              <NewsFeed />
              <Filings />
              <CommoditySidebar />
            </div>
          </div>
        </section>

        <MarketNews />
        <NewsReleases />
        <LiveFeed />
        <HowItWorks />
        <Newsletter />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
