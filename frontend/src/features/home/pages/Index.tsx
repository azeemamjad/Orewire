import SiteLayout from "@/layouts/SiteLayout";
import { useSeo } from "@/lib/seo";
import OpeningDashboard from "@/components/site/OpeningDashboard";
import MarketNews from "@/components/site/MarketNews";
import HomeFeeds from "@/components/site/HomeFeeds";
import HowItWorks from "@/components/site/HowItWorks";
import Newsletter from "@/components/site/Newsletter";

const Index = () => {
  // The home page declares its metadata explicitly rather than inheriting it from the
  // shell. index.html's <title> is only read on first load, so without this a
  // client-side navigation back to the home page left the previous page's title in the
  // tab and the history entry. These values match index.html exactly.
  useSeo(
    {
      title: "OreWire | Mining and Resource Intelligence for Investors",
      description:
        "Stock prices, decoded filings, and news release summaries for 2,000+ mining and resource companies across the TSX, TSX-V, CSE, and ASX.",
      canonicalPath: "/",
    },
    [],
  );

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
