-- SOURCE ONLY. Execute 000 preflight and all 001..007 in ONE transaction.
SET LOCAL lock_timeout='5s';
CREATE SCHEMA guest_runtime;
REVOKE ALL ON SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA guest_runtime REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Protected identity root: only the allowed public profile table links to Auth.
-- Never invent the missing staging profile: root must resolve the 118/117 discrepancy.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM auth.users a LEFT JOIN public.profiles p ON p.id=a.id WHERE p.id IS NULL)
 THEN RAISE EXCEPTION 'Auth without profile: inspect preflight orphan inventory; no automatic profile fabrication'; END IF;
END $$;
ALTER TABLE public.profiles ADD COLUMN auth_user_id uuid;
UPDATE public.profiles SET auth_user_id=id;
ALTER TABLE public.profiles ADD CONSTRAINT guest_profile_auth_fkey FOREIGN KEY(auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT guest_profile_registered_id CHECK(auth_user_id IS NULL OR auth_user_id=id);
ALTER TABLE public.profiles ADD CONSTRAINT guest_profile_identity UNIQUE(id,auth_user_id);
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
CREATE TABLE guest_runtime.app_principals(
 id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE, auth_user_id uuid UNIQUE,
 FOREIGN KEY(id,auth_user_id) REFERENCES public.profiles(id,auth_user_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('auth','guest')), merged_into uuid REFERENCES guest_runtime.app_principals(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((kind='guest' AND auth_user_id IS NULL) OR (kind='auth' AND auth_user_id=id)),
 CHECK(merged_into IS NULL OR (kind='guest' AND merged_into<>id))
);
REVOKE ALL ON guest_runtime.app_principals FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.app_principals ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.app_principals(id,auth_user_id,kind) SELECT id,auth_user_id,'auth' FROM public.profiles;
CREATE TABLE guest_runtime.installation(id boolean PRIMARY KEY DEFAULT true CHECK(id),contract text NOT NULL,enabled boolean NOT NULL DEFAULT false, secret bytea NOT NULL);
REVOKE ALL ON guest_runtime.installation FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.installation ENABLE ROW LEVEL SECURITY;
INSERT INTO guest_runtime.installation VALUES(true,'guest-integration-v1',false,extensions.gen_random_bytes(32));
CREATE TABLE guest_runtime.before_constraints(rel text NOT NULL,name text NOT NULL,definition text NOT NULL,PRIMARY KEY(rel,name));
REVOKE ALL ON guest_runtime.before_constraints FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.before_constraints ENABLE ROW LEVEL SECURITY;
CREATE TABLE guest_runtime.before_functions(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON guest_runtime.before_functions FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.before_functions ENABLE ROW LEVEL SECURITY;
-- Capture ACTUAL installed definitions; before/ source is advisory baseline only.
INSERT INTO guest_runtime.before_functions
 SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('join_event_by_code','request_song','set_song_vote','remove_my_song_request','handle_new_user','award_points','is_event_member','recent_request_count','get_guest_event_count','update_my_profile','followup_reserve_tip','followup_attach_tip_session','followup_apply_financial_event','followup_sync_account','check_tip_cap','dj_transition_request','dj_set_queue_position','repair_write_broadcast');
INSERT INTO guest_runtime.before_constraints
 SELECT 'profiles','profiles_id_fkey','FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE';
-- Replace only discovered exact named guest ownership constraints. Preserve original delete action.
DO $$ DECLARE r record; c record; n integer; action text; BEGIN
 FOR r IN SELECT * FROM (VALUES('song_requests','requested_by'),('votes','user_id'),('dj_tips','user_id'),('guest_funnel_events','user_id')) t(rel,col) LOOP
  SELECT count(*) INTO n FROM pg_constraint con JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1]
   WHERE con.conrelid=('public.'||r.rel)::regclass AND con.contype='f' AND con.confrelid='auth.users'::regclass AND array_length(con.conkey,1)=1 AND a.attname=r.col;
  IF n<>1 THEN RAISE EXCEPTION 'Expected exactly one Auth ownership FK for %.%; got %',r.rel,r.col,n; END IF;
  SELECT con.* INTO c FROM pg_constraint con JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1]
   WHERE con.conrelid=('public.'||r.rel)::regclass AND con.contype='f' AND con.confrelid='auth.users'::regclass AND a.attname=r.col;
  INSERT INTO guest_runtime.before_constraints VALUES(r.rel,c.conname,pg_get_constraintdef(c.oid));
  action:=CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE NULL END;
  IF action IS NULL OR c.confupdtype<>'a' OR c.condeferrable THEN RAISE EXCEPTION 'Unexpected FK action/deferrability: %',c.conname; END IF;
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.rel,c.conname);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(%I) REFERENCES guest_runtime.app_principals(id) ON DELETE %s',r.rel,c.conname,r.col,action);
 END LOOP;
