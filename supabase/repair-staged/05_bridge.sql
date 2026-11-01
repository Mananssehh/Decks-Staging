SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Catalog has UNIQUE(event_id,source_type), NOT UNIQUE(event_id). Reject duplicates in preflight.
CREATE UNIQUE INDEX repair_one_integration_per_event ON public.event_integrations(event_id);
ALTER FUNCTION public.get_ingest_token(uuid) VOLATILE;
CREATE OR REPLACE FUNCTION public.repair_claim_bridge_code(_code text,_ip text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pc public.bridge_pairing_codes; eid uuid; token text; ts timestamptz;
BEGIN
 IF _ip IS NULL OR length(_ip) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid IP key' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('repair-bridge-ip:'||_ip,0));
 ts:=clock_timestamp();
 IF (SELECT count(*) FROM public.bridge_pair_attempts WHERE ip=_ip AND NOT success AND attempted_at>ts-interval '10 minutes')>=10 THEN
 RETURN '{"ok":false,"reason":"rate_limited"}'::jsonb; END IF;
 -- Find event without locking code; event-first also coordinates code generation/rotation and ingest.
 SELECT event_id INTO eid FROM public.bridge_pairing_codes WHERE code=_code;
 PERFORM 1 FROM public.events WHERE id=eid AND is_active AND ended_at IS NULL AND requests_status<>'ended' FOR UPDATE;
 IF NOT FOUND THEN
 INSERT INTO public.bridge_pair_attempts(ip,success) VALUES(_ip,false);
 RETURN '{"ok":false,"reason":"unavailable"}'::jsonb; END IF;
 SELECT * INTO pc FROM public.bridge_pairing_codes WHERE code=_code AND event_id=eid FOR UPDATE;
 IF _code !~ '^[0-9]{6}$' OR pc.id IS NULL OR pc.claimed_at IS NOT NULL OR pc.expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=eid AND dj_id=pc.created_by) THEN
 INSERT INTO public.bridge_pair_attempts(ip,success) VALUES(_ip,false);
 RETURN '{"ok":false,"reason":"unavailable"}'::jsonb; END IF;
 INSERT INTO public.event_integrations(event_id,source_type) VALUES(eid,'bridge')
 ON CONFLICT(event_id) DO UPDATE SET source_type='bridge' RETURNING ingest_token INTO token;
 IF token IS NULL THEN RAISE EXCEPTION 'Integration token missing'; END IF;
 UPDATE public.bridge_pairing_codes SET claimed_at=clock_timestamp(),claimed_ip=_ip
 WHERE id=pc.id AND claimed_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'Claim changed'; END IF;
 INSERT INTO public.bridge_pair_attempts(ip,success) VALUES(_ip,true);
 RETURN jsonb_build_object('ok',true,'event_id',eid,'ingest_token',token);
END $$;
REVOKE ALL ON FUNCTION public.repair_claim_bridge_code(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_claim_bridge_code(text,text) TO service_role;
REVOKE INSERT,UPDATE,DELETE ON public.bridge_pairing_codes,public.bridge_pair_attempts FROM anon,authenticated;
-- Existing owner-scoped token functions lock the event before integration/code writes.
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
  PERFORM 1 FROM public.events WHERE id=_event_id FOR UPDATE;
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
  PERFORM 1 FROM public.events WHERE id=_event_id FOR UPDATE;
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
  PERFORM 1 FROM public.events WHERE id=_event_id FOR UPDATE;
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
