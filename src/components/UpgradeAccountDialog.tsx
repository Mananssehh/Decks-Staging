import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { emailSchema, passwordSchema } from "@/lib/validation";
import {useActor} from '@/hooks/useActor';
import {guestStore,claimPendingGuest} from '@/lib/guestClient';
import {useNavigate} from 'react-router-dom';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Upgrades the current anonymous Supabase session into a permanent account.
 * Same auth.uid() is preserved — profile, nickname, points, requests,
 * votes, tips and reports all carry over with zero data migration.
 */
export function UpgradeAccountDialog({ open, onOpenChange }: Props) {
  const { profile, refreshProfile } = useAuth();
  const actor=useActor(),navigate=useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const emailParse = emailSchema.safeParse(email);
      if (!emailParse.success) throw new Error(emailParse.error.issues[0].message);
      const passParse = passwordSchema.safeParse(password);
      if (!passParse.success) throw new Error(passParse.error.issues[0].message);

      // Anonymous upgrade — keeps the same auth.uid().
      if(actor.kind==='guest'){
        guestStore().intent(emailParse.data);
        const {data,error}=await supabase.auth.signUp({email:emailParse.data,password:passParse.data,options:{data:{nickname:actor.profile?.nickname??'Guest'},emailRedirectTo:`${window.location.origin}/auth/callback`}});
        if(error)throw error;
        const claimed=await claimPendingGuest();if(claimed)await refreshProfile();onOpenChange(false);
        toast.success(claimed?'Account created — your guest progress is linked.':data.session?.user.email_confirmed_at?'Account created. Your guest progress stays saved until linking completes.':'Check your email to confirm your account. Your guest progress stays saved until linking completes.');return;
      }
      const { error: upErr } = await supabase.auth.updateUser({
        email: emailParse.data,
        password: passParse.data,
      });
      if (upErr) throw upErr;

      // Re-stamp profile (no-op for nickname if unchanged).
      await supabase.rpc("upgrade_anonymous_profile", {
        p_nickname: profile?.nickname ?? null,
      });
      await refreshProfile();

      toast.success(
        "Account created — your nickname, points, and history are saved. Check your email to confirm.",
      );
      onOpenChange(false);
      setEmail("");
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Save your progress
          </DialogTitle>
          <DialogDescription>
            Create an account to keep your nickname{profile?.nickname ? ` "${profile.nickname}"` : ""},
            points, and history across devices. Nothing is lost — same profile, same activity.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="upgrade-email">Email</Label>
            <Input
              id="upgrade-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@club.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="upgrade-password">Password</Label>
            <Input
              id="upgrade-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading} variant="premium" className="w-full h-11">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
          {actor.kind==='guest'&&<Button type="button" variant="ghost" onClick={()=>{guestStore().intent();onOpenChange(false);navigate('/auth?next=/profile&claim=guest');}}>Link an existing account</Button>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
