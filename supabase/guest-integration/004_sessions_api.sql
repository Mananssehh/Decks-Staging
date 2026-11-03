CREATE TABLE guest_runtime.bootstraps(hash bytea PRIMARY KEY, principal_id uuid NOT NULL UNIQUE REFERENCES guest_runtime.app_principals(id) ON DELETE CASCADE,revoked_at timestamptz);
REVOKE ALL ON guest_runtime.bootstraps FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.bootstraps ENABLE ROW LEVEL SECURITY;
CREATE TABLE guest_runtime.sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),principal_id uuid NOT NULL REFERENCES guest_runtime.app_principals(id) ON DELETE CASCADE,event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,token_hash bytea NOT NULL UNIQUE,expires_at timestamptz NOT NULL DEFAULT now()+interval '12 hours',revoked_at timestamptz,UNIQUE(principal_id,event_id));
REVOKE ALL ON guest_runtime.sessions FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE guest_runtime.operations(principal_id uuid NOT NULL,category text NOT NULL CHECK(category IN ('read','mutation')),at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON guest_runtime.operations FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.operations ENABLE ROW LEVEL SECURITY;
CREATE INDEX guest_operations_bucket ON guest_runtime.operations(principal_id,category,at);
CREATE TABLE guest_runtime.request_keys(principal_id uuid NOT NULL,event_id uuid NOT NULL,key uuid NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,PRIMARY KEY(principal_id,event_id,key));
REVOKE ALL ON guest_runtime.request_keys FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.request_keys ENABLE ROW LEVEL SECURITY;
CREATE TABLE guest_runtime.join_failures(hash bytea NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON guest_runtime.join_failures FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.join_failures ENABLE ROW LEVEL SECURITY;
CREATE INDEX guest_join_failures_bucket ON guest_runtime.join_failures(hash,at);
CREATE FUNCTION guest_runtime.digest(_s text) RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT extensions.digest(_s,'sha256') $$;
CREATE FUNCTION guest_runtime.fail(_status integer,_error text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT jsonb_build_object('ok',false,'status',_status,'error',_error) $$;
CREATE FUNCTION guest_runtime.session_token(_bootstrap text,_event uuid) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(extensions.hmac(convert_to('guest-integration-v1:'||_bootstrap||':'||_event::text,'UTF8'),secret,'sha256'),'hex') FROM guest_runtime.installation WHERE id
$$;
CREATE FUNCTION guest_runtime.validate_session(_event uuid,_token text,_mutating boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s guest_runtime.sessions; ev public.events; u uuid; BEGIN
 IF _token IS NULL OR _token!~'^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 SELECT * INTO s FROM guest_runtime.sessions WHERE event_id=_event AND token_hash=guest_runtime.digest(_token);
 IF s.id IS NULL THEN RETURN NULL; END IF;
 u:=guest_runtime.actor_lock(s.principal_id);
 -- Choose lock strength before any event lock; never upgrade SHARE to UPDATE.
 IF _mutating THEN
  SELECT * INTO ev FROM public.events WHERE id=_event FOR UPDATE;
  SELECT * INTO s FROM guest_runtime.sessions WHERE id=s.id FOR UPDATE;
 ELSE
  SELECT * INTO ev FROM public.events WHERE id=_event FOR SHARE;
  SELECT * INTO s FROM guest_runtime.sessions WHERE id=s.id FOR SHARE;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.installation WHERE id AND enabled AND contract='guest-integration-v1') OR s.revoked_at IS NOT NULL OR s.expires_at<=clock_timestamp() OR u IS DISTINCT FROM s.principal_id OR NOT guest_runtime.member(u,_event) OR ev.id IS NULL OR (_mutating AND (NOT ev.is_active OR ev.ended_at IS NOT NULL OR ev.requests_status NOT IN ('live','paused'))) THEN RETURN NULL; END IF;
 RETURN u;
END $$;
CREATE FUNCTION guest_runtime.budget(_actor uuid,_category text) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE lim integer:=CASE _category WHEN 'read' THEN 120 ELSE 30 END; ts timestamptz:=clock_timestamp(); BEGIN
 -- actor mutex is already held; separate rolling budgets, no IP venue ceiling.
 DELETE FROM guest_runtime.operations WHERE principal_id=_actor AND at<ts-interval '1 minute';
 IF (SELECT count(*) FROM guest_runtime.operations WHERE principal_id=_actor AND category=_category)>=lim THEN RETURN false; END IF;
 INSERT INTO guest_runtime.operations VALUES(_actor,_category,ts); RETURN true;
END $$;
CREATE FUNCTION guest_runtime.profile_kernel(_actor uuid,_nickname text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid:=guest_runtime.actor_lock(_actor); p public.profiles; BEGIN
 IF _nickname IS NOT NULL THEN
  IF NOT guest_runtime.valid_nickname(_nickname) THEN RAISE EXCEPTION 'Invalid nickname' USING ERRCODE='22023'; END IF;
  UPDATE public.profiles SET nickname=btrim(_nickname),updated_at=now() WHERE id=u;
 END IF;
 SELECT * INTO p FROM public.profiles WHERE id=u;
 RETURN jsonb_build_object('id',p.id,'nickname',p.nickname,'points',p.points,'is_public',p.is_public,'is_premium',p.is_premium);
END $$;
CREATE FUNCTION guest_runtime.snapshot(_actor uuid,_event uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 -- ONE SQL statement: coherent counters and desired votes, no credential/PII projections.
 SELECT jsonb_build_object('event',jsonb_build_object('id',e.id,'name',e.name,'venue',e.venue,'dj_name',e.dj_name,'is_active',e.is_active,'requests_status',e.requests_status,'ended_at',e.ended_at,'allow_explicit',e.allow_explicit,'require_approval',e.require_approval,'cooldown_seconds',e.cooldown_seconds,'rules_text',e.rules_text),
 'profile',(SELECT jsonb_build_object('id',p.id,'nickname',p.nickname,'points',p.points) FROM public.profiles p WHERE p.id=guest_runtime.actor(_actor)),
 'songs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',sr.id,'event_id',sr.event_id,'title',sr.title,'artist',sr.artist,'album_art',sr.album_art,'album_art_url',sr.album_art_url,'status',sr.status,'boost',sr.boost,'upvotes',sr.upvotes,'downvotes',sr.downvotes,'created_at',sr.created_at,'queue_position',sr.queue_position,'requester_name',sr.requester_name,'external_url',sr.external_url,'requested_by',sr.requested_by,'album',sr.album,'duration_ms',sr.duration_ms,'preview_url',sr.preview_url,'source_platform',sr.source_platform,'source_song_id',sr.source_song_id,'explicit',sr.explicit,'played_at',sr.played_at,'played_by_source',sr.played_by_source,'is_mine',sr.requested_by=ANY(guest_runtime.aliases(_actor)),'my_vote',(SELECT v.value FROM public.votes v WHERE v.song_request_id=sr.id AND v.user_id=ANY(guest_runtime.aliases(_actor)) LIMIT 1)) ORDER BY sr.created_at,sr.id) FROM (SELECT * FROM public.song_requests WHERE event_id=_event ORDER BY created_at DESC,id LIMIT 500) sr),'[]'::jsonb),
 'now_playing',(SELECT jsonb_build_object('id',n.id,'event_id',n.event_id,'title',n.title,'artist',n.artist,'album_art',n.album_art,'source',n.source,'status',n.status,'updated_at',n.updated_at,'created_at',n.created_at,'source_track_id',n.source_track_id,'now_playing_request_id',n.now_playing_request_id,'started_at',n.started_at,'apple_url',n.apple_url,'spotify_url',n.spotify_url) FROM public.now_playing n WHERE n.event_id=_event),
 'ledger',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount,'type',t.type,'reason',t.reason,'created_at',t.created_at,'event_id',t.event_id,'song_request_id',t.song_request_id) ORDER BY t.created_at DESC,t.id) FROM (SELECT * FROM public.points_transactions WHERE user_id=ANY(guest_runtime.aliases(_actor)) ORDER BY created_at DESC,id LIMIT 100) t),'[]'::jsonb),
 'truncated',(SELECT count(*)>500 FROM public.song_requests WHERE event_id=_event))
 FROM public.events e WHERE e.id=_event AND (e.dj_id=guest_runtime.actor(_actor) OR guest_runtime.member(_actor,_event))
