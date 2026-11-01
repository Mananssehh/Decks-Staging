-- SAFE CONTAINMENT ROLLBACK: stops new mutation boundaries, keeps vulnerabilities closed.
-- Run transactionally with application maintenance enabled. Retains evidence/backfill and admission enforcement.
SET LOCAL lock_timeout='5s';
DROP TRIGGER IF EXISTS repair_auth_bootstrap ON auth.users;
CREATE OR REPLACE FUNCTION public.sync_vote_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_id uuid;
begin
  target_id := coalesce(new.song_request_id, old.song_request_id);
  update public.song_requests sr
  set
    upvotes = (select count(*) from public.votes v where v.song_request_id = target_id and v.value = 1),
    downvotes = (select count(*) from public.votes v where v.song_request_id = target_id and v.value = -1)
  where sr.id = target_id;
  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.remove_my_song_request(_song_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _req public.song_requests;
  _earned int := 0;
  _spent int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted RPCs (award_points/boost_request/etc.) set this flag before mutating points
  IF current_setting('app.bypass_profile_guard', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Internal/service contexts (no auth.uid)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- End-user updates: lock sensitive fields
  IF auth.uid() = OLD.id THEN
    NEW.id := OLD.id;
    NEW.points := OLD.points;
    NEW.is_premium := OLD.is_premium;
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.generate_bridge_pairing_code(_event_id uuid)
 RETURNS TABLE(code text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
  _code text;
  _expires timestamptz := now() + interval '5 minutes';
  _attempts int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.events WHERE id = _event_id AND dj_id = _uid) INTO _is_owner;
  IF NOT _is_owner THEN RAISE EXCEPTION 'Not the DJ for this event'; END IF;

  -- Ensure integration row exists
  INSERT INTO public.event_integrations (event_id, source_type)
  SELECT _event_id, 'bridge'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_integrations ei WHERE ei.event_id = _event_id);

  -- Invalidate any prior unclaimed codes for this event
  DELETE FROM public.bridge_pairing_codes bpc
    WHERE bpc.event_id = _event_id AND bpc.claimed_at IS NULL;

  -- Cleanup expired codes globally
  DELETE FROM public.bridge_pairing_codes bpc
    WHERE bpc.expires_at < now() - interval '1 hour';

  LOOP
    _attempts := _attempts + 1;
    _code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    BEGIN
      INSERT INTO public.bridge_pairing_codes (code, event_id, created_by, expires_at)
        VALUES (_code, _event_id, _uid, _expires);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF _attempts > 8 THEN RAISE EXCEPTION 'Could not allocate pairing code'; END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT _code, _expires;
END;
$function$;
CREATE OR REPLACE FUNCTION public.regenerate_ingest_token(_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.events WHERE id = _event_id AND dj_id = _uid) INTO _is_owner;
  IF NOT _is_owner THEN RAISE EXCEPTION 'Not the DJ for this event'; END IF;

  INSERT INTO public.event_integrations (event_id, source_type, ingest_token)
    VALUES (_event_id, 'bridge', encode(extensions.gen_random_bytes(24), 'hex'))
    ON CONFLICT DO NOTHING;

  UPDATE public.event_integrations
    SET ingest_token = encode(extensions.gen_random_bytes(24), 'hex'),
        updated_at = now()
    WHERE event_id = _event_id;

  -- Invalidate all pairing codes for this event
  DELETE FROM public.bridge_pairing_codes WHERE event_id = _event_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_ingest_token(_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_owner boolean;
  _token text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.events WHERE id = _event_id AND dj_id = _uid) INTO _is_owner;
  IF NOT _is_owner THEN
    RAISE EXCEPTION 'Not the DJ for this event';
  END IF;

  SELECT ingest_token INTO _token
  FROM public.event_integrations
  WHERE event_id = _event_id;

  IF _token IS NULL THEN
    INSERT INTO public.event_integrations (event_id, source_type)
    VALUES (_event_id, 'manual')
    ON CONFLICT DO NOTHING;
    SELECT ingest_token INTO _token
    FROM public.event_integrations
    WHERE event_id = _event_id;
  END IF;

  RETURN _token;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_song_vote(uuid,integer),public.dj_transition_request(uuid,uuid,text),
public.dj_set_queue_position(uuid,uuid,double precision),public.repair_write_broadcast(uuid,jsonb,uuid,uuid,text),
public.repair_claim_bridge_code(text,text) FROM PUBLIC,anon,authenticated,service_role;
-- Keep boost disabled, direct writes revoked, private evidence/limiter data intact, email functions no-op.
