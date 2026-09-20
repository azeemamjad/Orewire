import SearchHero from "@/components/site/SearchHero";

// Standalone search-hero band for pages that place it below the price/ticker bars.
const SearchHeroBar = () => (
  <section className="border-b border-border bg-background">
    <div className="container-page pt-6">
      <SearchHero />
    </div>
  </section>
);

export default SearchHeroBar;
