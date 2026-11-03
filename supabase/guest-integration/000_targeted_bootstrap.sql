-- SOURCE ONLY: separately review, then run BEFORE 001 in the SAME install transaction.
-- Only the independently inspected EXISTING legacy staging DJ; never inserts Auth.
DO $$
DECLARE u constant uuid:='46d7d47d-1b21-4351-a268-a1ccf95e1f42'; a auth.users;
 p public.profiles; t public.points_transactions; n text; profiles_before bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('reviewed-bootstrap:'||u::text,0));
 SELECT * INTO a FROM auth.users WHERE id=u FOR UPDATE;
 IF a.id IS NULL OR NOT a.is_anonymous THEN RAISE EXCEPTION 'Reviewed legacy anonymous Auth identity missing or changed'; END IF;
 n:=coalesce(a.raw_user_meta_data->>'nickname','Guest');
 IF (SELECT count(*) FROM public.user_roles WHERE user_id=u)<>1
 OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role='dj')
 OR (SELECT count(*) FROM public.events WHERE dj_id=u)<>1
 OR EXISTS(SELECT 1 FROM public.event_participants WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.song_requests WHERE requested_by=u)
 OR EXISTS(SELECT 1 FROM public.votes WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.dj_tips WHERE user_id=u OR dj_id=u)
 OR EXISTS(SELECT 1 FROM public.dj_payout_accounts WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.purchase_consents WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.followup_tip_reservations WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.guest_funnel_events WHERE user_id=u)
 THEN RAISE EXCEPTION 'Reviewed bootstrap ownership/financial evidence changed'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=u FOR UPDATE;
 IF p.id IS NOT NULL THEN
  SELECT * INTO t FROM public.points_transactions WHERE user_id=u;
  IF p.nickname IS DISTINCT FROM n OR p.points<>15 OR p.is_public OR p.is_premium
  OR (SELECT count(*) FROM public.points_transactions WHERE user_id=u)<>1
  OR t.amount<>15 OR t.type<>'earned' OR t.reason<>'Starter points'
  OR t.event_id IS NOT NULL OR t.song_request_id IS NOT NULL OR t.created_by IS NOT NULL
  THEN RAISE EXCEPTION 'Unexpected existing bootstrap profile/ledger; refuse overwrite'; END IF;
  RETURN; -- exact completed bootstrap: zero changes on retry
 END IF;
 IF EXISTS(SELECT 1 FROM public.points_transactions WHERE user_id=u) THEN RAISE EXCEPTION 'Unexpected existing bootstrap ledger'; END IF;
 SELECT count(*) INTO profiles_before FROM public.profiles;
 INSERT INTO public.profiles(id,nickname,points,is_public,is_premium) VALUES(u,n,15,false,false);
 INSERT INTO public.points_transactions(user_id,amount,type,reason) VALUES(u,15,'earned','Starter points');
 IF (SELECT count(*) FROM public.profiles)<>profiles_before+1
 OR (SELECT count(*) FROM public.points_transactions WHERE user_id=u)<>1
 THEN RAISE EXCEPTION 'Bootstrap rowcount mismatch'; END IF;
 -- Default current timestamps; do not backdate or change Auth, roles, events.
END $$;