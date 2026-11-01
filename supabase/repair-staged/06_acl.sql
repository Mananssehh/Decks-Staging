SET LOCAL lock_timeout='5s';
-- App SQL/PLpgSQL functions only: leave extension-owned and C functions alone.
-- Policy helper EXECUTE is required even without a browser RPC caller.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('sql','plpgsql'))
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION
 public.claim_dj_role(),public.create_event(text,text,text,boolean,boolean,integer,text),
 public.ensure_profile(text),public.upgrade_anonymous_profile(text),public.get_my_profile(),public.update_my_profile(text,boolean),
 public.get_guest_event_count(),public.get_guest_join_limits(),public.join_event_by_code(text,text),
 public.request_song(uuid,text,text,text,text,text,text,integer,text,boolean,text),public.remove_my_song_request(uuid),
 public.generate_bridge_pairing_code(uuid),public.regenerate_ingest_token(uuid),public.get_ingest_token(uuid),
 public.set_song_vote(uuid,integer),public.dj_transition_request(uuid,uuid,text),public.dj_set_queue_position(uuid,uuid,double precision),public.repair_write_broadcast(uuid,jsonb,uuid,uuid,text),
 public.has_role(uuid,public.app_role),public.is_event_owner(uuid),public.is_event_member(uuid)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_nicknames(uuid[]),public.get_public_profile(uuid) TO anon,authenticated;
-- Future functions require same-migration explicit grants. Global PUBLIC default overrides schema defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
-- Preflight identifies other public function creators; apply to existing supabase_admin defaults too.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
-- email_queue_dispatch/email_queue_wake definitions intentionally unchanged (both no-op).
-- Trigger creation requires EXECUTE for the migration creator. Invoker functions that call
-- helpers require explicit dependency grants; do not grant trigger helpers to browsers by default.
