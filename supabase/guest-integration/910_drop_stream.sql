-- SOURCE ONLY: transport-only teardown; keeps all core guest identities/evidence.
-- Call containment first if stopping all guest access is desired. Reinstall starts
-- revision at zero and requires full-snapshot reconnect; never reuse old baselines.
BEGIN;
DO $$ DECLARE d text; r record; BEGIN
 IF to_regclass('guest_runtime.stream_installation') IS NULL THEN RETURN; END IF;
 IF to_regclass('guest_runtime.application_before') IS NOT NULL THEN RAISE EXCEPTION 'Application overlay installed: use containment or full reviewed empty restore'; END IF;
 UPDATE guest_runtime.stream_installation SET enabled=false WHERE id;
 SELECT snapshot_before INTO d FROM guest_runtime.stream_installation WHERE id;
 IF d IS NULL THEN RAISE EXCEPTION 'Missing snapshot backup: refuse stream teardown'; END IF;
 EXECUTE d;
 FOR r IN SELECT t.tgrelid::regclass rel,t.tgname FROM pg_trigger t WHERE t.tgname='guest_stream_revision' AND t.tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace IN('public'::regnamespace,'guest_runtime'::regnamespace)) LOOP
  EXECUTE format('DROP TRIGGER %I ON %s',r.tgname,r.rel);
 END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.guest_stream_auth(uuid,text);
DROP FUNCTION IF EXISTS public.guest_stream_poll(uuid,uuid[]);
DROP FUNCTION IF EXISTS guest_runtime.stream_changed();
DROP FUNCTION IF EXISTS guest_runtime.stream_bump(uuid);
DROP TABLE IF EXISTS guest_runtime.event_revisions;
DROP TABLE IF EXISTS guest_runtime.stream_installation;
COMMIT;