END $$;
CREATE FUNCTION guest_runtime.actor(_actor uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(merged_into,id) FROM guest_runtime.app_principals WHERE id=_actor
$$;
CREATE FUNCTION guest_runtime.aliases(_actor uuid) RETURNS uuid[] LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) FROM guest_runtime.app_principals WHERE id=guest_runtime.actor(_actor) OR merged_into=guest_runtime.actor(_actor)
$$;
-- Every actor path shares claim lock order. No caller acquires this after event locks.
CREATE FUNCTION guest_runtime.actor_lock(_actor uuid) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('guest-identity:'||_actor::text,0));
 u:=guest_runtime.actor(_actor);
 IF u IS NULL THEN RETURN NULL; END IF;
 IF u<>_actor THEN PERFORM pg_advisory_xact_lock(hashtextextended('guest-identity:'||u::text,0)); END IF;
 RETURN u;
END $$;
CREATE FUNCTION guest_runtime.member(_actor uuid,_event uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_participants WHERE event_id=_event AND user_id=ANY(guest_runtime.aliases(_actor)))
 AND NOT EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=_event AND user_id=ANY(guest_runtime.aliases(_actor)))
$$;
CREATE FUNCTION guest_runtime.valid_nickname(_nick text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT _nick IS NOT NULL AND length(btrim(_nick)) BETWEEN 2 AND 24
 AND _nick !~ '[[:cntrl:]]' AND _nick !~* '(.)\1{4,}|https?://|www\.|@[a-z0-9_]{3,}'
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['fuck','shit','bitch','cunt','dick','asshole','bastard','slut','whore','nigger','nigga','faggot','retard','kike','spic','chink','tranny']) w
 WHERE position(w IN regexp_replace(lower(_nick),'[^a-z0-9]+','','g'))>0)
$$;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.profiles(id,auth_user_id,nickname,points) VALUES(new.id,new.id,coalesce(new.raw_user_meta_data->>'nickname','Guest'),15) ON CONFLICT(id) DO NOTHING;
 INSERT INTO guest_runtime.app_principals(id,auth_user_id,kind) VALUES(new.id,new.id,'auth') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.user_roles(user_id,role) VALUES(new.id,'guest') ON CONFLICT DO NOTHING;
 INSERT INTO public.points_transactions(user_id,amount,type,reason) VALUES(new.id,15,'earned','Starter points') ON CONFLICT(user_id) WHERE reason='Starter points' DO NOTHING;
 RETURN new;
