import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Companies from "./pages/Companies.tsx";
import CompanyDetail from "./pages/CompanyDetail.tsx";
import Watchlist from "./pages/Watchlist.tsx";
import Login from "./pages/Login.tsx";
import Jobs from "./pages/Jobs.tsx";
import JobDashboard from "./pages/JobDashboard.tsx";
import CommodityDetail from "./pages/CommodityDetail.tsx";
import CurrencyDetail from "./pages/CurrencyDetail.tsx";
import IndexDetail from "./pages/IndexDetail.tsx";
import News from "./pages/News.tsx";
import MarketNews from "./pages/MarketNews.tsx";
import NewsDetail from "./pages/NewsDetail.tsx";
import FilingDetail from "./pages/FilingDetail.tsx";
import FilingsList from "./pages/FilingsList.tsx";
import Contact from "./pages/Contact.tsx";
import Terms from "./pages/Terms.tsx";
import Privacy from "./pages/Privacy.tsx";
import Profile from "./pages/Profile.tsx";
import NotFound from "./pages/NotFound.tsx";
import WatchlistAlertsRunner from "@/components/site/WatchlistAlertsRunner";
import ScrollToTop from "@/components/ScrollToTop";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <WatchlistAlertsRunner />
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/company/:slug" element={<CompanyDetail />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/dashboard" element={<JobDashboard />} />
          <Route path="/market/commodity/:slug" element={<CommodityDetail />} />
          <Route path="/market/currency/:slug" element={<CurrencyDetail />} />
          <Route path="/market/index/:slug" element={<IndexDetail />} />
          <Route path="/news" element={<News />} />
          <Route path="/market-news" element={<MarketNews />} />
          <Route path="/news/:slug" element={<NewsDetail />} />
          <Route path="/filings" element={<FilingsList />} />
          <Route path="/filings/:id" element={<FilingDetail />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Login />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
