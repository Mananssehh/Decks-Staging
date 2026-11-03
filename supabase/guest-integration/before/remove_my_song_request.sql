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

