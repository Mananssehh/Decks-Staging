-- SOURCE ONLY canonical candidate. Reproduces EXACTLY the hosted staging definitions committed by the
-- reviewer on 2026-11-03 (snapshot 06:33:40 UTC; aliases/member 06:45:05 UTC), verbatim pg_get_functiondef.
--   psql -v ON_ERROR_STOP=1 -1 -f 012_capacity.sql      rollback: 912_rollback_capacity.sql
-- Cause (hosted 06:11-06:15 UTC, CAPACITY_012.md): per-song non-inlinable aliases()/actor() calls made
-- snapshot() O(songs x principals) while it held the event row FOR SHARE; writers convoyed to 57014.
-- States accepted (all three md5s must match one state exactly; anything else is refused):
--   A) fresh 001..011  -> capture the three definitions into private RLS guest_runtime.capacity_before, install.
--   B) exact hosted reviewer state -> NO-OP (idempotent; reviewer_*_baseline tables are preserved untouched).
-- No index is added (the hosted state has none). Lock order/strength, writers, claim exclusion, ACLs, DTO unchanged.
DO $$ DECLARE a text:=md5(pg_get_functiondef('guest_runtime.aliases(uuid)'::regprocedure));
 m text:=md5(pg_get_functiondef('guest_runtime.member(uuid,uuid)'::regprocedure));
 s text:=md5(pg_get_functiondef('guest_runtime.snapshot(uuid,uuid)'::regprocedure)); BEGIN
 IF to_regclass('guest_runtime.application_before') IS NULL THEN RAISE EXCEPTION '012 requires installed 011'; END IF;
 IF (a,m,s)=('6b4fac919cee58b17435432ffb14deb7','c1dbf1dcc33b557dcbcadae71b03cdb0','c2cda1c3e9bc5e81f3f8b0eb23b3bfbc') THEN
  PERFORM set_config('guest012.mode','noop',true); RAISE NOTICE '012 canonical definitions already installed; no change';
 ELSIF (a,m,s)=('b2a235743d0e527c513321fc366cdbd7','9b1f695d58883db8029d4478264bac69','83fa330df2eb0ed192c4eeeabe20d0c0') THEN
  IF to_regclass('guest_runtime.capacity_before') IS NOT NULL THEN RAISE EXCEPTION '012 backup exists with original definitions; inspect'; END IF;
  PERFORM set_config('guest012.mode','install',true);
 ELSE RAISE EXCEPTION 'Unexpected aliases/member/snapshot definitions; inspect before 012'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS guest_runtime.capacity_before(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON guest_runtime.capacity_before FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.capacity_before ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.capacity_before SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc
 WHERE current_setting('guest012.mode')='install' AND oid IN('guest_runtime.aliases(uuid)'::regprocedure,'guest_runtime.member(uuid,uuid)'::regprocedure,'guest_runtime.snapshot(uuid,uuid)'::regprocedure);
DO $$ BEGIN IF current_setting('guest012.mode')='noop' AND NOT EXISTS(SELECT 1 FROM guest_runtime.capacity_before) THEN DROP TABLE guest_runtime.capacity_before; END IF; END $$;
-- Re-creating identical text in state B is a no-op for behaviour and ACLs.
CREATE OR REPLACE FUNCTION guest_runtime.aliases(_actor uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH root AS MATERIALIZED (SELECT guest_runtime.actor(_actor) canonical_id)
 SELECT coalesce(array_agg(p.id ORDER BY p.id),ARRAY[]::uuid[])
 FROM guest_runtime.app_principals p CROSS JOIN root
 WHERE p.id=root.canonical_id OR p.merged_into=root.canonical_id
$function$;
CREATE OR REPLACE FUNCTION guest_runtime.member(_actor uuid, _event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 WITH identity AS MATERIALIZED (SELECT guest_runtime.aliases(_actor) ids)
 SELECT EXISTS(SELECT 1 FROM public.event_participants p CROSS JOIN identity i WHERE p.event_id=_event AND p.user_id=ANY(i.ids))
 AND NOT EXISTS(SELECT 1 FROM public.event_banned_guests b CROSS JOIN identity i WHERE b.event_id=_event AND b.user_id=ANY(i.ids))
$function$;
CREATE OR REPLACE FUNCTION guest_runtime.snapshot(_actor uuid, _event uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 -- ONE SQL statement: coherent counters and desired votes, no credential/PII projections.
 WITH self_identity AS MATERIALIZED (SELECT guest_runtime.actor(_actor) AS canonical_id,guest_runtime.aliases(_actor) AS alias_ids)
 SELECT jsonb_build_object('revision',coalesce((SELECT revision::text FROM guest_runtime.event_revisions WHERE event_id=_event),'0')) || jsonb_build_object('event',jsonb_build_object('id',e.id,'name',e.name,'venue',e.venue,'dj_name',e.dj_name,'is_active',e.is_active,'requests_status',e.requests_status,'ended_at',e.ended_at,'allow_explicit',e.allow_explicit,'require_approval',e.require_approval,'cooldown_seconds',e.cooldown_seconds,'rules_text',e.rules_text),
 'profile',(SELECT jsonb_build_object('id',p.id,'nickname',p.nickname,'points',p.points,'is_public',p.is_public,'is_premium',p.is_premium) FROM public.profiles p WHERE p.id=self_identity.canonical_id),
 'songs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',sr.id,'event_id',sr.event_id,'title',sr.title,'artist',sr.artist,'album_art',guest_runtime.safe_url(sr.album_art),'album_art_url',guest_runtime.safe_url(sr.album_art_url),'status',sr.status,'boost',sr.boost,'upvotes',sr.upvotes,'downvotes',sr.downvotes,'created_at',sr.created_at,'queue_position',sr.queue_position,'requester_name',sr.requester_name,'external_url',guest_runtime.safe_url(sr.external_url),'requested_by',sr.requested_by,'album',sr.album,'duration_ms',sr.duration_ms,'preview_url',guest_runtime.safe_url(sr.preview_url),'source_platform',sr.source_platform,'source_song_id',sr.source_song_id,'explicit',sr.explicit,'played_at',sr.played_at,'played_by_source',sr.played_by_source,'profile_linkable',coalesce((SELECT p.is_public FROM guest_runtime.app_principals a JOIN public.profiles p ON p.id=coalesce(a.merged_into,a.id) WHERE a.id=sr.requested_by),false),'is_mine',sr.requested_by=ANY(self_identity.alias_ids),'my_vote',(SELECT v.value FROM public.votes v WHERE v.song_request_id=sr.id AND v.user_id=ANY(self_identity.alias_ids) LIMIT 1)) ORDER BY sr.created_at,sr.id) FROM (SELECT * FROM public.song_requests WHERE event_id=_event ORDER BY created_at DESC,id LIMIT 500) sr),'[]'::jsonb),
 'now_playing',(SELECT jsonb_build_object('id',n.id,'event_id',n.event_id,'title',n.title,'artist',n.artist,'album_art',guest_runtime.safe_url(n.album_art),'source',n.source,'status',n.status,'updated_at',n.updated_at,'created_at',n.created_at,'source_track_id',n.source_track_id,'now_playing_request_id',n.now_playing_request_id,'started_at',n.started_at,'apple_url',guest_runtime.safe_url(n.apple_url),'spotify_url',n.spotify_url) FROM public.now_playing n WHERE n.event_id=_event),
 'ledger',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount,'type',t.type,'reason',t.reason,'created_at',t.created_at,'event_id',t.event_id,'song_request_id',t.song_request_id) ORDER BY t.created_at DESC,t.id) FROM (SELECT * FROM public.points_transactions WHERE user_id=ANY(self_identity.alias_ids) ORDER BY created_at DESC,id LIMIT 100) t),'[]'::jsonb),
 'truncated',(SELECT count(*)>500 FROM public.song_requests WHERE event_id=_event))
 FROM public.events e CROSS JOIN self_identity WHERE e.id=_event AND (e.dj_id=self_identity.canonical_id OR guest_runtime.member(_actor,_event))
$function$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF (md5(pg_get_functiondef('guest_runtime.aliases(uuid)'::regprocedure)),md5(pg_get_functiondef('guest_runtime.member(uuid,uuid)'::regprocedure)),md5(pg_get_functiondef('guest_runtime.snapshot(uuid,uuid)'::regprocedure)))
  <>('6b4fac919cee58b17435432ffb14deb7','c1dbf1dcc33b557dcbcadae71b03cdb0','c2cda1c3e9bc5e81f3f8b0eb23b3bfbc') THEN RAISE EXCEPTION '012 canonical definition mismatch'; END IF;
 IF has_function_privilege('service_role','guest_runtime.snapshot(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','guest_runtime.aliases(uuid)','EXECUTE')
 OR has_function_privilege('service_role','guest_runtime.member(uuid,uuid)','EXECUTE')
 OR (to_regclass('guest_runtime.capacity_before') IS NOT NULL AND has_table_privilege('service_role','guest_runtime.capacity_before','SELECT')) THEN RAISE EXCEPTION '012 private ACL violated'; END IF;
END $$;
