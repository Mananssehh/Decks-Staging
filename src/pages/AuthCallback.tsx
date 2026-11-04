import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { completeCallback } from "@/lib/authCallback";
import {claimPendingGuest} from '@/lib/guestClient';
import { confirmedAccount, readConfirmation, saveConfirmation } from '@/lib/emailConfirmation';
import { Button } from '@/components/ui/button';

/**
 * Dedicated OAuth callback route.
 * Handles both PKCE (?code=...) and implicit (#access_token=...) flows so
 * Supabase redirects never fall through to the SPA 404 page.
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState('');

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
          async () => {
            const {data,error}=await supabase.auth.getUser();
            const pending=readConfirmation();
            if(error||!confirmedAccount(data.user,pending?.email))return false;
            if(pending?.legacyUserId){
              if(data.user?.id!==pending.legacyUserId)return false;
              const result=await supabase.rpc('upgrade_anonymous_profile',{p_nickname:pending.nickname??null});
              if(result.error)throw new Error('Your email is verified, but your profile could not be updated. Try signing in again.');
            }
            return true;
          });
        await claimPendingGuest();
        saveConfirmation(null);
        finish(next);
      } catch (e: unknown) {
        if(cancelled)return;
        const message=e instanceof Error ? e.message : 'Sign-in failed';
        setError(message);toast.error(message);
        window.history.replaceState({},document.title,'/auth/callback');
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {error?<div className="max-w-md space-y-4 px-6"><p role="alert">{error}</p><Button onClick={()=>navigate('/auth',{replace:true})}>Return to confirmation / sign in</Button></div>:<div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Signing you in…</span>
      </div>}
    </div>
  );
};

export default AuthCallback;
