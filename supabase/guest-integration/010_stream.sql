-- SOURCE ONLY: after reviewed 001..008, in the same eventual install transaction.
-- No browser grants, Realtime objects, cron or Auth records.
CREATE TABLE guest_runtime.event_revisions(event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0));
REVOKE ALL ON guest_runtime.event_revisions FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.event_revisions ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.event_revisions(event_id) SELECT id FROM public.events;
CREATE TABLE guest_runtime.stream_installation(id boolean PRIMARY KEY CHECK(id),contract text NOT NULL,enabled boolean NOT NULL DEFAULT false,snapshot_before text NOT NULL);
REVOKE ALL ON guest_runtime.stream_installation FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.stream_installation ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.stream_installation VALUES(true,'guest-stream-v1',false,pg_get_functiondef('guest_runtime.snapshot(uuid,uuid)'::regprocedure));
-- Revisions are transactional even while stream transport is disabled, so enabling
-- never hides changes. Installed contract gates bumps; transport also requires both
-- enabled markers. No new identity mutex or event tuple lock in row triggers.
CREATE FUNCTION guest_runtime.stream_bump(_event uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.stream_installation WHERE id AND contract='guest-stream-v1') THEN RETURN; END IF;
 -- All surviving events get a revision row at install or their INSERT trigger.
 -- UPDATE avoids FK KEY SHARE/event-lock acquisition after child tuple writes.
 UPDATE guest_runtime.event_revisions SET revision=revision+1 WHERE event_id=_event;
END $$;
CREATE FUNCTION guest_runtime.stream_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid; BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='events' THEN
  IF TG_OP='DELETE' THEN RETURN NULL; END IF; -- FK cascade removes revision, poll sees missing event
  IF TG_OP='INSERT' THEN INSERT INTO guest_runtime.event_revisions(event_id) VALUES(NEW.id); END IF;
  eid:=NEW.id;
 ELSE
  IF TG_OP='DELETE' THEN eid:=OLD.event_id; ELSE eid:=NEW.event_id; END IF;
  -- OLD event IDs on any supported move also need invalidation.
  IF TG_OP='UPDATE' AND OLD.event_id IS DISTINCT FROM NEW.event_id THEN PERFORM guest_runtime.stream_bump(OLD.event_id); END IF;
 END IF;
 PERFORM guest_runtime.stream_bump(eid);
 RETURN NULL;
END $$;
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['song_requests','events','now_playing','event_banned_guests','event_participants'] LOOP
  EXECUTE format('CREATE TRIGGER guest_stream_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION guest_runtime.stream_changed()',rel);
 END LOOP;
END $$;
-- Sessions include claim revocation and principal/profile cascades. No principal
-- row trigger loops through events: that would invert principal/event order.
CREATE TRIGGER guest_stream_revision AFTER INSERT OR UPDATE OR DELETE ON guest_runtime.sessions FOR EACH ROW EXECUTE FUNCTION guest_runtime.stream_changed();
-- Preserve complete safe DTO without copying it: install-time exact transformation
-- adds revision inside the existing ONE stable SQL statement, not a second read.
DO $$ DECLARE d text; patched text; BEGIN
 SELECT snapshot_before INTO d FROM guest_runtime.stream_installation WHERE id;
 patched:=replace(d,'SELECT jsonb_build_object(''event''', 'SELECT jsonb_build_object(''revision'',coalesce((SELECT revision::text FROM guest_runtime.event_revisions WHERE event_id=_event),''0'')) || jsonb_build_object(''event''');
 IF patched=d THEN RAISE EXCEPTION 'Snapshot source drift: review before stream install'; END IF;
 EXECUTE patched;
END $$;
CREATE FUNCTION public.guest_stream_auth(_event_id uuid,_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; s guest_runtime.sessions; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN guest_runtime.fail(403,'forbidden'); END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.installation WHERE id AND enabled AND contract='guest-integration-v1')
 OR NOT EXISTS(SELECT 1 FROM guest_runtime.stream_installation WHERE id AND enabled AND contract='guest-stream-v1') THEN RETURN guest_runtime.fail(503,'stream_unavailable'); END IF;
 u:=guest_runtime.validate_session(_event_id,_token,false);
 IF u IS NULL THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 SELECT * INTO s FROM guest_runtime.sessions WHERE principal_id=u AND event_id=_event_id AND token_hash=guest_runtime.digest(_token);
 RETURN jsonb_build_object('ok',true,'session_id',s.id,'actor_id',u,'event_id',_event_id,'expires_at',s.expires_at,'revision',(SELECT revision::text FROM guest_runtime.event_revisions WHERE event_id=_event_id));
END $$;
REVOKE ALL ON FUNCTION public.guest_stream_auth(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_stream_auth(uuid,text) TO service_role;
CREATE FUNCTION public.guest_stream_poll(_event_id uuid,_session_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN guest_runtime.fail(403,'forbidden'); END IF;
 IF _session_ids IS NULL OR cardinality(_session_ids)>256 OR cardinality(_session_ids)<1 OR array_position(_session_ids,NULL) IS NOT NULL THEN RETURN guest_runtime.fail(400,'invalid_sessions'); END IF;
 -- ONE READ statement, no exclusive event/session/principal locks. Session IDs
 -- arrive only from server memory after token auth, never from a public caller.
 RETURN (
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM guest_runtime.installation WHERE id AND enabled AND contract='guest-integration-v1') OR NOT EXISTS(SELECT 1 FROM guest_runtime.stream_installation WHERE id AND enabled AND contract='guest-stream-v1')
   THEN guest_runtime.fail(503,'stream_unavailable')
   ELSE jsonb_build_object('ok',true,'event_id',_event_id,'revision',coalesce((SELECT revision::text FROM guest_runtime.event_revisions WHERE event_id=_event_id),'0'),
    'lifecycle',coalesce((SELECT requests_status FROM public.events WHERE id=_event_id),'deleted'),
    'valid_session_ids',coalesce((SELECT jsonb_agg(s.id ORDER BY s.id) FROM guest_runtime.sessions s JOIN guest_runtime.app_principals p ON p.id=s.principal_id JOIN public.profiles profile ON profile.id=p.id
     WHERE s.id=ANY(_session_ids) AND s.event_id=_event_id AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND p.kind='guest' AND p.merged_into IS NULL
     AND EXISTS(SELECT 1 FROM public.events WHERE id=_event_id) AND guest_runtime.member(p.id,_event_id)),'[]'::jsonb)) END
 );
END $$;
REVOKE ALL ON FUNCTION public.guest_stream_poll(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_stream_poll(uuid,uuid[]) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
-- Review gate: stream marker remains disabled; enabling is separately reviewed.