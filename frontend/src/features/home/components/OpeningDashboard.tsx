import Movers from "@/components/site/Movers";
import NewsFeed from "@/components/site/NewsFeed";
import Filings from "@/components/site/Filings";
import CommoditySidebar from "@/components/site/CommoditySidebar";
import SearchHero from "@/components/site/SearchHero";

const OpeningDashboard = () => (
  <section className="border-b border-border bg-background">
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <SearchHero />
      {/* DOM order is the desktop column order (movers, news, filings, market
          data). Below lg the `order-*` classes restack them as gainers/losers,
          commodities, indexes, currencies, news, filings; `lg:order-none`
          hands control back to DOM order at desktop widths. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:h-[780px]">
        <Movers className="order-1 lg:order-none" />
        <NewsFeed className="order-3 lg:order-none" />
        <Filings className="order-4 lg:order-none" />
        <CommoditySidebar className="order-2 lg:order-none" />
      </div>
    </div>
  </section>
);

export default OpeningDashboard;
