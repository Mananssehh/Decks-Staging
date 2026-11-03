-- Intentionally DISABLED at install. Root enables only after reviewed verification.
REVOKE ALL ON ALL TABLES IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
-- No changes to public app policies, publication, disabled probe or email jobs.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM guest_runtime.app_principals WHERE kind='auth' AND auth_user_id IS DISTINCT FROM id) THEN RAISE EXCEPTION 'Auth identity backfill mismatch'; END IF;
 IF (SELECT count(*) FROM guest_runtime.app_principals WHERE kind='auth')<>(SELECT count(*) FROM auth.users) THEN RAISE EXCEPTION 'Auth rowcount mismatch'; END IF;
 IF has_function_privilege('anon','public.guest_event_api(text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.guest_event_api(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Guest API ACL open'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='guest_runtime'::regnamespace AND relkind='r' AND NOT relrowsecurity) THEN RAISE EXCEPTION 'Private RLS missing'; END IF;
END $$;
