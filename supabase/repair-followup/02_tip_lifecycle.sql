SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.followup_payment_events (
 event_id text PRIMARY KEY, tip_id uuid REFERENCES public.dj_tips(id), event_type text NOT NULL,
 evidence jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.followup_payment_events TO service_role;
REVOKE ALL ON public.followup_payment_events FROM PUBLIC,anon,authenticated;
ALTER TABLE public.followup_payment_events ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.followup_tip_financial_state (
 tip_id uuid PRIMARY KEY REFERENCES public.dj_tips(id), paid boolean NOT NULL DEFAULT false,
 dispute_id text, dispute_state text, dispute_closed_at bigint, review_reason text,
 notification_state text NOT NULL DEFAULT 'domain_not_configured'
);
GRANT SELECT ON public.followup_tip_financial_state TO service_role;
REVOKE ALL ON public.followup_tip_financial_state FROM PUBLIC,anon,authenticated;
ALTER TABLE public.followup_tip_financial_state ENABLE ROW LEVEL SECURITY;
INSERT INTO public.followup_tip_financial_state(tip_id,paid,dispute_state)
SELECT id,status IN ('succeeded','refunded','partially_refunded','disputed'),
 CASE WHEN status='disputed' THEN 'needs_review' END FROM public.dj_tips;
CREATE TABLE public.followup_account_evidence (
 account_id text PRIMARY KEY, provider_created bigint NOT NULL, evidence jsonb NOT NULL,
 notification_state text NOT NULL DEFAULT 'domain_not_configured'
);
GRANT SELECT ON public.followup_account_evidence TO service_role;
REVOKE ALL ON public.followup_account_evidence FROM PUBLIC,anon,authenticated;
ALTER TABLE public.followup_account_evidence ENABLE ROW LEVEL SECURITY;

-- Resolves ALL supplied identities. Conflicting metadata/linkage is never accepted by first-match fallback.
CREATE FUNCTION public.followup_apply_financial_event(_e jsonb) RETURNS uuid
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
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||uid::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE tip_id=tid FOR UPDATE;
 SELECT * INTO d FROM public.dj_tips WHERE id=tid FOR UPDATE;
 IF rid IS NOT NULL AND r.id IS DISTINCT FROM rid THEN RAISE EXCEPTION 'Reservation identity mismatch'; END IF;
 IF nullif(_e->>'tip_id','') IS NOT NULL AND (_e->>'tip_id')::uuid<>tid THEN RAISE EXCEPTION 'Tip identity mismatch'; END IF;
 -- Existing known IDs are immutable; absent IDs may be linked only by other verified identity.
 FOREACH k IN ARRAY ARRAY['session_id','payment_intent','charge_id'] LOOP
  IF nullif(_e->>k,'') IS NOT NULL AND (_e->>k) !~ CASE k WHEN 'session_id' THEN '^cs_' WHEN 'payment_intent' THEN '^pi_' ELSE '^ch_' END THEN RAISE EXCEPTION 'Malformed provider identity'; END IF;
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
  IF NOT EXISTS(SELECT 1 FROM public.followup_payment_events WHERE event_id=eid AND tip_id=tid AND evidence=_e) THEN RAISE EXCEPTION 'Event replay mismatch'; END IF;
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
  IF f.dispute_state IN ('won','lost') AND kind<>'dispute_open' AND f.dispute_state<>CASE kind WHEN 'dispute_won' THEN 'won' ELSE 'lost' END THEN RAISE EXCEPTION 'Conflicting closed dispute: review'; END IF;
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
REVOKE ALL ON FUNCTION public.followup_apply_financial_event(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.followup_apply_financial_event(jsonb) TO service_role;

-- Financial account state is authoritative, separate from domain-blocked notifications. Not an email queue.
CREATE FUNCTION public.followup_sync_account(_e jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; previous bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT user_id INTO uid FROM public.dj_payout_accounts WHERE stripe_account_id=_e->>'account_id';
 IF uid IS NULL THEN RAISE EXCEPTION 'Unknown connected account'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||uid::text,0));
 PERFORM 1 FROM public.dj_payout_accounts WHERE user_id=uid FOR UPDATE;
 SELECT provider_created INTO previous FROM public.followup_account_evidence WHERE account_id=_e->>'account_id';
 IF previous IS NOT NULL AND previous>(_e->>'created')::bigint THEN RETURN; END IF;
 UPDATE public.dj_payout_accounts SET payouts_enabled=(_e->>'payouts_enabled')::boolean,
 charges_enabled=(_e->>'charges_enabled')::boolean,details_submitted=(_e->>'details_submitted')::boolean,
 livemode=(_e->>'livemode')::boolean,last_synced_at=now() WHERE user_id=uid;
 INSERT INTO public.followup_account_evidence(account_id,provider_created,evidence) VALUES(_e->>'account_id',(_e->>'created')::bigint,_e)
 ON CONFLICT(account_id) DO UPDATE SET provider_created=excluded.provider_created,evidence=excluded.evidence;
END $$;
REVOKE ALL ON FUNCTION public.followup_sync_account(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.followup_sync_account(jsonb) TO service_role;

CREATE FUNCTION public.followup_payment_contract() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT 'payment-v3'::text $$;
REVOKE ALL ON FUNCTION public.followup_payment_contract() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.followup_payment_contract() TO service_role;
-- Remove every alternate REST financial writer. Security-definer functions (postgres owned) retain writes.
REVOKE INSERT,UPDATE,DELETE ON public.dj_tips FROM service_role,anon,authenticated;

-- Immutable accounting identity and fee prevents even owner-side accidental changes after reservation.
CREATE FUNCTION public.followup_tip_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (NEW.id,NEW.user_id,NEW.dj_id,NEW.event_id,NEW.gross_amount_cents,NEW.currency,NEW.platform_fee_cents,NEW.net_amount_cents,NEW.livemode,NEW.stripe_destination_account,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.dj_id,OLD.event_id,OLD.gross_amount_cents,OLD.currency,OLD.platform_fee_cents,OLD.net_amount_cents,OLD.livemode,OLD.stripe_destination_account,OLD.created_at)
 THEN RAISE EXCEPTION 'Immutable tip identity'; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.followup_tip_identity_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER followup_tip_identity_guard BEFORE UPDATE ON public.dj_tips FOR EACH ROW EXECUTE FUNCTION public.followup_tip_identity_guard();
