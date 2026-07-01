import Movers from "@/components/site/Movers";
import NewsFeed from "@/components/site/NewsFeed";
import Filings from "@/components/site/Filings";
import CommoditySidebar from "@/components/site/CommoditySidebar";
import SearchHero from "@/components/site/SearchHero";

const OpeningDashboard = () => (
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
);

export default OpeningDashboard;
