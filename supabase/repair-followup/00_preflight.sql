-- READ ONLY. Operator must verify DECKS Staging. No historical draft promotion.
SELECT p.oid::regprocedure,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('check_tip_cap','tip_pending_is_live','has_role','repair_claim_bridge_code');
SELECT status,count(*) FROM public.dj_tips GROUP BY status;
SELECT user_id,version,count(*) FROM public.purchase_consents GROUP BY user_id,version HAVING count(*)>1;
SELECT stripe_checkout_session_id,count(*) FROM public.dj_tips WHERE stripe_checkout_session_id IS NOT NULL GROUP BY stripe_checkout_session_id HAVING count(*)>1;
SELECT to_regclass('public.followup_tip_reservations') existing_reservations;
-- If reservations already exist, stop and inspect definitions; this is a first-install package.