import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CONFIRMATION_COOLDOWN_MS, confirmationRedirect, readConfirmation, saveConfirmation, type PendingConfirmation } from '@/lib/emailConfirmation';

export function useEmailConfirmation() {
  const [pending, setPending] = useState(readConfirmation);
  const [now, setNow] = useState(Date.now);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const begin = (p: Omit<PendingConfirmation, 'resendAt'>) => {
    const value = { ...p, resendAt: Date.now() + CONFIRMATION_COOLDOWN_MS };
    saveConfirmation(value); setPending(value); setError(''); setSent(false); setNow(Date.now());
  };
  const clear = () => { saveConfirmation(null); setPending(null); setError(''); };
  const remaining = pending ? Math.max(0, Math.ceil((pending.resendAt - now) / 1000)) : 0;
  const resend = async () => {
    if (!pending || sending || Date.now() < pending.resendAt) return;
    setSending(true); setError(''); setSent(false);
    // Apply cooldown to failed attempts too, to avoid bursts and accidental duplicate sends.
    const value = { ...pending, resendAt: Date.now() + CONFIRMATION_COOLDOWN_MS };
    saveConfirmation(value); setPending(value); setNow(Date.now());
    try {
      const { error } = await supabase.auth.resend({ type: pending.type, email: pending.email,
        options: { emailRedirectTo: confirmationRedirect(window.location.origin, pending.next) } });
      if (error) throw error;
      setSent(true);
    } catch { setError('Confirmation could not be resent. Wait a minute and try again.'); }
    finally { setSending(false); }
  };
  return { pending, begin, clear, remaining, resend, sending, error, sent };
}