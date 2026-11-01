SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.followup_tip_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, request_key uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES public.events(id), tip_id uuid NOT NULL UNIQUE REFERENCES public.dj_tips(id),
 amount_cents integer NOT NULL, consent_version text NOT NULL,
 checkout_parameters jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 retry_until timestamptz NOT NULL DEFAULT now()+interval '23 hours',
 session_id text UNIQUE, session_url text, state text NOT NULL DEFAULT 'reserved',
 UNIQUE(user_id,request_key), CHECK(state IN ('reserved','attached','ambiguous','succeeded','failed','expired','review'))
);
GRANT SELECT ON public.followup_tip_reservations TO service_role;
REVOKE ALL ON public.followup_tip_reservations FROM PUBLIC,anon,authenticated;
ALTER TABLE public.followup_tip_reservations ENABLE ROW LEVEL SECURITY;
CREATE INDEX followup_reservations_user_state ON public.followup_tip_reservations(user_id,state);

-- Internal, authenticated identity comes from verified Edge getUser, never request.user_id.
-- The user mutex serializes every reservation and lifecycle writer before tip row locks.
CREATE FUNCTION public.followup_reserve_tip(_user_id uuid,_request_key uuid,_event_id uuid,_amount_cents integer,_song_request_id uuid DEFAULT NULL,_origin text DEFAULT NULL)
RETURNS public.followup_tip_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.followup_tip_reservations; e public.events; p public.dj_payout_accounts;
 s public.song_requests; t uuid:=gen_random_uuid(); fee integer; day_spend bigint; event_spend bigint;
 nick text; params jsonb; current_consent constant text:='v2-tips-2026-06-12';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF _user_id IS NULL OR _request_key IS NULL OR _event_id IS NULL OR _amount_cents IS NULL OR _amount_cents<100 OR _amount_cents>5000 THEN RAISE EXCEPTION 'Invalid tip' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||_user_id::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE user_id=_user_id AND request_key=_request_key FOR UPDATE;
 IF FOUND THEN
  IF r.event_id<>_event_id OR r.amount_cents<>_amount_cents OR r.checkout_parameters->>'song_request_id' IS DISTINCT FROM _song_request_id::text THEN RAISE EXCEPTION 'Idempotency key payload mismatch' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_participants WHERE event_id=r.event_id AND user_id=_user_id) OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=r.event_id AND user_id=_user_id) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
  RETURN r;
 END IF;
 SELECT * INTO e FROM public.events WHERE id=_event_id;
 IF e.id IS NULL OR NOT e.is_active OR e.requests_status='ended' OR e.ended_at IS NOT NULL OR e.dj_id=_user_id THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_participants WHERE event_id=e.id AND user_id=_user_id)
 OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=e.id AND user_id=_user_id) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.purchase_consents WHERE user_id=_user_id AND version=current_consent) THEN RAISE EXCEPTION 'Current consent required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.dj_payout_accounts WHERE user_id=e.dj_id;
 IF p.user_id IS NULL OR NOT p.charges_enabled OR NOT p.payouts_enabled THEN RAISE EXCEPTION 'DJ payouts unavailable'; END IF;
 IF _song_request_id IS NOT NULL THEN SELECT * INTO s FROM public.song_requests WHERE id=_song_request_id AND event_id=e.id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Invalid song request'; END IF; END IF;
 -- Reserved/ambiguous are never aged out by elapsed time: a checkout may exist or be paid.
 -- All reservation-backed pending remains counted until signed/retrieved terminal evidence.
 -- Existing unreserved pending follows the original cap oracle. No price/cap changes.
 SELECT coalesce(sum(d.gross_amount_cents),0) INTO day_spend FROM public.dj_tips d
 WHERE d.user_id=_user_id AND ((d.status='succeeded' AND d.created_at>now()-interval '24 hours')
 OR (d.status='pending' AND (true)));
 SELECT coalesce(sum(d.gross_amount_cents),0) INTO event_spend FROM public.dj_tips d
 WHERE d.user_id=_user_id AND d.event_id=e.id AND (d.status='succeeded'
 OR (d.status='pending' AND (true)));
 IF day_spend+_amount_cents>10000 OR event_spend+_amount_cents>10000 THEN RAISE EXCEPTION 'Tip limit reached' USING ERRCODE='22023'; END IF;
 IF _origin IS NULL OR _origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' THEN RAISE EXCEPTION 'Invalid APP_ORIGIN'; END IF;
 fee:=floor(_amount_cents*3000::numeric/10000)::integer;
 SELECT nickname INTO nick FROM public.profiles WHERE id=_user_id;
 params:=jsonb_build_object('event_name',e.name,'dj_name',e.dj_name,'room_code',e.room_code,'destination',p.stripe_account_id,'livemode',p.livemode,
 'success_url',_origin||'/event/'||e.room_code||'?tip=success','cancel_url',_origin||'/event/'||e.room_code||'?tip=cancel',
 'fee',fee,'song_request_id',s.id,'song_title',s.title,'artist',s.artist,'guest_nickname',nick,
 'expires_at',floor(extract(epoch FROM now()+interval '35 minutes'))::bigint);
 INSERT INTO public.dj_tips(id,user_id,dj_id,event_id,gross_amount_cents,platform_fee_cents,net_amount_cents,status,
 stripe_destination_account,livemode,song_request_id,song_title,artist,guest_nickname,checkout_expires_at)
 VALUES(t,_user_id,e.dj_id,e.id,_amount_cents,fee,_amount_cents-fee,'pending',p.stripe_account_id,p.livemode,s.id,s.title,s.artist,nick,NULL);
 INSERT INTO public.followup_tip_reservations(user_id,request_key,event_id,tip_id,amount_cents,consent_version,checkout_parameters)
 VALUES(_user_id,_request_key,e.id,t,_amount_cents,current_consent,params) RETURNING * INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.followup_reserve_tip(uuid,uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.followup_reserve_tip(uuid,uuid,uuid,integer,uuid,text) TO service_role;

CREATE FUNCTION public.followup_attach_tip_session(_reservation_id uuid,_session_id text,_url text,_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.followup_tip_reservations; uid uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT user_id INTO uid FROM public.followup_tip_reservations WHERE id=_reservation_id;
 IF uid IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||uid::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE id=_reservation_id FOR UPDATE;
 IF _session_id IS NULL OR _session_id !~ '^cs_' OR _url IS NULL OR _url !~ '^https://checkout\.stripe\.com/' OR _expires_at IS NULL THEN RAISE EXCEPTION 'Invalid session'; END IF;
 IF extract(epoch FROM _expires_at)::bigint IS DISTINCT FROM (r.checkout_parameters->>'expires_at')::bigint THEN RAISE EXCEPTION 'Expiry mismatch'; END IF;
 IF r.session_id IS NOT NULL AND r.session_id<>_session_id THEN RAISE EXCEPTION 'Session mismatch'; END IF;
 UPDATE public.followup_tip_reservations SET session_id=_session_id,session_url=_url,state=CASE WHEN state IN ('reserved','ambiguous') THEN 'attached' ELSE state END WHERE id=r.id;
 UPDATE public.dj_tips SET stripe_checkout_session_id=_session_id,checkout_expires_at=_expires_at WHERE id=r.tip_id;
END $$;
REVOKE ALL ON FUNCTION public.followup_attach_tip_session(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.followup_attach_tip_session(uuid,text,text,timestamptz) TO service_role;
-- Unresolved legacy pending tips also retain quota until authoritative evidence. Never age-release unknown sessions.
-- New/legacy writers use SECURITY DEFINER boundaries; direct service REST writes are revoked in 02.
