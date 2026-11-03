-- SOURCE ONLY candidate. Root independently reviews and installs AFTER 011 in ONE transaction:
--   psql -v ON_ERROR_STOP=1 -1 -f 012_capacity.sql      rollback: 912_rollback_capacity.sql
-- Cause (hosted 2026-11-03 06:11-06:15 UTC, see CAPACITY_012.md): guest_runtime.aliases() is not
-- inlinable (SET search_path) and filtered app_principals with `id=actor(x) OR merged_into=actor(x)`
-- without a merged_into index, so each call seq-scanned every principal and re-ran actor() per row.
-- snapshot() called it twice per song (149 songs x 293 principals ~= 1.5 s) while holding the event
-- row FOR SHARE; FOR UPDATE writers then convoyed on the event tuple until the 8 s statement_timeout.
-- This file changes ONLY two read-only STABLE guest_runtime functions and adds one index. Results are
-- identical (proved by test/capacity.ts against the installed definitions). Lock order, lock strength,
-- writer kernels, claim exclusion, ACLs and the DTO are unchanged. No public object is touched.
DO $$ BEGIN
 IF to_regclass('guest_runtime.application_before') IS NULL THEN RAISE EXCEPTION '012 requires installed 011'; END IF;
 IF to_regclass('guest_runtime.capacity_before') IS NOT NULL THEN RAISE EXCEPTION '012 already installed'; END IF;
 -- Refuse drift: accept only the original installed pair OR the exact independently observed root pair.
 -- Read-only catalog capture on 2026-11-03 found root's materialized helpers already present, with no
 -- capacity_before table. Do not undo that snapshot on rollback; capture whichever exact pair is installed.
 IF NOT ((md5(pg_get_functiondef('guest_runtime.aliases(uuid)'::regprocedure))='b2a235743d0e527c513321fc366cdbd7'
 AND md5(pg_get_functiondef('guest_runtime.snapshot(uuid,uuid)'::regprocedure))='83fa330df2eb0ed192c4eeeabe20d0c0')
 OR (md5(pg_get_functiondef('guest_runtime.aliases(uuid)'::regprocedure))='6b4fac919cee58b17435432ffb14deb7'
 AND md5(pg_get_functiondef('guest_runtime.snapshot(uuid,uuid)'::regprocedure))='c2cda1c3e9bc5e81f3f8b0eb23b3bfbc'))
 THEN RAISE EXCEPTION 'Unexpected installed aliases/snapshot definition; inspect before 012'; END IF;
END $$;
CREATE TABLE guest_runtime.capacity_before(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON guest_runtime.capacity_before FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.capacity_before ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.capacity_before SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc
 WHERE oid IN('guest_runtime.aliases(uuid)'::regprocedure,'guest_runtime.snapshot(uuid,uuid)'::regprocedure);
-- Alias lookup by canonical principal becomes an index probe (small table; brief SHARE lock).
CREATE INDEX guest_principals_merged_into ON guest_runtime.app_principals(merged_into) WHERE merged_into IS NOT NULL;
-- Same set as before: rows with id=actor(_actor) OR merged_into=actor(_actor), ordered by id.
-- actor(_actor) is inlined as coalesce(c.merged_into,c.id) of the single row c.id=_actor; unknown actor -> '{}'.
CREATE OR REPLACE FUNCTION guest_runtime.aliases(_actor uuid) RETURNS uuid[] LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(s.id ORDER BY s.id),ARRAY[]::uuid[]) FROM (
  SELECT p.id FROM guest_runtime.app_principals c JOIN guest_runtime.app_principals p ON p.id=coalesce(c.merged_into,c.id) WHERE c.id=_actor
  UNION
  SELECT p.id FROM guest_runtime.app_principals c JOIN guest_runtime.app_principals p ON p.merged_into=coalesce(c.merged_into,c.id) WHERE c.id=_actor
 ) s
