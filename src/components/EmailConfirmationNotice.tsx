import { Button } from '@/components/ui/button';
import type { useEmailConfirmation } from '@/hooks/useEmailConfirmation';

export function EmailConfirmationNotice({ confirmation }: { confirmation: ReturnType<typeof useEmailConfirmation> }) {
  return <section className="space-y-4" aria-label="Email confirmation">
    <h2 className="text-xl font-semibold">Check your email</h2>
    <p className="text-sm text-muted-foreground">Open the confirmation link to verify your email. Your guest progress remains saved until verified linking completes.</p>
    <p className="text-sm text-muted-foreground">Check your spam folder if the message hasn’t arrived.</p>
    {confirmation.error && <p role="alert" className="text-sm text-destructive">{confirmation.error}</p>}
    {confirmation.sent && <p role="status" className="text-sm">Confirmation requested. Check your inbox.</p>}
    <Button className="w-full" variant="outline" onClick={confirmation.resend} disabled={confirmation.sending || confirmation.remaining > 0}>
      {confirmation.remaining > 0 ? `Resend in ${confirmation.remaining}s` : 'Resend confirmation'}
    </Button>
    <Button className="w-full" variant="ghost" onClick={confirmation.clear}>Back to sign in</Button>
  </section>;
}