import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { completeCallback } from "@/lib/authCallback";
import {claimPendingGuest} from '@/lib/guestClient';

/**
 * Dedicated OAuth callback route.
 * Handles both PKCE (?code=...) and implicit (#access_token=...) flows so
 * Supabase redirects never fall through to the SPA 404 page.
 */
const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const finish = (path = "/") => {
      if (cancelled) return;
      // Clean any hash/query OAuth artifacts before navigating.
      window.history.replaceState({}, document.title, path);
      navigate(path, { replace: true });
    };

    const run = async () => {
      try {
        const next = await completeCallback(window.location.href,
          code => supabase.auth.exchangeCodeForSession(code),
          async () => !!(await supabase.auth.getSession()).data.session);
        await claimPendingGuest();
        finish(next);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Sign-in failed");
        finish("/auth");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Signing you in…</span>
      </div>
    </div>
  );
};

export default AuthCallback;