$$;
-- Still ONE SQL statement (one MVCC snapshot). The actor/alias set is computed ONCE (MATERIALIZED, so the
-- planner cannot substitute the calls back per row) instead of twice per song; profile_linkable uses a join
-- equivalent to (SELECT is_public FROM profiles WHERE id=actor(requested_by)). Projection is unchanged.
CREATE OR REPLACE FUNCTION guest_runtime.snapshot(_actor uuid,_event uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 -- ONE SQL statement: coherent counters and desired votes, no credential/PII projections.
 WITH self_identity AS MATERIALIZED (SELECT guest_runtime.actor(_actor) AS canonical_id,guest_runtime.aliases(_actor) AS alias_ids)
 SELECT jsonb_build_object('revision',coalesce((SELECT revision::text FROM guest_runtime.event_revisions WHERE event_id=_event),'0')) || jsonb_build_object('event',jsonb_build_object('id',e.id,'name',e.name,'venue',e.venue,'dj_name',e.dj_name,'is_active',e.is_active,'requests_status',e.requests_status,'ended_at',e.ended_at,'allow_explicit',e.allow_explicit,'require_approval',e.require_approval,'cooldown_seconds',e.cooldown_seconds,'rules_text',e.rules_text),
 'profile',(SELECT jsonb_build_object('id',p.id,'nickname',p.nickname,'points',p.points,'is_public',p.is_public,'is_premium',p.is_premium) FROM public.profiles p WHERE p.id=self_identity.canonical_id),
 'songs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',sr.id,'event_id',sr.event_id,'title',sr.title,'artist',sr.artist,'album_art',guest_runtime.safe_url(sr.album_art),'album_art_url',guest_runtime.safe_url(sr.album_art_url),'status',sr.status,'boost',sr.boost,'upvotes',sr.upvotes,'downvotes',sr.downvotes,'created_at',sr.created_at,'queue_position',sr.queue_position,'requester_name',sr.requester_name,'external_url',guest_runtime.safe_url(sr.external_url),'requested_by',sr.requested_by,'album',sr.album,'duration_ms',sr.duration_ms,'preview_url',guest_runtime.safe_url(sr.preview_url),'source_platform',sr.source_platform,'source_song_id',sr.source_song_id,'explicit',sr.explicit,'played_at',sr.played_at,'played_by_source',sr.played_by_source,'profile_linkable',coalesce((SELECT p.is_public FROM guest_runtime.app_principals a JOIN public.profiles p ON p.id=coalesce(a.merged_into,a.id) WHERE a.id=sr.requested_by),false),'is_mine',sr.requested_by=ANY(self_identity.alias_ids),'my_vote',(SELECT v.value FROM public.votes v WHERE v.song_request_id=sr.id AND v.user_id=ANY(self_identity.alias_ids) LIMIT 1)) ORDER BY sr.created_at,sr.id) FROM (SELECT * FROM public.song_requests WHERE event_id=_event ORDER BY created_at DESC,id LIMIT 500) sr),'[]'::jsonb),
 'now_playing',(SELECT jsonb_build_object('id',n.id,'event_id',n.event_id,'title',n.title,'artist',n.artist,'album_art',guest_runtime.safe_url(n.album_art),'source',n.source,'status',n.status,'updated_at',n.updated_at,'created_at',n.created_at,'source_track_id',n.source_track_id,'now_playing_request_id',n.now_playing_request_id,'started_at',n.started_at,'apple_url',guest_runtime.safe_url(n.apple_url),'spotify_url',n.spotify_url) FROM public.now_playing n WHERE n.event_id=_event),
 'ledger',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount,'type',t.type,'reason',t.reason,'created_at',t.created_at,'event_id',t.event_id,'song_request_id',t.song_request_id) ORDER BY t.created_at DESC,t.id) FROM (SELECT * FROM public.points_transactions WHERE user_id=ANY(self_identity.alias_ids) ORDER BY created_at DESC,id LIMIT 100) t),'[]'::jsonb),
 'truncated',(SELECT count(*)>500 FROM public.song_requests WHERE event_id=_event))
 FROM public.events e CROSS JOIN self_identity WHERE e.id=_event AND (e.dj_id=self_identity.canonical_id OR guest_runtime.member(_actor,_event))
$$;
-- CREATE OR REPLACE keeps ACLs; re-assert the private-schema contract anyway.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF has_function_privilege('service_role','guest_runtime.snapshot(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','guest_runtime.aliases(uuid)','EXECUTE')
 OR has_table_privilege('service_role','guest_runtime.capacity_before','SELECT') THEN RAISE EXCEPTION '012 private ACL violated'; END IF;
END $$;
