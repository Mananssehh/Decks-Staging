SET LOCAL lock_timeout='5s';
CREATE TABLE public.followup_payment_events (
 event_id text PRIMARY KEY, tip_id uuid NOT NULL REFERENCES public.dj_tips(id),
 event_type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.followup_payment_events TO service_role;
REVOKE ALL ON public.followup_payment_events FROM PUBLIC,anon,authenticated;
ALTER TABLE public.followup_payment_events ENABLE ROW LEVEL SECURITY;

-- Signed Stripe event only, never a browser endpoint. Durable payment evidence, not email queue.
CREATE FUNCTION public.followup_apply_tip_event(_event_id text,_event_type text,_reservation_id uuid,_session_id text,_payment_intent text,_paid boolean,_amount_cents integer,_currency text,_livemode boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.followup_tip_reservations; uid uuid; d public.dj_tips; next_state text;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF _event_id IS NULL OR _event_id !~ '^evt_' THEN RAISE EXCEPTION 'Invalid event'; END IF;
 IF _event_type NOT IN ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired') THEN RAISE EXCEPTION 'Unsupported event'; END IF;
 SELECT user_id INTO uid FROM public.followup_tip_reservations WHERE id=_reservation_id;
 IF uid IS NULL THEN RAISE EXCEPTION 'Unknown reservation: retry after reconciliation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||uid::text,0));
 SELECT * INTO r FROM public.followup_tip_reservations WHERE id=_reservation_id FOR UPDATE;
 SELECT * INTO d FROM public.dj_tips WHERE id=r.tip_id FOR UPDATE;
 IF _session_id IS NULL OR (r.session_id IS NOT NULL AND r.session_id<>_session_id)
 OR _amount_cents IS DISTINCT FROM r.amount_cents OR _currency IS DISTINCT FROM 'usd'
 OR _livemode IS DISTINCT FROM d.livemode THEN RAISE EXCEPTION 'Payment evidence mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.followup_payment_events WHERE event_id=_event_id) THEN RETURN; END IF;
 INSERT INTO public.followup_payment_events(event_id,tip_id,event_type) VALUES(_event_id,r.tip_id,_event_type);
 next_state:=CASE WHEN _event_type IN ('checkout.session.completed','checkout.session.async_payment_succeeded') AND _paid THEN 'succeeded'
 WHEN _event_type='checkout.session.expired' THEN 'expired'
 WHEN _event_type='checkout.session.async_payment_failed' THEN 'failed' ELSE 'pending' END;
 -- Paid may arrive after expired/failed. Late unpaid never downgrades financial terminal state.
 UPDATE public.dj_tips SET status=CASE WHEN status IN ('succeeded','refunded','partially_refunded','disputed') THEN status
 WHEN next_state='pending' AND status IN ('expired','failed') THEN status ELSE next_state END,
 stripe_checkout_session_id=_session_id,stripe_payment_intent_id=coalesce(_payment_intent,stripe_payment_intent_id) WHERE id=d.id;
 UPDATE public.followup_tip_reservations SET session_id=_session_id,state=CASE WHEN state='succeeded' THEN state
 WHEN next_state IN ('succeeded','expired','failed') THEN next_state ELSE state END WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION public.followup_apply_tip_event(text,text,uuid,text,text,boolean,integer,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.followup_apply_tip_event(text,text,uuid,text,text,boolean,integer,text,boolean) TO service_role;