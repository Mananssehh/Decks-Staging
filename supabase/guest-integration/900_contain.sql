-- CONTAINMENT ONLY; retains principals, ownership FKs, immutable evidence and Auth wrappers.
BEGIN;
DO $$ BEGIN
 IF to_regclass('guest_runtime.stream_installation') IS NOT NULL THEN
  UPDATE guest_runtime.stream_installation SET enabled=false WHERE id;
  REVOKE ALL ON FUNCTION public.guest_stream_auth(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
  REVOKE ALL ON FUNCTION public.guest_stream_poll(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
 END IF;
END $$;
UPDATE guest_runtime.installation SET enabled=false WHERE id;
UPDATE guest_runtime.bootstraps SET revoked_at=coalesce(revoked_at,now());
UPDATE guest_runtime.sessions SET revoked_at=coalesce(revoked_at,now());
REVOKE ALL ON FUNCTION public.guest_event_api(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guest_validate_actor(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_guest_principal(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
