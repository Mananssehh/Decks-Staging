CREATE OR REPLACE FUNCTION public.join_event_by_code(_code text, _nickname text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u uuid := auth.uid(); ev public.events; norm text; nick text;
 denied constant jsonb := '{"ok":false,"reason":"unavailable"}';
 eb integer := 300; gb integer := 10; cfg jsonb; required integer := 4;
 anon_user boolean; ts timestamptz;
BEGIN
 IF u IS NULL THEN RETURN denied; END IF;
 -- Guest mutex serializes attempts across different events; never acquired after an event lock.
 PERFORM pg_advisory_xact_lock(hashtextextended('repair-admission-user:'||u::text,0));
 SELECT is_anonymous INTO anon_user FROM auth.users WHERE id=u;
 IF NOT FOUND THEN RETURN denied; END IF;
 SELECT event_budget,guest_budget INTO eb,gb FROM public.repair_admission_settings WHERE singleton;
 eb := coalesce(eb,300); gb := coalesce(gb,10);
 norm := upper(regexp_replace(coalesce(_code,''),'\s+','','g'));
 SELECT * INTO ev FROM public.events WHERE room_code=norm FOR UPDATE;
 -- Returning members only bypass quota when event and membership remain usable.
 IF ev.id IS NOT NULL AND ev.is_active AND ev.ended_at IS NULL
    AND ev.requests_status IN ('live','paused')
    AND NOT EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=ev.id AND user_id=u)
    AND EXISTS(SELECT 1 FROM public.event_participants WHERE event_id=ev.id AND user_id=u) THEN
   nick := left(coalesce(nullif(btrim(_nickname),''),(SELECT nickname FROM public.profiles WHERE id=u),'Guest'),24);
   UPDATE public.event_participants SET last_seen_at=clock_timestamp(),nickname=nick WHERE event_id=ev.id AND user_id=u;
 ELSE
   ts := clock_timestamp();
   IF (SELECT count(*) FROM public.repair_admission_log WHERE user_id=u AND created_at>ts-interval '10 minutes') >= gb THEN
     RETURN denied;
   END IF;
   -- Invalid/banned/full/limited outcomes are indistinguishable; failures consume guest quota.
   INSERT INTO public.repair_admission_log(user_id) VALUES(u);
   IF norm !~ '^[A-Z0-9]{5,10}$' OR ev.id IS NULL OR NOT ev.is_active OR ev.ended_at IS NOT NULL
      OR ev.requests_status NOT IN ('live','paused')
      OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=ev.id AND user_id=u) THEN RETURN denied; END IF;
   SELECT value INTO cfg FROM public.app_config WHERE key='guest_join_limits';
   IF coalesce(anon_user,false) AND coalesce((cfg->>'enabled')::boolean,true) THEN
     required := coalesce((cfg->>'require_at')::integer,4);
     IF required < 1 THEN RAISE EXCEPTION 'Invalid guest event limit'; END IF;
     IF (SELECT count(DISTINCT event_id) FROM public.event_participants WHERE user_id=u) >= required-1 THEN RETURN denied; END IF;
   END IF;
   IF (SELECT count(*) FROM public.repair_admission_log WHERE event_id=ev.id AND admitted AND created_at>ts-interval '10 minutes') >= eb THEN RETURN denied; END IF;
   nick := left(coalesce(nullif(btrim(_nickname),''),(SELECT nickname FROM public.profiles WHERE id=u),'Guest'),24);
   INSERT INTO public.event_participants(event_id,user_id,nickname) VALUES(ev.id,u,nick);
   UPDATE public.repair_admission_log SET event_id=ev.id,admitted=true WHERE id=currval('public.repair_admission_log_id_seq');
 END IF;
 RETURN jsonb_build_object('ok',true,'event',jsonb_build_object(
 'id',ev.id,'name',ev.name,'venue',ev.venue,'dj_name',ev.dj_name,'room_code',ev.room_code,
 'requests_status',ev.requests_status,'allow_explicit',ev.allow_explicit,'require_approval',ev.require_approval,
 'cooldown_seconds',ev.cooldown_seconds,'rules_text',ev.rules_text));
END $$;
