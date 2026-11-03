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
      and lower(btrim(sr.source_platform)) = _plat
      and btrim(sr.source_song_id) = _sid
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
CREATE OR REPLACE FUNCTION public.request_song(_event_id uuid,_source_platform text,_source_song_id text,_title text,_artist text,_album text DEFAULT NULL,_album_art_url text DEFAULT NULL,_duration_ms integer DEFAULT NULL,_preview_url text DEFAULT NULL,_explicit boolean DEFAULT false,_external_url text DEFAULT NULL)
RETURNS TABLE(outcome text,request_id uuid) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM guest_runtime.request_kernel(auth.uid(),_event_id,_source_platform,_source_song_id,_title,_artist,_album,_album_art_url,_duration_ms,_preview_url,_explicit,_external_url)
$$;
REVOKE ALL ON FUNCTION public.request_song(uuid,text,text,text,text,text,text,integer,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_song(uuid,text,text,text,text,text,text,integer,text,boolean,text) TO authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
