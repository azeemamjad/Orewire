import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

// Users created (or reset) by an admin get a temporary password and the
// `mustChangePassword` flag. Until they set a new password we keep them on
// /change-password — they may still sign out via the nav.
const ALLOWED_PATHS = ["/change-password", "/login", "/register"];

const ForcePasswordChangeGuard = () => {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    if (!user?.mustChangePassword) return;
    if (ALLOWED_PATHS.includes(location.pathname)) return;
    navigate(`/change-password?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
  }, [user?.mustChangePassword, isAuthenticated, loading, location.pathname, navigate]);

  return null;
};

export default ForcePasswordChangeGuard;
