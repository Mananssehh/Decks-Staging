-- READ ONLY. Operator must verify DECKS Staging. No historical draft promotion.
SELECT p.oid::regprocedure,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('check_tip_cap','tip_pending_is_live','has_role','repair_claim_bridge_code');
SELECT status,count(*) FROM public.dj_tips GROUP BY status;
SELECT user_id,version,count(*) FROM public.purchase_consents GROUP BY user_id,version HAVING count(*)>1;
SELECT stripe_checkout_session_id,count(*) FROM public.dj_tips WHERE stripe_checkout_session_id IS NOT NULL GROUP BY stripe_checkout_session_id HAVING count(*)>1;
SELECT to_regclass('public.followup_tip_reservations') existing_reservations;
-- If reservations already exist, stop and inspect definitions; this is a first-install package.
-- Inspect all financial writers; only canonical functions must remain scheduled/deployed at enablement.
SELECT p.oid::regprocedure,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (pg_get_functiondef(p.oid) ILIKE '%dj_tips%' AND p.prokind='f');
SELECT to_regprocedure('public.followup_payment_contract()') installed_contract;
-- Review duplicate PI/charge/account links and existing ambiguous pending records before enablement.
SELECT stripe_payment_intent_id,count(*) FROM public.dj_tips WHERE stripe_payment_intent_id IS NOT NULL GROUP BY stripe_payment_intent_id HAVING count(*)>1;
SELECT stripe_charge_id,count(*) FROM public.dj_tips WHERE stripe_charge_id IS NOT NULL GROUP BY stripe_charge_id HAVING count(*)>1;