$$;
CREATE FUNCTION public.get_my_event_snapshot(_event_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; e public.events; BEGIN
 IF auth.uid() IS NULL THEN RETURN guest_runtime.fail(403,'forbidden'); END IF;
 u:=guest_runtime.actor_lock(auth.uid());
 SELECT * INTO e FROM public.events WHERE id=_event_id FOR SHARE;
 IF u IS NULL OR e.id IS NULL OR NOT(e.dj_id=u OR guest_runtime.member(u,_event_id)) THEN RETURN guest_runtime.fail(403,'unavailable'); END IF;
 RETURN jsonb_build_object('ok',true,'snapshot',guest_runtime.snapshot(u,_event_id));
END $$;
REVOKE ALL ON FUNCTION public.get_my_event_snapshot(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_event_snapshot(uuid) TO authenticated;
CREATE FUNCTION public.guest_event_api(_action text,_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 IF _action='profile' THEN RETURN jsonb_build_object('ok',true,'profile',guest_runtime.profile_kernel(u,_payload->>'nickname')); END IF;
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
REVOKE ALL ON FUNCTION public.guest_event_api(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_event_api(text,jsonb) TO service_role;
CREATE FUNCTION public.guest_validate_actor(_event_id uuid,_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN guest_runtime.fail(403,'forbidden'); END IF;
 u:=guest_runtime.validate_session(_event_id,_token,true);
 IF u IS NULL THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 RETURN jsonb_build_object('ok',true,'actor_id',u,'alias_ids',guest_runtime.aliases(u),'event_id',_event_id);
END $$;
REVOKE ALL ON FUNCTION public.guest_validate_actor(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guest_validate_actor(uuid,text) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
