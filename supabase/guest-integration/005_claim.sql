CREATE TABLE guest_runtime.claims(source_id uuid PRIMARY KEY REFERENCES guest_runtime.app_principals(id),target_id uuid NOT NULL REFERENCES guest_runtime.app_principals(id),credential_hash bytea NOT NULL,source_balance integer NOT NULL,starter_deduction integer NOT NULL,joined_deduction integer NOT NULL,claimed_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON guest_runtime.claims FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.claims ENABLE ROW LEVEL SECURITY;
CREATE TABLE guest_runtime.merge_evidence(source_id uuid NOT NULL,kind text NOT NULL,row_data jsonb NOT NULL,at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON guest_runtime.merge_evidence FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guest_runtime.merge_evidence ENABLE ROW LEVEL SECURITY;
-- Claim exclusion precedes identity/event/tip/profile locks everywhere; no lock inversion.
CREATE OR REPLACE FUNCTION guest_runtime.actor_lock(_actor uuid) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid; BEGIN
 PERFORM pg_advisory_xact_lock_shared(8713201,1);
 u:=guest_runtime.actor(_actor);
 IF u IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('guest-identity:'||u::text,0));
 RETURN u;
END $$;
CREATE FUNCTION public.claim_guest_principal(_bootstrap text,_event_id uuid DEFAULT NULL,_token text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid:=auth.uid(); src uuid; h bytea; b integer; dedup integer:=0; joined integer:=0; overlap_events uuid[]:=ARRAY[]::uuid[]; c guest_runtime.claims; v record; eid uuid; total bigint; BEGIN
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target AND NOT is_anonymous)
 THEN RETURN guest_runtime.fail(403,'registered_session_required'); END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.installation WHERE id AND enabled AND contract='guest-integration-v1') THEN RETURN guest_runtime.fail(503,'guest_disabled'); END IF;
 -- Never claim with UUID alone. Accept exactly one real guest credential.
 IF _bootstrap IS NOT NULL AND _bootstrap~'^[0-9a-f]{64}$' THEN
  h:=guest_runtime.digest(_bootstrap); SELECT principal_id INTO src FROM guest_runtime.bootstraps WHERE hash=h;
 ELSIF _token IS NOT NULL AND _token~'^[0-9a-f]{64}$' AND _event_id IS NOT NULL THEN
  h:=guest_runtime.digest(_token); SELECT principal_id INTO src FROM guest_runtime.sessions WHERE event_id=_event_id AND token_hash=h AND expires_at>clock_timestamp();
 ELSE RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 IF src IS NULL THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 PERFORM pg_advisory_xact_lock(8713201,1);
 SELECT * INTO c FROM guest_runtime.claims WHERE source_id=src;
 IF c.source_id IS NOT NULL THEN
  IF c.target_id=target AND c.credential_hash=h THEN RETURN jsonb_build_object('ok',true,'actor_id',target,'alias_ids',guest_runtime.aliases(target),'already_claimed',true); END IF;
  RETURN guest_runtime.fail(409,'already_claimed');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM guest_runtime.app_principals WHERE id=src AND kind='guest' AND merged_into IS NULL) THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 IF (_bootstrap IS NOT NULL AND NOT EXISTS(SELECT 1 FROM guest_runtime.bootstraps WHERE hash=h AND revoked_at IS NULL)) OR (_bootstrap IS NULL AND NOT EXISTS(SELECT 1 FROM guest_runtime.sessions WHERE token_hash=h AND event_id=_event_id AND revoked_at IS NULL AND expires_at>clock_timestamp() AND guest_runtime.member(src,_event_id))) THEN RETURN guest_runtime.fail(401,'invalid_session'); END IF;
 -- Global claim exclusion is short-lived and source-only; all actor operations share it.
 FOR v IN SELECT id FROM guest_runtime.app_principals WHERE id IN(src,target) ORDER BY id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('guest-identity:'||v.id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('tip:'||v.id::text,0));
 END LOOP;
 FOR eid IN SELECT DISTINCT event_id FROM public.event_participants WHERE user_id=src OR user_id=ANY(guest_runtime.aliases(target)) ORDER BY event_id LOOP
  PERFORM 1 FROM public.events WHERE id=eid FOR UPDATE;
 END LOOP;
 PERFORM 1 FROM public.profiles WHERE id IN(src,target) ORDER BY id FOR UPDATE;
 SELECT points INTO b FROM public.profiles WHERE id=src;
 SELECT coalesce(sum(amount),0) INTO total FROM public.points_transactions WHERE user_id=src;
 IF b IS NULL OR b<>total OR b<0 THEN RETURN guest_runtime.fail(409,'balance_review_required'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target) THEN RETURN guest_runtime.fail(409,'profile_required'); END IF;
 IF (SELECT points FROM public.profiles WHERE id=target) IS DISTINCT FROM (SELECT coalesce(sum(amount),0) FROM public.points_transactions WHERE user_id=target) THEN RETURN guest_runtime.fail(409,'balance_review_required'); END IF;
 IF EXISTS(SELECT 1 FROM public.points_transactions WHERE user_id=src AND reason='Starter points') AND EXISTS(SELECT 1 FROM public.points_transactions WHERE user_id=ANY(guest_runtime.aliases(target)) AND reason='Starter points') THEN dedup:=15; END IF;
 -- Membership overlap alone is not evidence of a duplicate award. Match canonical
 -- Joined event ledger rewards, including prior claim compensations on target aliases.
 FOR eid IN SELECT p.event_id FROM public.event_participants p WHERE p.user_id=src
  AND EXISTS(SELECT 1 FROM public.event_participants t WHERE t.event_id=p.event_id AND t.user_id=ANY(guest_runtime.aliases(target))) ORDER BY p.event_id LOOP
  IF EXISTS(SELECT 1 FROM public.points_transactions WHERE user_id=src AND event_id=eid AND reason='Joined event')
  AND (SELECT coalesce(sum(amount),0) FROM public.points_transactions WHERE user_id=ANY(guest_runtime.aliases(target)) AND event_id=eid AND reason IN ('Joined event','Guest claim duplicate Joined event'))>0 THEN
   IF (SELECT count(*) FROM public.points_transactions WHERE user_id=src AND event_id=eid AND reason='Joined event')<>1
   OR NOT EXISTS(SELECT 1 FROM public.points_transactions WHERE user_id=src AND event_id=eid AND reason='Joined event' AND amount=1 AND type='earned' AND song_request_id IS NULL)
   OR (SELECT sum(amount) FROM public.points_transactions WHERE user_id=ANY(guest_runtime.aliases(target)) AND event_id=eid AND reason IN ('Joined event','Guest claim duplicate Joined event'))<>1
   THEN RETURN guest_runtime.fail(409,'join_reward_review_required'); END IF;
   overlap_events:=array_append(overlap_events,eid); joined:=joined+1;
  END IF;
 END LOOP;
 IF b<dedup+joined THEN RETURN guest_runtime.fail(409,'balance_review_required'); END IF;
 -- Keep target/earliest vote, delete duplicates through delta counter trigger; immutable rows never reparented.
 FOR v IN SELECT vv.id,vv.song_request_id FROM public.votes vv WHERE vv.user_id=src AND EXISTS(SELECT 1 FROM public.votes t WHERE t.song_request_id=vv.song_request_id AND t.user_id=ANY(guest_runtime.aliases(target))) ORDER BY vv.song_request_id,vv.id LOOP
  PERFORM 1 FROM public.song_requests WHERE id=v.song_request_id FOR UPDATE;
  INSERT INTO guest_runtime.merge_evidence SELECT src,'vote',to_jsonb(x),now() FROM public.votes x WHERE id=v.id;
  DELETE FROM public.votes WHERE id=v.id;
 END LOOP;
 INSERT INTO guest_runtime.merge_evidence SELECT src,'membership',to_jsonb(p),now() FROM public.event_participants p WHERE user_id=src AND EXISTS(SELECT 1 FROM public.event_participants t WHERE t.event_id=p.event_id AND t.user_id=ANY(guest_runtime.aliases(target)));
 DELETE FROM public.event_participants p WHERE user_id=src AND EXISTS(SELECT 1 FROM public.event_participants t WHERE t.event_id=p.event_id AND t.user_id=ANY(guest_runtime.aliases(target)));
 -- Original source ledger and financial metadata remain intact; transfer entries reconcile both balances.
 INSERT INTO public.points_transactions(user_id,amount,type,reason,created_by) VALUES(src,-b,'manual_adjustment','Guest claim transfer out',target),(target,b-dedup,'manual_adjustment','Guest claim transfer in (starter deduplicated)',target);
 FOREACH eid IN ARRAY overlap_events LOOP
  INSERT INTO guest_runtime.merge_evidence VALUES(src,'joined_reward',jsonb_build_object('event_id',eid,'deduction',1,'source_ledger',(SELECT jsonb_agg(to_jsonb(t)) FROM public.points_transactions t WHERE user_id=src AND event_id=eid AND reason='Joined event'),'target_ledger',(SELECT jsonb_agg(to_jsonb(t)) FROM public.points_transactions t WHERE user_id=ANY(guest_runtime.aliases(target)) AND event_id=eid AND reason IN ('Joined event','Guest claim duplicate Joined event'))),now());
  INSERT INTO public.points_transactions(user_id,event_id,amount,type,reason,created_by) VALUES(target,eid,-1,'manual_adjustment','Guest claim duplicate Joined event',target);
 END LOOP;
 UPDATE public.profiles SET points=0,updated_at=now() WHERE id=src;
 UPDATE public.profiles SET points=points+b-dedup-joined,updated_at=now() WHERE id=target;
 INSERT INTO guest_runtime.claims VALUES(src,target,h,b,dedup,joined,now());
 UPDATE guest_runtime.app_principals SET merged_into=target WHERE id=src;
 UPDATE guest_runtime.bootstraps SET revoked_at=now() WHERE principal_id=src;
 UPDATE guest_runtime.sessions SET revoked_at=now() WHERE principal_id=src;
 RETURN jsonb_build_object('ok',true,'actor_id',target,'alias_ids',guest_runtime.aliases(target),'transferred_points',b-dedup-joined,'starter_deduplicated',dedup,'joined_deduplicated',joined);
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_principal(text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_guest_principal(text,uuid,text) TO authenticated;
CREATE FUNCTION public.get_my_principal_aliases() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT guest_runtime.aliases(auth.uid()) $$;
REVOKE ALL ON FUNCTION public.get_my_principal_aliases() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_principal_aliases() TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
