import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppRoutes from "@/app/routes";
import { SignupModalProvider } from "@/hooks/use-signup-modal";
import WatchlistAlertsRunner from "@/components/shared/WatchlistAlertsRunner";
import ForcePasswordChangeGuard from "@/components/shared/ForcePasswordChangeGuard";
import ForceSignupAgreementsGuard from "@/components/shared/ForceSignupAgreementsGuard";
import ScrollToTop from "@/components/shared/ScrollToTop";
import PageViewTracker from "@/components/shared/PageViewTracker";
import CookieConsent from "@/components/shared/CookieConsent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <WatchlistAlertsRunner />
      <BrowserRouter>
        {/* Inside the router: the signup modal navigates and reads the current
            location, and any page can open it through useSignupModal(). */}
        <SignupModalProvider>
          <ScrollToTop />
          <PageViewTracker />
          <ForcePasswordChangeGuard />
          <ForceSignupAgreementsGuard />
          <AppRoutes />
          <CookieConsent />
        </SignupModalProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
