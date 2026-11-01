# DECKS Staging

Core and payment repair SQL are independently installed. Canonical staging `stripe-webhook`, `tip-reconcile`, then `tip-create-checkout` were successfully deployed in this final staging turn. Actual hosted client types were regenerated.

Do **not reapply SQL**. Read [`supabase/repair-followup/README.md`](supabase/repair-followup/README.md) for installed-state evidence, deployment hashes, tests and remaining provider gates. No Stripe API calls, sessions, payments, refunds, emails, publication, keys or quota changes were performed. Authenticated two-tab verification and production build remain independent-reviewer checks.
