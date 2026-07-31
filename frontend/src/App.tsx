import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppRoutes from "@/app/routes";
import WatchlistAlertsRunner from "@/components/shared/WatchlistAlertsRunner";
import ForcePasswordChangeGuard from "@/components/shared/ForcePasswordChangeGuard";
import ForceSignupAgreementsGuard from "@/components/shared/ForceSignupAgreementsGuard";
import ScrollToTop from "@/components/shared/ScrollToTop";
import CookieConsent from "@/components/shared/CookieConsent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <WatchlistAlertsRunner />
      <BrowserRouter>
        <ScrollToTop />
        <ForcePasswordChangeGuard />
        <ForceSignupAgreementsGuard />
        <AppRoutes />
        <CookieConsent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
