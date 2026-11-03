-- READ ONLY. Root captures output and all relevant pg_get_functiondef/pg_get_constraintdef before install.
SELECT current_database(),version();
SELECT extname,extversion FROM pg_extension WHERE extname IN ('pgcrypto','pg_cron');
SELECT c.conrelid::regclass,c.conname,pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.confrelid='auth.users'::regclass ORDER BY 1,2;
SELECT count(*) auth_users FROM auth.users;
SELECT count(*) profiles FROM public.profiles;
-- Expected staging discrepancy 118 Auth /117 profiles is NOT silently repaired.
SELECT a.id,a.is_anonymous,
 (SELECT count(*) FROM public.events WHERE dj_id=a.id) dj_events,
 (SELECT count(*) FROM public.song_requests WHERE requested_by=a.id) requests,
 (SELECT count(*) FROM public.points_transactions WHERE user_id=a.id) ledger_rows,
 (SELECT count(*) FROM public.dj_tips WHERE user_id=a.id OR dj_id=a.id) tips
FROM auth.users a LEFT JOIN public.profiles p ON p.id=a.id WHERE p.id IS NULL;
SELECT p.id FROM public.profiles p LEFT JOIN auth.users a ON a.id=p.id WHERE a.id IS NULL;
SELECT p.id,p.points,coalesce(sum(t.amount),0) ledger FROM public.profiles p LEFT JOIN public.points_transactions t ON t.user_id=p.id GROUP BY p.id,p.points HAVING p.points<>coalesce(sum(t.amount),0);
SELECT oid::regprocedure,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('join_event_by_code','request_song','set_song_vote','remove_my_song_request','handle_new_user','followup_reserve_tip','followup_attach_tip_session','followup_apply_financial_event','followup_sync_account','check_tip_cap');
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('public','realtime');
SELECT to_regnamespace('guest_runtime') must_be_null;
-- ABORT REVIEW if ownership FKs are missing/different, orphan ownership exists, bootstrap trigger absent,
-- core/payment source differs, or Auth/profile orphans remain unresolved by root.
