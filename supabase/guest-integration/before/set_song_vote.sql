CREATE OR REPLACE FUNCTION public.set_song_vote(_song_request_id uuid,_value integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); eid uuid; ev public.events; sr public.song_requests;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _value IS NOT NULL AND _value NOT IN (-1,1) THEN RAISE EXCEPTION 'Invalid vote' USING ERRCODE='22023'; END IF;
 SELECT event_id INTO eid FROM public.song_requests WHERE id=_song_request_id;
 SELECT * INTO ev FROM public.events WHERE id=eid FOR UPDATE;
 SELECT * INTO sr FROM public.song_requests WHERE id=_song_request_id AND event_id=eid FOR UPDATE;
 -- Paused events allow voting (existing app contract); ended/inactive events do not.
 IF sr.id IS NULL OR NOT ev.is_active OR ev.ended_at IS NOT NULL OR ev.requests_status NOT IN ('live','paused')
 OR sr.status NOT IN ('pending','approved','playing')
 OR NOT (public.is_event_owner(eid) OR public.is_event_member(eid))
 OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=eid AND user_id=u) THEN
 RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _value IS NULL THEN DELETE FROM public.votes WHERE song_request_id=sr.id AND user_id=u;
 ELSE INSERT INTO public.votes(song_request_id,user_id,value) VALUES(sr.id,u,_value)
 ON CONFLICT(song_request_id,user_id) DO UPDATE SET value=excluded.value; END IF;
END $$;
