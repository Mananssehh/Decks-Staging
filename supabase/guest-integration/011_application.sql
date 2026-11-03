-- SOURCE ONLY: independently review AFTER 010; original 001..010 unchanged.
-- Capture replaced definitions before 011 for exact empty rollback.
CREATE TABLE guest_runtime.application_before(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON guest_runtime.application_before FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.application_before ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.application_before SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc WHERE oid IN ('guest_runtime.request_kernel(uuid,uuid,text,text,text,text,text,text,integer,text,boolean,text)'::regprocedure,'public.guest_event_api(text,jsonb)'::regprocedure,'public.guest_profile_identity_guard()'::regprocedure,'public.prepare_registered_profile_deletion(uuid)'::regprocedure,'guest_runtime.snapshot(uuid,uuid)'::regprocedure);
CREATE TABLE guest_runtime.retired_identities(id uuid PRIMARY KEY,retired_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON guest_runtime.retired_identities FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.retired_identities ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.guest_profile_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' AND (new.id IS DISTINCT FROM old.id OR new.auth_user_id IS DISTINCT FROM old.auth_user_id) THEN RAISE EXCEPTION 'Immutable profile identity' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM guest_runtime.retired_identities WHERE id=new.id) THEN RAISE EXCEPTION 'Retired identity' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=new.id) THEN new.auth_user_id:=new.id;
  ELSIF auth.uid() IS NOT NULL OR auth.role() IN ('anon','authenticated') THEN RAISE EXCEPTION 'Real Auth identity required' USING ERRCODE='42501';
  ELSIF new.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid Auth link' USING ERRCODE='42501'; END IF;
 END IF; RETURN new;
END $$;
-- Add durable evidence in the same retirement transaction, before profile removal.
DO $$ DECLARE d text; p text; BEGIN
 d:=pg_get_functiondef('public.prepare_registered_profile_deletion(uuid)'::regprocedure);
 p:=replace(d,'DELETE FROM public.profiles', 'INSERT INTO guest_runtime.retired_identities(id) VALUES(_id) ON CONFLICT DO NOTHING; DELETE FROM public.profiles');
 IF p=d THEN RAISE EXCEPTION 'Retirement source drift'; END IF; EXECUTE p;
END $$;
CREATE FUNCTION guest_runtime.url_valid(_url text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT _url IS NULL OR _url='' OR (length(_url)<=2048 AND _url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$' AND _url !~ '[[:cntrl:]]') $$;
CREATE FUNCTION guest_runtime.safe_url(_url text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE WHEN guest_runtime.url_valid(_url) THEN nullif(_url,'') ELSE NULL END $$;
-- SOURCE ONLY: canonical reviewed request_song extracted with explicit actor and alias checks.
CREATE OR REPLACE FUNCTION guest_runtime.request_kernel(_actor uuid,_event_id uuid, _source_platform text, _source_song_id text, _title text, _artist text, _album text DEFAULT NULL::text, _album_art_url text DEFAULT NULL::text, _duration_ms integer DEFAULT NULL::integer, _preview_url text DEFAULT NULL::text, _explicit boolean DEFAULT false, _external_url text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, request_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := guest_runtime.actor(_actor);
  _plat text;
  _sid text;
  _title_c text;
  _artist_c text;
  _ev public.events%rowtype;
  _existing public.song_requests%rowtype;
  _vote_value smallint;
  _new_id uuid;
  _nickname text := 'Guest';
  _attempt int := 0;
begin
  _uid:=guest_runtime.actor_lock(_actor);
  if _uid is null then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  IF length(coalesce(_title,''))>200 OR length(coalesce(_artist,''))>200 OR length(coalesce(_album,''))>200 OR length(coalesce(_source_song_id,''))>512 OR length(coalesce(_source_platform,''))>32 OR _duration_ms NOT BETWEEN 0 AND 86400000 OR length(coalesce(_album_art_url,''))>2048 OR length(coalesce(_preview_url,''))>2048 OR length(coalesce(_external_url,''))>2048 THEN RETURN QUERY SELECT 'invalid_track'::text,NULL::uuid; RETURN; END IF;
  IF NOT guest_runtime.url_valid(_external_url) OR NOT guest_runtime.url_valid(_preview_url) OR NOT guest_runtime.url_valid(_album_art_url) THEN RETURN QUERY SELECT 'invalid_track'::text,NULL::uuid; RETURN; END IF;
  -- Provider normalization -------------------------------------------------
  _plat := lower(btrim(coalesce(_source_platform, '')));
  if _plat in ('apple_music', 'itunes') then
    _plat := 'itunes';
  end if;
  _sid := btrim(coalesce(_source_song_id, ''));

  if _plat = 'spotify' then
    if _sid ~ '^[A-Za-z0-9]{22}$' then
      null;
    elsif _sid ~ '^spotify:track:[A-Za-z0-9]{22}$' then
      _sid := substring(_sid from 'spotify:track:([A-Za-z0-9]{22})$');
    elsif _sid ~ '^https?://open\.spotify\.com/track/[A-Za-z0-9]{22}([/?#].*)?$' then
      _sid := substring(_sid from 'track/([A-Za-z0-9]{22})');
    else
      return query select 'invalid_track'::text, null::uuid;
      return;
    end if;
  elsif _plat = 'itunes' then
    if _sid !~ '^[0-9]+$' then
      return query select 'invalid_track'::text, null::uuid;
      return;
    end if;
  elsif _plat = 'manual' then
    _sid := encode(guest_runtime.digest(public.normalize_text(_title)||'|'||public.normalize_text(_artist)),'hex');
  else
    return query select 'invalid_track'::text, null::uuid;
    return;
  end if;

  _title_c := btrim(coalesce(_title, ''));
  _artist_c := btrim(coalesce(_artist, ''));
  if _title_c = '' or _artist_c = '' then
    return query select 'invalid_track'::text, null::uuid;
    return;
  end if;

  -- Event state + authorization -------------------------------------------
  select * into _ev from public.events e where e.id = _event_id for update;
  if not found then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  if _ev.dj_id <> _uid then
    if not exists (
      select 1 from public.event_participants p
      where p.event_id = _event_id and p.user_id = ANY(guest_runtime.aliases(_uid))
    ) or exists (
      select 1 from public.event_banned_guests b
      where b.event_id = _event_id and b.user_id = ANY(guest_runtime.aliases(_uid))
    ) then
      return query select 'unavailable'::text, null::uuid;
      return;
    end if;
  end if;

  -- Every non-usable event state collapses into the SAME generic outcome so the
  -- response never reveals whether an event exists, is ended, paused, inactive,
  -- or simply inaccessible to this caller.
  if not _ev.is_active
     or _ev.ended_at is not null
     or _ev.requests_status <> 'live' then
    return query select 'unavailable'::text, null::uuid;
    return;
  end if;

  if coalesce(_explicit, false) and not _ev.allow_explicit then
    return query select 'explicit_not_allowed'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.event_blocklist bl
    where bl.event_id = _event_id
      and (
        (bl.kind = 'artist' and public.normalize_text(bl.value) = public.normalize_text(_artist_c))
        or (bl.kind = 'song' and public.normalize_text(bl.value) = public.normalize_text(_title_c))
        or (bl.kind = 'keyword' and (
             public.normalize_text(_title_c) like '%' || public.normalize_text(bl.value) || '%'
             or public.normalize_text(_artist_c) like '%' || public.normalize_text(bl.value) || '%'
           ))
      )
  ) then
    return query select 'blocked'::text, null::uuid;
    return;
  end if;

  -- Find-or-create ---------------------------------------------------------
  loop
    _attempt := _attempt + 1;

    select * into _existing
    from public.song_requests sr
    where sr.event_id = _event_id
      and sr.status in ('pending', 'approved', 'playing')
      and ((lower(btrim(sr.source_platform)) = _plat and btrim(sr.source_song_id) = _sid)
       OR (_plat='manual' AND public.normalize_text(sr.title)=public.normalize_text(_title_c) AND public.normalize_text(sr.artist)=public.normalize_text(_artist_c)))
    order by sr.created_at,sr.id
    limit 1
    for update;

    if found then
      SELECT v.value INTO _vote_value FROM public.votes v WHERE v.song_request_id=_existing.id AND v.user_id=ANY(guest_runtime.aliases(_uid)) LIMIT 1;
      PERFORM guest_runtime.vote_kernel(_uid,_existing.id,1);
      RETURN QUERY SELECT CASE WHEN _vote_value=1 THEN 'already_supported' ELSE 'supported_existing' END::text,_existing.id;
      return;
    end if;

    if _attempt = 1 then
      -- Serialize this caller's new-request path for this event, then re-check.
      perform pg_advisory_xact_lock(hashtextextended(_uid::text || ':' || _event_id::text, 0));
      continue;
    end if;

    if _attempt > 4 then
      raise exception 'request_song could not resolve a concurrent duplicate; please retry'
        using errcode = '40001';
    end if;

    if _attempt = 2 then
      -- Cooldown applies only to genuinely new requests.
      if coalesce(_ev.cooldown_seconds, 0) > 0
         and (SELECT count(*) FROM public.song_requests WHERE event_id=_event_id AND requested_by=ANY(guest_runtime.aliases(_uid)) AND created_at>now()-make_interval(secs=>_ev.cooldown_seconds)) > 0 then
        return query select 'cooldown'::text, null::uuid;
        return;
      end if;

      select p.nickname into _nickname from public.profiles p where p.id = _uid;
      _nickname := coalesce(nullif(btrim(coalesce(_nickname, '')), ''), 'Guest');
    end if;

    insert into public.song_requests (
      event_id, requested_by, requester_name, title, artist,
      album, album_art, album_art_url, duration_ms, preview_url,
      explicit, source_platform, source_song_id, external_url
    )
    values (
      _event_id, _uid, _nickname, _title_c, _artist_c,
      _album, _album_art_url, _album_art_url, _duration_ms, _preview_url,
      coalesce(_explicit, false), _plat, _sid,
      nullif(btrim(coalesce(_external_url, '')), '')
    )
    on conflict (event_id, lower(btrim(source_platform)), btrim(source_song_id))
      where status in ('pending', 'approved', 'playing')
        and source_platform is not null
        and btrim(source_platform) <> ''
        and source_song_id is not null
        and btrim(source_song_id) <> ''
    do nothing
    returning id into _new_id;

    if _new_id is not null then
      PERFORM guest_runtime.vote_kernel(_uid,_new_id,1);
      return query select 'created'::text, _new_id;
      return;
    end if;
  end loop;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.guest_event_api(_action text,_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; eid uuid; bs text; tok text; code text; nick text; j jsonb; r jsonb; s guest_runtime.sessions; logical_key uuid; op jsonb; cat text; target uuid; nowts timestamptz:=clock_timestamp(); BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN guest_runtime.fail(403,'forbidden'); END IF;
 IF _action='contract' THEN RETURN (SELECT jsonb_build_object('ok',true,'contract',contract,'enabled',enabled) FROM guest_runtime.installation WHERE id); END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.installation WHERE id AND contract='guest-integration-v1') THEN RETURN guest_runtime.fail(503,'contract_mismatch'); END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.installation WHERE id AND enabled) THEN RETURN guest_runtime.fail(503,'guest_disabled'); END IF;
 IF _payload IS NULL OR jsonb_typeof(_payload)<>'object' OR octet_length(_payload::text)>8192 THEN RETURN guest_runtime.fail(400,'invalid_payload'); END IF;
 IF _action NOT IN ('join','resume','snapshot','request','vote','remove','profile','ledger','report','funnel') THEN RETURN guest_runtime.fail(400,'invalid_action'); END IF;
 IF _action='join' THEN
  bs:=_payload->>'bootstrap'; code:=upper(regexp_replace(coalesce(_payload->>'code',''),'\s+','','g')); nick:=btrim(coalesce(_payload->>'nickname','Guest'));
  IF bs IS NULL OR bs!~'^[0-9a-f]{64}$' OR NOT guest_runtime.valid_nickname(nick) THEN RETURN guest_runtime.fail(400,'invalid_join'); END IF;
  -- Bootstrap lock spans first join retries BEFORE any principal/profile is created.
  PERFORM pg_advisory_xact_lock_shared(8713201,1);
  PERFORM pg_advisory_xact_lock(hashtextextended('guest-bootstrap:'||encode(guest_runtime.digest(bs),'hex'),0));
  DELETE FROM guest_runtime.join_failures WHERE hash=guest_runtime.digest(bs) AND at<nowts-interval '10 minutes';
  IF (SELECT count(*) FROM guest_runtime.join_failures WHERE hash=guest_runtime.digest(bs))>=10 THEN RETURN guest_runtime.fail(429,'join_rate_limited'); END IF;
  SELECT principal_id INTO u FROM guest_runtime.bootstraps WHERE hash=guest_runtime.digest(bs) AND revoked_at IS NULL;
  IF u IS NULL AND EXISTS(SELECT 1 FROM guest_runtime.bootstraps WHERE hash=guest_runtime.digest(bs)) THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
  IF u IS NOT NULL THEN PERFORM guest_runtime.actor_lock(u); END IF;
  -- Validate code and state without creating real app records for invalid codes.
  SELECT id INTO eid FROM public.events WHERE room_code=code AND is_active AND ended_at IS NULL AND requests_status IN ('live','paused');
  IF code!~'^[A-Z0-9]{5,10}$' OR eid IS NULL THEN INSERT INTO guest_runtime.join_failures VALUES(guest_runtime.digest(bs),nowts); RETURN guest_runtime.fail(404,'unavailable'); END IF;
  -- New principal + profile + ledger roll back as a unit on rejected admission.
  BEGIN
   IF u IS NULL THEN
    u:=gen_random_uuid();
    PERFORM guest_runtime.actor_lock(u);
    INSERT INTO public.profiles(id,nickname,points,is_public) VALUES(u,nick,15,false);
    INSERT INTO guest_runtime.app_principals(id,kind) VALUES(u,'guest');
    INSERT INTO guest_runtime.bootstraps VALUES(guest_runtime.digest(bs),u,NULL);
    INSERT INTO public.points_transactions(user_id,amount,type,reason) VALUES(u,15,'earned','Starter points');
   END IF;
   j:=guest_runtime.join_kernel(u,code,nick);
   IF j->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'guest_admission_denied' USING ERRCODE='P0004'; END IF;
   UPDATE public.profiles SET nickname=nick,updated_at=now() WHERE id=u AND nickname IS DISTINCT FROM nick;
   tok:=guest_runtime.session_token(bs,eid);
   INSERT INTO guest_runtime.sessions(principal_id,event_id,token_hash) VALUES(u,eid,guest_runtime.digest(tok)) ON CONFLICT(principal_id,event_id) DO NOTHING;
   SELECT * INTO s FROM guest_runtime.sessions WHERE principal_id=u AND event_id=eid;
   IF s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'guest_admission_denied' USING ERRCODE='P0004'; END IF;
   RETURN jsonb_build_object('ok',true,'principal_id',u,'session_id',s.id,'event_id',eid,'token',tok,'expires_at',s.expires_at,'event',j->'event');
  EXCEPTION WHEN SQLSTATE 'P0004' THEN
   INSERT INTO guest_runtime.join_failures VALUES(guest_runtime.digest(bs),nowts);
   RETURN guest_runtime.fail(403,'unavailable');
  END;
 END IF;
 BEGIN eid:=(_payload->>'event_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN guest_runtime.fail(400,'invalid_event'); END;
 u:=guest_runtime.validate_session(eid,_payload->>'token',_action NOT IN ('resume','snapshot','ledger'));
 IF u IS NULL THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 cat:=CASE WHEN _action IN ('resume','snapshot','ledger') THEN 'read' ELSE 'mutation' END;
 IF NOT guest_runtime.budget(u,cat) THEN RETURN guest_runtime.fail(429,'guest_rate_limited'); END IF;
 IF _action='resume' THEN SELECT * INTO s FROM guest_runtime.sessions WHERE principal_id=u AND event_id=eid; RETURN jsonb_build_object('ok',true,'principal_id',u,'session_id',s.id,'event_id',eid,'expires_at',s.expires_at); END IF;
 IF _action IN ('snapshot','ledger') THEN RETURN jsonb_build_object('ok',true,'snapshot',guest_runtime.snapshot(u,eid)); END IF;
 IF _action='profile' THEN
  IF _payload ? 'is_public' THEN IF jsonb_typeof(_payload->'is_public')<>'boolean' THEN RETURN guest_runtime.fail(400,'invalid_input'); END IF; UPDATE public.profiles SET is_public=(_payload->>'is_public')::boolean WHERE id=u; END IF;
  RETURN jsonb_build_object('ok',true,'profile',guest_runtime.profile_kernel(u,_payload->>'nickname')); END IF;
 IF _action='request' THEN
  logical_key:=(_payload->>'idempotency_key')::uuid; IF logical_key IS NULL THEN RETURN guest_runtime.fail(400,'invalid_key'); END IF;
  op:=_payload-'token';
  SELECT result INTO r FROM guest_runtime.request_keys WHERE principal_id=ANY(guest_runtime.aliases(u)) AND event_id=eid AND guest_runtime.request_keys.key=logical_key LIMIT 1;
  IF r IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM guest_runtime.request_keys WHERE principal_id=ANY(guest_runtime.aliases(u)) AND event_id=eid AND guest_runtime.request_keys.key=logical_key AND payload=op) THEN RETURN guest_runtime.fail(409,'idempotency_mismatch'); END IF;
   RETURN r;
  END IF;
  SELECT jsonb_build_object('ok',outcome IN ('created','supported_existing','already_supported'),'outcome',outcome,'request_id',request_id,'status',CASE WHEN outcome IN ('created','supported_existing','already_supported') THEN 200 ELSE 403 END,'error',outcome) INTO r FROM guest_runtime.request_kernel(u,eid,_payload->>'source_platform',_payload->>'source_song_id',_payload->>'title',_payload->>'artist',_payload->>'album',_payload->>'album_art_url',(_payload->>'duration_ms')::integer,_payload->>'preview_url',coalesce((_payload->>'explicit')::boolean,false),_payload->>'external_url');
  IF r->>'ok'='true' THEN INSERT INTO guest_runtime.request_keys VALUES(u,eid,logical_key,op,r); END IF;
  RETURN r;
 END IF;
 IF _action IN ('vote','remove') THEN
  target:=(_payload->>'request_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.song_requests WHERE id=target AND event_id=eid) THEN RETURN guest_runtime.fail(403,'unavailable'); END IF;
  IF _action='vote' THEN
   IF (_payload->>'value')::integer NOT IN (-1,0,1) OR _payload->>'value' IS NULL THEN RETURN guest_runtime.fail(400,'invalid_vote'); END IF;
   PERFORM guest_runtime.vote_kernel(u,target,nullif((_payload->>'value')::integer,0));
  ELSE PERFORM guest_runtime.remove_kernel(u,target); END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF _action='report' THEN
  target:=(_payload->>'target_id')::uuid;
  IF _payload->>'target_type' NOT IN ('request','user','nickname') OR _payload->>'reason' NOT IN ('inappropriate','harassment','spam','copyright','other') OR length(coalesce(_payload->>'details',''))>500 THEN RETURN guest_runtime.fail(400,'invalid_report'); END IF;
  IF (_payload->>'target_type'='request' AND NOT EXISTS(SELECT 1 FROM public.song_requests WHERE id=target AND event_id=eid)) OR (_payload->>'target_type'<>'request' AND NOT EXISTS(SELECT 1 FROM public.event_participants WHERE user_id=target AND event_id=eid)) THEN RETURN guest_runtime.fail(403,'unavailable'); END IF;
  IF (SELECT count(*) FROM public.reports WHERE reporter_id=ANY(guest_runtime.aliases(u)) AND created_at>now()-interval '1 hour')>=10 THEN RETURN guest_runtime.fail(429,'report_rate_limited'); END IF;
  INSERT INTO public.reports(reporter_id,event_id,target_type,target_id,reason,details) VALUES(u,eid,_payload->>'target_type',target,_payload->>'reason',_payload->>'details');
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF _action='funnel' THEN
  IF _payload->>'event_type' NOT IN ('guest_prompt_shown','guest_prompt_dismissed','guest_prompt_create_clicked','guest_limit_shown','guest_limit_create_clicked','guest_limit_login_clicked','guest_signup_completed') THEN RETURN guest_runtime.fail(400,'invalid_funnel'); END IF;
  -- Never persist arbitrary client metadata; tokens cannot reach analytics.
  INSERT INTO public.guest_funnel_events(user_id,event_id,event_type,metadata) VALUES(u,eid,_payload->>'event_type','{}');
  RETURN jsonb_build_object('ok',true);
 END IF;
 RETURN guest_runtime.fail(400,'invalid_action');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN RETURN guest_runtime.fail(400,'invalid_input');
 WHEN insufficient_privilege THEN RETURN guest_runtime.fail(403,'unavailable');
 WHEN SQLSTATE '22023' THEN RETURN guest_runtime.fail(400,'invalid_input');
END $$;
CREATE FUNCTION public.application_actor_aliases(_actor uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT CASE WHEN auth.role()='service_role' THEN guest_runtime.aliases(_actor) ELSE ARRAY[]::uuid[] END $$;
REVOKE ALL ON FUNCTION public.application_actor_aliases(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.application_actor_aliases(uuid) TO service_role;
