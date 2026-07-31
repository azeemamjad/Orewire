import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

const ALLOWED_PATHS = [
  "/auth/agree",
  "/auth/google/callback",
  "/change-password",
  "/login",
  "/register",
  "/terms",
  "/privacy",
];

/**
 * Google (and any) accounts without terms_accepted_at must finish /auth/agree.
 */
const ForceSignupAgreementsGuard = () => {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    if (user?.termsAccepted !== false) return;
    if (ALLOWED_PATHS.includes(location.pathname)) return;
    navigate(`/auth/agree?redirect=${encodeURIComponent(location.pathname + location.search)}`, {
      replace: true,
    });
  }, [user?.termsAccepted, isAuthenticated, loading, location.pathname, location.search, navigate]);

  return null;
};

export default ForceSignupAgreementsGuard;
