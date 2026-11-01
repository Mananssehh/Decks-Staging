SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- No tuple may be acquired by a browser before the event mutex.
REVOKE INSERT,UPDATE,DELETE ON public.votes FROM anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.song_requests FROM anon,authenticated;
GRANT UPDATE(queue_position) ON public.song_requests TO authenticated;
DROP POLICY IF EXISTS "Users can soft-remove their own pending requests" ON public.song_requests;
DROP POLICY IF EXISTS "Users can delete their own pending requests" ON public.song_requests;
CREATE OR REPLACE FUNCTION public.repair_vote_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.song_request_id IS DISTINCT FROM OLD.song_request_id
 OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
 RAISE EXCEPTION 'Vote identity is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP<>'DELETE' AND NEW.value NOT IN (-1,1) THEN RAISE EXCEPTION 'Invalid vote' USING ERRCODE='22023'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER repair_vote_identity BEFORE UPDATE OR INSERT ON public.votes FOR EACH ROW EXECUTE FUNCTION public.repair_vote_identity_guard();
-- Delta arithmetic avoids snapshot-dependent recounts. Event-first RPCs serialize vote writes.
CREATE OR REPLACE FUNCTION public.sync_vote_counts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid; du integer:=0; dd integer:=0;
BEGIN
 IF TG_OP<>'INSERT' THEN target:=OLD.song_request_id; du:=du-CASE WHEN OLD.value=1 THEN 1 ELSE 0 END; dd:=dd-CASE WHEN OLD.value=-1 THEN 1 ELSE 0 END; END IF;
 IF TG_OP<>'DELETE' THEN target:=NEW.song_request_id; du:=du+CASE WHEN NEW.value=1 THEN 1 ELSE 0 END; dd:=dd+CASE WHEN NEW.value=-1 THEN 1 ELSE 0 END; END IF;
 UPDATE public.song_requests SET upvotes=upvotes+du,downvotes=downvotes+dd WHERE id=target;
 RETURN NULL;
END $$;
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
REVOKE ALL ON FUNCTION public.set_song_vote(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_song_vote(uuid,integer) TO authenticated,service_role;
-- Harden direct DJ queue writes and alternate point/counter writes; trust executor, not a client-set GUC.
CREATE OR REPLACE FUNCTION public.repair_request_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
   IF TG_OP='DELETE' OR TG_OP='INSERT' THEN RAISE EXCEPTION 'Use request RPC' USING ERRCODE='42501'; END IF;
   IF (to_jsonb(NEW)-'queue_position') IS DISTINCT FROM (to_jsonb(OLD)-'queue_position') THEN
     RAISE EXCEPTION 'Use transition RPC' USING ERRCODE='42501'; END IF;
   IF NOT public.is_event_owner(OLD.event_id) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER repair_request_write BEFORE INSERT OR UPDATE OR DELETE ON public.song_requests FOR EACH ROW EXECUTE FUNCTION public.repair_request_write_guard();
-- Save evidence before fixing cached totals. No historical vote/ledger row is altered.
CREATE TABLE public.repair_counter_evidence(id uuid PRIMARY KEY, old_upvotes integer,old_downvotes integer,
 actual_upvotes integer,actual_downvotes integer,captured_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.repair_counter_evidence TO service_role;
ALTER TABLE public.repair_counter_evidence ENABLE ROW LEVEL SECURITY;
-- Lock relation in canonical order before touching rows; no vote writer can enter while repair runs.
LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.song_requests IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.votes IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.repair_counter_evidence
 SELECT sr.id,sr.upvotes,sr.downvotes,count(v.id) FILTER(WHERE v.value=1),count(v.id) FILTER(WHERE v.value=-1),now()
 FROM public.song_requests sr LEFT JOIN public.votes v ON v.song_request_id=sr.id GROUP BY sr.id;
UPDATE public.song_requests sr SET upvotes=e.actual_upvotes,downvotes=e.actual_downvotes FROM public.repair_counter_evidence e WHERE sr.id=e.id;
CREATE OR REPLACE FUNCTION public.boost_request(_song_request_id uuid,_amount integer)
RETURNS public.song_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Boosts are paused' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.boost_request(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.boost_request(uuid,integer) TO service_role;

-- Existing refund semantics preserved; lock event before request/profile.
CREATE OR REPLACE FUNCTION public.remove_my_song_request(_song_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _req public.song_requests;
  _eid uuid;
  _earned int := 0;
  _spent int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT event_id INTO _eid FROM public.song_requests WHERE id = _song_request_id;
  PERFORM 1 FROM public.events WHERE id=_eid FOR UPDATE;
  SELECT * INTO _req FROM public.song_requests WHERE id = _song_request_id FOR UPDATE;
  IF _req.id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF _req.requested_by IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'You can only remove your own requests';
  END IF;

  IF _req.status <> 'pending'::request_status THEN
    RAISE EXCEPTION 'This request can''t be removed anymore';
  END IF;

  -- Refund positive earnings tied to this request
  SELECT COALESCE(SUM(pt.amount), 0) INTO _earned
  FROM public.points_transactions pt
  WHERE pt.song_request_id = _song_request_id
    AND pt.user_id = _uid
    AND pt.amount > 0;

  IF _earned > 0 THEN
    PERFORM public.award_points(
      _uid, _req.event_id, -_earned,
      'refunded'::public.point_tx_type,
      'Request removed by user',
      _song_request_id, _uid
    );
  END IF;

  -- Refund boost spend (negative transactions tied to this request)
  SELECT COALESCE(-SUM(pt.amount), 0) INTO _spent
  FROM public.points_transactions pt
  WHERE pt.song_request_id = _song_request_id
    AND pt.user_id = _uid
    AND pt.amount < 0
    AND pt.type = 'spent';

  IF _spent > 0 THEN
    PERFORM public.award_points(
      _uid, _req.event_id, _spent,
      'refunded'::public.point_tx_type,
      'Boost refunded (request removed)',
      _song_request_id, _uid
    );
  END IF;

  -- Soft-delete: keep row so cooldown still applies
  UPDATE public.song_requests
    SET status = 'removed'::request_status
    WHERE id = _song_request_id;
END;
$function$;
