-- SOURCE ONLY: aliases affect mutex/cap/authorization, NEVER immutable provider identities.
CREATE OR REPLACE FUNCTION public.followup_reserve_tip(_user_id uuid,_request_key uuid,_event_id uuid,_amount_cents integer,_song_request_id uuid DEFAULT NULL,_origin text DEFAULT NULL)
RETURNS public.followup_tip_reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.followup_tip_reservations; e public.events; p public.dj_payout_accounts;
 s public.song_requests; t uuid:=gen_random_uuid(); fee integer; day_spend bigint; event_spend bigint;
 nick text; params jsonb; current_consent constant text:='v2-tips-2026-06-12';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF _user_id IS NULL OR _request_key IS NULL OR _event_id IS NULL OR _amount_cents IS NULL OR _amount_cents<100 OR _amount_cents>5000 THEN RAISE EXCEPTION 'Invalid tip' USING ERRCODE='22023'; END IF;
 PERFORM guest_runtime.actor_lock(_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||guest_runtime.actor(_user_id)::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE user_id=ANY(guest_runtime.aliases(_user_id)) AND request_key=_request_key FOR UPDATE;
 IF FOUND THEN
  IF r.event_id<>_event_id OR r.amount_cents<>_amount_cents OR r.checkout_parameters->>'song_request_id' IS DISTINCT FROM _song_request_id::text THEN RAISE EXCEPTION 'Idempotency key payload mismatch' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_participants WHERE event_id=r.event_id AND user_id=ANY(guest_runtime.aliases(_user_id))) OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=r.event_id AND user_id=ANY(guest_runtime.aliases(_user_id))) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
  RETURN r;
 END IF;
 SELECT * INTO e FROM public.events WHERE id=_event_id;
 IF e.id IS NULL OR NOT e.is_active OR e.requests_status='ended' OR e.ended_at IS NOT NULL OR e.dj_id=guest_runtime.actor(_user_id) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_participants WHERE event_id=e.id AND user_id=ANY(guest_runtime.aliases(_user_id)))
 OR EXISTS(SELECT 1 FROM public.event_banned_guests WHERE event_id=e.id AND user_id=ANY(guest_runtime.aliases(_user_id))) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.purchase_consents WHERE user_id=ANY(guest_runtime.aliases(_user_id)) AND version=current_consent) THEN RAISE EXCEPTION 'Current consent required' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.dj_payout_accounts WHERE user_id=e.dj_id;
 IF p.user_id IS NULL OR NOT p.charges_enabled OR NOT p.payouts_enabled THEN RAISE EXCEPTION 'DJ payouts unavailable'; END IF;
 IF _song_request_id IS NOT NULL THEN SELECT * INTO s FROM public.song_requests WHERE id=_song_request_id AND event_id=e.id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Invalid song request'; END IF; END IF;
 -- Reserved/ambiguous are never aged out by elapsed time: a checkout may exist or be paid.
 -- All reservation-backed pending remains counted until signed/retrieved terminal evidence.
 -- Unresolved legacy pending also retains quota until authoritative evidence. Dollar caps unchanged.
 SELECT coalesce(sum(d.gross_amount_cents),0) INTO day_spend FROM public.dj_tips d
 WHERE d.user_id=ANY(guest_runtime.aliases(_user_id)) AND ((d.status='succeeded' AND d.created_at>now()-interval '24 hours')
 OR d.status='pending');
 SELECT coalesce(sum(d.gross_amount_cents),0) INTO event_spend FROM public.dj_tips d
 WHERE d.user_id=ANY(guest_runtime.aliases(_user_id)) AND d.event_id=e.id AND (d.status='succeeded'
 OR d.status='pending');
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
CREATE OR REPLACE FUNCTION public.followup_attach_tip_session(_reservation_id uuid,_session_id text,_url text,_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.followup_tip_reservations; uid uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT user_id INTO uid FROM public.followup_tip_reservations WHERE id=_reservation_id;
 IF uid IS NULL THEN RAISE EXCEPTION 'Reservation not found'; END IF;
 PERFORM guest_runtime.actor_lock(uid);
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||guest_runtime.actor(uid)::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE id=_reservation_id FOR UPDATE;
 IF _session_id IS NULL OR _session_id !~ '^cs_' OR _url IS NULL OR _url !~ '^https://checkout\.stripe\.com/' OR _expires_at IS NULL THEN RAISE EXCEPTION 'Invalid session'; END IF;
 IF extract(epoch FROM _expires_at)::bigint IS DISTINCT FROM (r.checkout_parameters->>'expires_at')::bigint THEN RAISE EXCEPTION 'Expiry mismatch'; END IF;
 IF r.session_id IS NOT NULL AND r.session_id<>_session_id THEN RAISE EXCEPTION 'Session mismatch'; END IF;
 UPDATE public.followup_tip_reservations SET session_id=_session_id,session_url=_url,state=CASE WHEN state IN ('reserved','ambiguous') THEN 'attached' ELSE state END WHERE id=r.id;
 UPDATE public.dj_tips SET stripe_checkout_session_id=_session_id,checkout_expires_at=_expires_at WHERE id=r.tip_id;
END $$;
CREATE OR REPLACE FUNCTION public.followup_apply_financial_event(_e jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.dj_tips; r public.followup_tip_reservations; f public.followup_tip_financial_state;
 uid uuid; tid uuid; ids uuid[]; v text; k text; rid uuid; kind text:=_e->>'kind';
 eid text:=_e->>'event_id'; refunded integer; v_paid boolean; terminal boolean; dispute_time bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF eid IS NULL OR eid !~ '^(evt_|reconcile:)' OR kind NOT IN ('paid','pending','expired','failed','refund','dispute_open','dispute_won','dispute_lost','charge','review') THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 rid:=nullif(_e->>'reservation_id','')::uuid;
 SELECT array_agg(DISTINCT id) INTO ids FROM public.dj_tips WHERE
 (id=nullif(_e->>'tip_id','')::uuid) OR
 (stripe_checkout_session_id=nullif(_e->>'session_id','')) OR
 (stripe_payment_intent_id=nullif(_e->>'payment_intent','')) OR
 (stripe_charge_id=nullif(_e->>'charge_id','')) OR
 (id IN (SELECT tip_id FROM public.followup_tip_reservations WHERE id=rid));
 IF coalesce(array_length(ids,1),0)<>1 THEN RAISE EXCEPTION 'Unknown or ambiguous payment: retry/review'; END IF;
 tid:=ids[1]; SELECT user_id INTO uid FROM public.dj_tips WHERE id=tid;
 PERFORM guest_runtime.actor_lock(uid);
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||guest_runtime.actor(uid)::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE tip_id=tid FOR UPDATE;
 SELECT * INTO d FROM public.dj_tips WHERE id=tid FOR UPDATE;
 IF rid IS NOT NULL AND r.id IS DISTINCT FROM rid THEN RAISE EXCEPTION 'Reservation identity mismatch'; END IF;
 IF nullif(_e->>'tip_id','') IS NOT NULL AND (_e->>'tip_id')::uuid<>tid THEN RAISE EXCEPTION 'Tip identity mismatch'; END IF;
 -- Existing known IDs are immutable; absent IDs may be linked only by other verified identity.
 FOREACH k IN ARRAY ARRAY['session_id','payment_intent','charge_id'] LOOP
  IF nullif(_e->>k,'') IS NOT NULL AND (_e->>k) !~ (CASE k WHEN 'session_id' THEN '^cs_' WHEN 'payment_intent' THEN '^pi_' ELSE '^ch_' END) THEN RAISE EXCEPTION 'Malformed provider identity'; END IF;
  v:=CASE k WHEN 'session_id' THEN d.stripe_checkout_session_id WHEN 'payment_intent' THEN d.stripe_payment_intent_id ELSE d.stripe_charge_id END;
  IF v IS NOT NULL AND nullif(_e->>k,'') IS NOT NULL AND v<>_e->>k THEN RAISE EXCEPTION 'Provider identity mismatch'; END IF;
 END LOOP;
 IF kind<>'review' THEN
  IF (_e->>'amount_cents')::integer IS DISTINCT FROM d.gross_amount_cents OR _e->>'currency' IS DISTINCT FROM d.currency
  OR (_e->>'livemode')::boolean IS DISTINCT FROM d.livemode THEN RAISE EXCEPTION 'Financial evidence mismatch'; END IF;
  IF nullif(_e->>'destination','') IS NOT NULL AND _e->>'destination' IS DISTINCT FROM d.stripe_destination_account THEN RAISE EXCEPTION 'Destination mismatch'; END IF;
  IF nullif(_e->>'fee','') IS NOT NULL AND (_e->>'fee')::integer IS DISTINCT FROM d.platform_fee_cents THEN RAISE EXCEPTION 'Fee mismatch'; END IF;
  IF r.id IS NOT NULL AND nullif(_e->>'expires_at','') IS NOT NULL AND (_e->>'expires_at')::bigint IS DISTINCT FROM (r.checkout_parameters->>'expires_at')::bigint THEN RAISE EXCEPTION 'Frozen expiry mismatch'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.followup_payment_events WHERE event_id=eid) THEN
  IF NOT EXISTS(SELECT 1 FROM public.followup_payment_events WHERE event_id=eid AND tip_id=tid AND (evidence=_e OR nullif(_e->>'event_fingerprint','') IS NOT NULL AND evidence->>'event_fingerprint'=_e->>'event_fingerprint')) THEN RAISE EXCEPTION 'Event replay mismatch'; END IF;
  RETURN tid;
 END IF;
 INSERT INTO public.followup_tip_financial_state(tip_id,paid) VALUES(tid,d.status IN ('succeeded','refunded','partially_refunded','disputed')) ON CONFLICT DO NOTHING;
 SELECT * INTO f FROM public.followup_tip_financial_state WHERE tip_id=tid FOR UPDATE;
 v_paid:=f.paid OR kind IN ('paid','refund','dispute_open','dispute_won','dispute_lost');
 refunded:=d.refunded_amount_cents;
 IF kind='refund' THEN
  IF (_e->>'refunded_amount_cents')::integer IS NULL OR (_e->>'refunded_amount_cents')::integer NOT BETWEEN 0 AND d.gross_amount_cents THEN RAISE EXCEPTION 'Invalid cumulative refund'; END IF;
  refunded:=greatest(refunded,(_e->>'refunded_amount_cents')::integer);
 END IF;
 IF kind LIKE 'dispute_%' THEN
  IF f.dispute_state IN ('won','lost') AND kind<>'dispute_open' AND f.dispute_state<>(CASE kind WHEN 'dispute_won' THEN 'won' ELSE 'lost' END) THEN RAISE EXCEPTION 'Conflicting closed dispute: review'; END IF;
  IF nullif(_e->>'dispute_id','') IS NULL OR f.dispute_id IS NOT NULL AND f.dispute_id<>_e->>'dispute_id' THEN RAISE EXCEPTION 'Dispute identity mismatch'; END IF;
  dispute_time:=(_e->>'created')::bigint;
  IF dispute_time IS NULL THEN RAISE EXCEPTION 'Missing dispute timestamp'; END IF;
  IF kind<>'dispute_open' AND (f.dispute_closed_at IS NULL OR dispute_time>f.dispute_closed_at) THEN
   f.dispute_state:=CASE kind WHEN 'dispute_won' THEN 'won' ELSE 'lost' END; f.dispute_closed_at:=dispute_time;
  ELSIF kind='dispute_open' AND f.dispute_closed_at IS NULL THEN f.dispute_state:='open'; END IF;
  f.dispute_id:=_e->>'dispute_id';
 END IF;
 terminal:=coalesce((_e->>'terminal')::boolean,false);
 IF kind IN ('failed','expired') AND NOT terminal THEN kind:='pending'; END IF;
 UPDATE public.dj_tips SET status=CASE
  WHEN f.dispute_state='lost' OR refunded>=gross_amount_cents THEN 'refunded'
  WHEN f.dispute_state IN ('open','needs_review') THEN 'disputed'
  WHEN refunded>0 THEN 'partially_refunded'
  WHEN v_paid THEN 'succeeded'
  WHEN kind IN ('failed','expired') THEN kind
  WHEN status IN ('failed','expired') THEN status ELSE 'pending' END,
  stripe_checkout_session_id=coalesce(nullif(_e->>'session_id',''),stripe_checkout_session_id),
  stripe_payment_intent_id=coalesce(nullif(_e->>'payment_intent',''),stripe_payment_intent_id),
  stripe_charge_id=coalesce(nullif(_e->>'charge_id',''),stripe_charge_id),
  refunded_amount_cents=CASE WHEN f.dispute_state='lost' THEN gross_amount_cents ELSE refunded END,
  refund_id=CASE WHEN kind='refund' AND refunded>d.refunded_amount_cents THEN coalesce(_e->>'refund_id',refund_id) ELSE refund_id END,
  refunded_at=CASE WHEN refunded>d.refunded_amount_cents OR f.dispute_state='lost' THEN coalesce(refunded_at,now()) ELSE refunded_at END,
  checkout_expires_at=coalesce(to_timestamp(nullif(_e->>'expires_at','')::bigint),checkout_expires_at),
  failure_reason=CASE WHEN kind IN ('failed','expired','review') THEN kind ELSE failure_reason END WHERE id=tid;
 UPDATE public.followup_tip_financial_state SET paid=v_paid,
 dispute_id=f.dispute_id,dispute_state=f.dispute_state,dispute_closed_at=f.dispute_closed_at,
 review_reason=CASE WHEN kind='review' THEN coalesce(_e->>'reason','provider_ambiguity') WHEN terminal OR kind='paid' THEN NULL ELSE review_reason END WHERE tip_id=tid;
 IF r.id IS NOT NULL THEN
  UPDATE public.followup_tip_reservations SET session_id=coalesce(nullif(_e->>'session_id',''),session_id),
  state=CASE WHEN v_paid THEN 'succeeded' WHEN kind='review' THEN 'review' WHEN kind IN ('failed','expired') THEN kind ELSE state END WHERE id=r.id;
 END IF;
 INSERT INTO public.followup_payment_events(event_id,tip_id,event_type,evidence) VALUES(eid,tid,_e->>'event_type',_e);
 RETURN tid;
END $$;
CREATE OR REPLACE FUNCTION public.followup_sync_account(_e jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; previous bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT user_id INTO uid FROM public.dj_payout_accounts WHERE stripe_account_id=_e->>'account_id';
 IF uid IS NULL THEN RAISE EXCEPTION 'Unknown connected account'; END IF;
 PERFORM guest_runtime.actor_lock(uid);
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||guest_runtime.actor(uid)::text,0));
 PERFORM 1 FROM public.dj_payout_accounts WHERE user_id=uid FOR UPDATE;
 SELECT provider_created INTO previous FROM public.followup_account_evidence WHERE account_id=_e->>'account_id';
 IF previous IS NOT NULL AND previous>(_e->>'created')::bigint THEN RETURN; END IF;
 UPDATE public.dj_payout_accounts SET payouts_enabled=(_e->>'payouts_enabled')::boolean,
 charges_enabled=(_e->>'charges_enabled')::boolean,details_submitted=(_e->>'details_submitted')::boolean,
 livemode=(_e->>'livemode')::boolean,last_synced_at=now() WHERE user_id=uid;
 INSERT INTO public.followup_account_evidence(account_id,provider_created,evidence) VALUES(_e->>'account_id',(_e->>'created')::bigint,_e)
 ON CONFLICT(account_id) DO UPDATE SET provider_created=excluded.provider_created,evidence=excluded.evidence;
END $$;
CREATE OR REPLACE FUNCTION public.check_tip_cap(_user_id uuid,_event_id uuid,_amount_cents integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE day_total bigint; event_total bigint; BEGIN
 IF _user_id IS NULL OR _amount_cents IS NULL OR _amount_cents<=0 OR _amount_cents>5000 THEN RAISE EXCEPTION 'Invalid tip amount' USING ERRCODE='22023'; END IF;
 PERFORM guest_runtime.actor_lock(_user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||guest_runtime.actor(_user_id)::text,0));
 SELECT coalesce(sum(gross_amount_cents),0) INTO day_total FROM public.dj_tips WHERE user_id=ANY(guest_runtime.aliases(_user_id)) AND (status='pending' OR status='succeeded' AND created_at>now()-interval '24 hours');
 SELECT coalesce(sum(gross_amount_cents),0) INTO event_total FROM public.dj_tips WHERE user_id=ANY(guest_runtime.aliases(_user_id)) AND event_id=_event_id AND status IN ('pending','succeeded');
 IF day_total+_amount_cents>10000 OR event_total+_amount_cents>10000 THEN RAISE EXCEPTION 'Tip limit reached' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.check_tip_cap(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_tip_cap(uuid,uuid,integer) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
