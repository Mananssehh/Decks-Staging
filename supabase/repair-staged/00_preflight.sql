-- READ ONLY: run in the staging SQL interface. Stop if assertions fail; rerun fresh catalog capture.
-- SQL cannot prove the frontend project UUID: operator MUST verify DECKS Staging before execution.
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.request_song(uuid,text,text,text,text,text,text,integer,text,boolean,text)'::regprocedure)<>'9c4ca0d688f5b4300241c5da1d52e871' THEN
 RAISE EXCEPTION 'request_song drift: review new live catalog'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.join_event_by_code(text,text)'::regprocedure)<>'586bc3dd220d6d2babf0678618be653b' THEN
 RAISE EXCEPTION 'join boundary drift'; END IF;
 IF EXISTS(SELECT 1 FROM public.song_requests WHERE status='playing' GROUP BY event_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Multiple playing rows: preserve evidence and resolve independently'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_integrations GROUP BY event_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Multiple integration rows: preserve evidence and resolve independently'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal AND tgenabled<>'D' AND tgfoid='public.handle_new_user()'::regprocedure) THEN RAISE EXCEPTION 'Bootstrap already attached: inspect trigger before proceeding'; END IF;
 IF (SELECT prosrc FROM pg_proc WHERE oid='public.email_queue_dispatch()'::regprocedure) NOT LIKE '%BEGIN RETURN; END;%'
 OR (SELECT prosrc FROM pg_proc WHERE oid='public.email_queue_wake()'::regprocedure) NOT LIKE '%BEGIN RETURN NULL; END;%' THEN RAISE EXCEPTION 'Staging email dispatch is not disabled'; END IF;
END $$;
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner),p.proacl,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';
SELECT * FROM pg_policies WHERE schemaname='public';
SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('auth.users'::regclass,'public.votes'::regclass,'public.song_requests'::regclass,'public.profiles'::regclass);
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl;
-- PL/pgSQL bodies are late-bound: pg_depend alone is NOT sufficient. Review evidence/catalog.sql
-- and source RPC inventory. Policy helpers keep authenticated EXECUTE; trigger owners keep internal execution.