END $$;
CREATE OR REPLACE FUNCTION public.is_event_member(_event_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT guest_runtime.member(auth.uid(),_event_id) $$;
CREATE OR REPLACE FUNCTION public.get_guest_event_count() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT count(DISTINCT event_id)::integer FROM public.event_participants WHERE user_id=ANY(guest_runtime.aliases(auth.uid())) $$;
-- Alias-aware awards let historical request triggers continue crediting canonical profiles.
CREATE OR REPLACE FUNCTION public.award_points(_user_id uuid,_event_id uuid,_amount integer,_type public.point_tx_type,_reason text DEFAULT '',_song_request_id uuid DEFAULT NULL,_created_by uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=guest_runtime.actor(_user_id); BEGIN
 IF _amount=0 THEN RETURN; END IF;
 IF u IS NULL THEN RAISE EXCEPTION 'Unknown principal'; END IF;
 UPDATE public.profiles SET points=greatest(0,points+_amount),updated_at=now() WHERE id=u;
 INSERT INTO public.points_transactions(user_id,event_id,song_request_id,amount,type,reason,created_by) VALUES(u,_event_id,_song_request_id,_amount,_type,coalesce(_reason,''),_created_by);
END $$;
REVOKE ALL ON FUNCTION public.award_points(uuid,uuid,integer,public.point_tx_type,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION guest_runtime.vote_kernel(_actor uuid,_request uuid,_value integer) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid; eid uuid; ev public.events; sr public.song_requests; v uuid; BEGIN
 u:=guest_runtime.actor_lock(_actor);
 IF u IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF _value IS NOT NULL AND _value NOT IN (-1,1) THEN RAISE EXCEPTION 'Invalid vote' USING ERRCODE='22023'; END IF;
 SELECT event_id INTO eid FROM public.song_requests WHERE id=_request;
 SELECT * INTO ev FROM public.events WHERE id=eid FOR UPDATE;
 SELECT * INTO sr FROM public.song_requests WHERE id=_request AND event_id=eid FOR UPDATE;
 IF sr.id IS NULL OR NOT ev.is_active OR ev.ended_at IS NOT NULL OR ev.requests_status NOT IN ('live','paused') OR sr.status NOT IN ('pending','approved','playing')
 OR NOT(ev.dj_id=u OR guest_runtime.member(u,eid)) OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=eid AND user_id=ANY(guest_runtime.aliases(u))) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT id INTO v FROM public.votes WHERE song_request_id=_request AND user_id=ANY(guest_runtime.aliases(u)) ORDER BY created_at,id LIMIT 1;
 IF _value IS NULL THEN DELETE FROM public.votes WHERE song_request_id=_request AND user_id=ANY(guest_runtime.aliases(u));
 ELSIF v IS NOT NULL THEN UPDATE public.votes SET value=_value WHERE id=v;
 ELSE INSERT INTO public.votes(song_request_id,user_id,value) VALUES(_request,u,_value); END IF;
END $$;
CREATE OR REPLACE FUNCTION public.set_song_vote(_song_request_id uuid,_value integer DEFAULT NULL) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT guest_runtime.vote_kernel(auth.uid(),_song_request_id,_value) $$;
REVOKE ALL ON FUNCTION public.set_song_vote(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_song_vote(uuid,integer) TO authenticated,service_role;
CREATE FUNCTION guest_runtime.remove_kernel(_actor uuid,_request uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid; r public.song_requests; eid uuid; earned integer; spent integer; bal integer; BEGIN
 u:=guest_runtime.actor_lock(_actor);
 SELECT event_id INTO eid FROM public.song_requests WHERE id=_request;
 PERFORM 1 FROM public.events WHERE id=eid FOR UPDATE;
 SELECT * INTO r FROM public.song_requests WHERE id=_request FOR UPDATE;
 IF u IS NULL OR r.id IS NULL OR r.requested_by IS NULL OR r.requested_by<>ALL(guest_runtime.aliases(u)) OR NOT guest_runtime.member(u,eid) OR r.status<>'pending' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(sum(amount) FILTER(WHERE amount>0),0),coalesce(-sum(amount) FILTER(WHERE amount<0 AND type='spent'),0) INTO earned,spent FROM public.points_transactions WHERE song_request_id=_request AND user_id=ANY(guest_runtime.aliases(u));
 SELECT points INTO bal FROM public.profiles WHERE id=u FOR UPDATE;
 -- Refuse an unexplained historical balance instead of clamping and breaking reconciliation.
 IF earned>bal THEN RAISE EXCEPTION 'Balance review required' USING ERRCODE='22023'; END IF;
 IF earned>0 THEN PERFORM public.award_points(u,eid,-earned,'refunded','Request removed by user',_request,u); END IF;
 IF spent>0 THEN PERFORM public.award_points(u,eid,spent,'refunded','Boost refunded (request removed)',_request,u); END IF;
 UPDATE public.song_requests SET status='removed' WHERE id=_request;
END $$;
CREATE OR REPLACE FUNCTION public.remove_my_song_request(_song_request_id uuid) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT guest_runtime.remove_kernel(auth.uid(),_song_request_id) $$;
REVOKE ALL ON FUNCTION public.remove_my_song_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_my_song_request(uuid) TO authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
