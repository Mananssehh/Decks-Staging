SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Preflight rejects pre-existing multiple playing rows; do not destroy that evidence.
CREATE UNIQUE INDEX repair_one_playing_per_event ON public.song_requests(event_id) WHERE status='playing';
CREATE OR REPLACE FUNCTION public.dj_set_queue_position(_event_id uuid,_song_request_id uuid,_position double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.events;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=_event_id FOR UPDATE;
 IF auth.uid() IS NULL OR ev.dj_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _position IS NULL OR _position IN ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision) THEN RAISE EXCEPTION 'Invalid position' USING ERRCODE='22023'; END IF;
 UPDATE public.song_requests SET queue_position=_position WHERE id=_song_request_id AND event_id=ev.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.dj_set_queue_position(uuid,uuid,double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dj_set_queue_position(uuid,uuid,double precision) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.dj_transition_request(_event_id uuid,_song_request_id uuid,_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.events; sr public.song_requests;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=_event_id FOR UPDATE;
 IF auth.uid() IS NULL OR ev.dj_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _status NOT IN ('playing','played','skipped','approved','removed','pending') OR _status IS NULL THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 -- All competing transitions own the event before taking any request tuples.
 PERFORM id FROM public.song_requests WHERE event_id=ev.id AND (id=_song_request_id OR status='playing') ORDER BY id FOR UPDATE;
 SELECT * INTO sr FROM public.song_requests WHERE id=_song_request_id AND event_id=ev.id;
 IF sr.id IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _status='playing' THEN
   IF NOT ev.is_active OR ev.ended_at IS NOT NULL OR ev.requests_status='ended'
   OR sr.status NOT IN ('pending','approved','playing') THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
   UPDATE public.song_requests SET status='played',played_at=coalesce(played_at,clock_timestamp()),played_by_source='manual_dj'
   WHERE event_id=ev.id AND status='playing' AND id<>sr.id;
 END IF;
 UPDATE public.song_requests SET status=_status::public.request_status,
 played_at=CASE WHEN _status='played' THEN coalesce(played_at,clock_timestamp()) ELSE played_at END,
 played_by_source=CASE WHEN _status='played' THEN 'manual_dj' ELSE played_by_source END WHERE id=sr.id;
 IF _status='playing' THEN
   INSERT INTO public.now_playing(event_id,title,artist,album_art,apple_url,spotify_url,source,status,started_at,now_playing_request_id,source_track_id)
   VALUES(ev.id,sr.title,sr.artist,coalesce(sr.album_art,sr.album_art_url),
    CASE WHEN sr.source_platform IN ('itunes','apple_music') THEN sr.external_url END,
    CASE WHEN sr.source_platform='spotify' THEN sr.external_url END,'manual_dj','playing',clock_timestamp(),sr.id,sr.source_song_id)
   ON CONFLICT(event_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album_art=excluded.album_art,
    apple_url=excluded.apple_url,spotify_url=excluded.spotify_url,source=excluded.source,status=excluded.status,
    started_at=CASE WHEN public.now_playing.now_playing_request_id=sr.id AND public.now_playing.status='playing' THEN public.now_playing.started_at ELSE excluded.started_at END,
    now_playing_request_id=excluded.now_playing_request_id,source_track_id=excluded.source_track_id,updated_at=clock_timestamp();
 ELSE
   UPDATE public.now_playing SET status='paused',now_playing_request_id=NULL,updated_at=clock_timestamp()
   WHERE event_id=ev.id AND now_playing_request_id=sr.id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.dj_transition_request(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dj_transition_request(uuid,uuid,text) TO authenticated,service_role;
REVOKE INSERT,UPDATE,DELETE ON public.now_playing FROM anon,authenticated;
-- Shared event mutex for manual broadcast and bridge ingest. JSON accepted fields are explicitly validated.
CREATE OR REPLACE FUNCTION public.repair_write_broadcast(_event_id uuid,_row jsonb,_request_id uuid DEFAULT NULL,_integration_id uuid DEFAULT NULL,_token text DEFAULT NULL)
RETURNS public.now_playing LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.events; np public.now_playing; sr public.song_requests; service boolean;
BEGIN
 service := coalesce(current_setting('request.jwt.claim.role',true),'')='service_role' OR
   coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role';
 SELECT * INTO ev FROM public.events WHERE id=_event_id FOR UPDATE;
 IF ev.id IS NULL OR NOT ev.is_active OR ev.ended_at IS NOT NULL OR ev.requests_status='ended' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _integration_id IS NULL THEN
   IF auth.uid() IS NULL OR ev.dj_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 ELSE
   IF NOT service OR NOT EXISTS(SELECT 1 FROM public.event_integrations WHERE id=_integration_id AND event_id=ev.id AND ingest_token=_token) THEN
     RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF jsonb_typeof(_row)<>'object' OR coalesce(length(btrim(_row->>'title')),0) NOT BETWEEN 1 AND 300
 OR coalesce(length(_row->>'artist'),0)>300 OR coalesce(_row->>'status','playing') NOT IN ('playing','mixing','paused')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(_row) k WHERE k NOT IN ('title','artist','album_art','apple_url','spotify_url','source','source_track_id','status','started_at')) THEN
 RAISE EXCEPTION 'Invalid broadcast' USING ERRCODE='22023'; END IF;
 -- Broadcast-only edits retire any manual playing selection so the two views cannot disagree.
 UPDATE public.song_requests SET status='played',played_at=coalesce(played_at,clock_timestamp()),
 played_by_source=CASE WHEN _integration_id IS NULL THEN 'manual_dj' ELSE 'decks_bridge' END WHERE event_id=ev.id AND status='playing';
 IF _request_id IS NOT NULL THEN
   SELECT * INTO sr FROM public.song_requests WHERE id=_request_id AND event_id=ev.id FOR UPDATE;
   IF sr.id IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
   IF sr.status IN ('pending','approved') THEN
     UPDATE public.song_requests SET status='played',played_at=coalesce(played_at,clock_timestamp()),played_by_source='decks_bridge' WHERE id=sr.id;
   END IF;
 END IF;
 INSERT INTO public.now_playing(event_id,title,artist,album_art,apple_url,spotify_url,source,status,started_at,source_track_id,now_playing_request_id)
 VALUES(ev.id,btrim(_row->>'title'),_row->>'artist',_row->>'album_art',_row->>'apple_url',_row->>'spotify_url',
 coalesce(_row->>'source','manual'),coalesce(_row->>'status','playing'),coalesce((_row->>'started_at')::timestamptz,clock_timestamp()),_row->>'source_track_id',sr.id)
 ON CONFLICT(event_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album_art=excluded.album_art,
 apple_url=excluded.apple_url,spotify_url=excluded.spotify_url,source=excluded.source,status=excluded.status,
 started_at=excluded.started_at,source_track_id=excluded.source_track_id,now_playing_request_id=excluded.now_playing_request_id,updated_at=clock_timestamp()
 RETURNING * INTO np;
 IF _integration_id IS NOT NULL THEN UPDATE public.event_integrations SET last_seen_at=clock_timestamp() WHERE id=_integration_id; END IF;
 RETURN np;
END $$;
REVOKE ALL ON FUNCTION public.repair_write_broadcast(uuid,jsonb,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_write_broadcast(uuid,jsonb,uuid,uuid,text) TO authenticated,service_role;
