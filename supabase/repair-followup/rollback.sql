-- CONTAINMENT ONLY; preserve ambiguous reservations, financial and webhook evidence.
REVOKE ALL ON FUNCTION public.followup_reserve_tip(uuid,uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.followup_attach_tip_session(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
-- Leave signed event settlement callable for existing paid sessions. Stop new checkout deployment.
-- Never DELETE reservations or expire by clock alone. Reconcile with Stripe evidence first.