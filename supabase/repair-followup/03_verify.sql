-- Read-only verification/resume; no replay of core repairs.
SELECT public.followup_payment_contract();
SELECT count(*) reservations_without_tip FROM public.followup_tip_reservations r LEFT JOIN public.dj_tips d ON d.id=r.tip_id WHERE d.id IS NULL;
SELECT count(*) session_mismatches FROM public.followup_tip_reservations r JOIN public.dj_tips d ON d.id=r.tip_id WHERE r.session_id IS DISTINCT FROM d.stripe_checkout_session_id;
SELECT p.oid::regprocedure,p.proacl,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'followup_%';
SELECT has_table_privilege('service_role','public.dj_tips','insert') direct_insert,
 has_table_privilege('service_role','public.dj_tips','update') direct_update;
SELECT c.relname,c.relrowsecurity,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'followup_%';
SELECT state,count(*) FROM public.followup_tip_reservations GROUP BY state;
SELECT notification_state,count(*) FROM public.followup_account_evidence GROUP BY notification_state;
