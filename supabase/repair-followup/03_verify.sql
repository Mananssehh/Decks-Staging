-- READ ONLY after independently applying 01/02 atomically.
SELECT count(*) reservations_without_tip FROM public.followup_tip_reservations r LEFT JOIN public.dj_tips d ON d.id=r.tip_id WHERE d.id IS NULL;
SELECT count(*) session_mismatches FROM public.followup_tip_reservations r JOIN public.dj_tips d ON d.id=r.tip_id WHERE r.session_id IS DISTINCT FROM d.stripe_checkout_session_id;
SELECT p.oid::regprocedure,has_function_privilege('authenticated',p.oid,'execute') client_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'followup_%';