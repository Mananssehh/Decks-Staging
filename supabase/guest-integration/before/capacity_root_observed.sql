-- REFERENCE ONLY, NEVER an install script. Exact hosted staging pg_get_functiondef text (reviewer-committed
-- 2026-11-03: snapshot 06:33:40 UTC, aliases/member 06:45:05 UTC). md5: aliases 6b4fac91..., member c1dbf1dc..., snapshot c2cda1c3...
-- guest_runtime.aliases(uuid)
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
-- guest_runtime.member(uuid,uuid)
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
-- guest_runtime.snapshot(uuid,uuid)
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
