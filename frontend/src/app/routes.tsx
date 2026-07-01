import { Route, Routes } from "react-router-dom";
import Index from "@/features/home/pages/Index";
import Companies from "@/features/companies/pages/Companies";
import CompanyDetail from "@/features/companies/pages/CompanyDetail";
import Watchlist from "@/features/watchlist/pages/Watchlist";
import Login from "@/features/auth/pages/Login";
import Jobs from "@/features/jobs/pages/Jobs";
import JobDashboard from "@/features/jobs/pages/JobDashboard";
import CommodityDetail from "@/features/markets/pages/CommodityDetail";
import CurrencyDetail from "@/features/markets/pages/CurrencyDetail";
import IndexDetail from "@/features/markets/pages/IndexDetail";
import News from "@/features/news/pages/News";
import MarketNews from "@/features/news/pages/MarketNews";
import NewsDetail from "@/features/news/pages/NewsDetail";
import FilingDetail from "@/features/news/pages/FilingDetail";
import FilingsList from "@/features/news/pages/FilingsList";
import Contact from "@/features/static/pages/Contact";
import Terms from "@/features/static/pages/Terms";
import Privacy from "@/features/static/pages/Privacy";
import Profile from "@/features/auth/pages/Profile";
import ChangePassword from "@/features/auth/pages/ChangePassword";
import NotFound from "@/pages/NotFound";

export default function AppRoutes() {
  return (
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
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login />} />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
