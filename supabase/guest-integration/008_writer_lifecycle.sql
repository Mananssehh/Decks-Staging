-- SOURCE ONLY. Include after 007 in the same installation transaction.
-- BEFORE STATEMENT exclusion runs before tuple locks, including direct legacy DML.
-- Row triggers must NEVER acquire this gate for the first time.
CREATE FUNCTION public.guest_writer_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(8713201,1);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.guest_writer_guard() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['events','song_requests','votes','event_participants','event_banned_guests','profiles','points_transactions','dj_tips','now_playing','purchase_consents','dj_payout_accounts'] LOOP
  EXECUTE format('CREATE TRIGGER guest_writer_gate BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.guest_writer_guard()',rel);
 END LOOP;
END $$;
-- Protect the new identity column without weakening the existing sensitive guard.
CREATE FUNCTION public.guest_profile_identity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (new.id IS DISTINCT FROM old.id OR new.auth_user_id IS DISTINCT FROM old.auth_user_id)
 THEN RAISE EXCEPTION 'Immutable profile identity' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM auth.users WHERE id=new.id) AND new.auth_user_id IS DISTINCT FROM new.id
 THEN RAISE EXCEPTION 'Registered profile requires protected Auth link' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND current_user NOT IN ('postgres','supabase_admin') AND new.auth_user_id IS NULL
 THEN RAISE EXCEPTION 'Guest profile creation is server-only' USING ERRCODE='42501'; END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.guest_profile_identity_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guest_profile_identity BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guest_profile_identity_guard();
-- Outer entry wrappers acquire gate before event/reservation/tuple locks.
-- Preserve actual installed bodies and signatures, not historical copies.
DO $$ DECLARE r record; definition text; BEGIN
 FOR r IN SELECT * FROM guest_runtime.before_functions WHERE signature LIKE 'public.dj_transition_request(%' OR signature LIKE 'public.dj_set_queue_position(%' OR signature LIKE 'public.repair_write_broadcast(%' OR signature LIKE 'dj_transition_request(%' OR signature LIKE 'dj_set_queue_position(%' OR signature LIKE 'repair_write_broadcast(%' OR signature LIKE 'public.update_my_profile(%' OR signature LIKE 'update_my_profile(%' LOOP
  definition:=regexp_replace(r.definition,'\mBEGIN\M',E'BEGIN\n PERFORM pg_advisory_xact_lock_shared(8713201,1);','i');
  IF definition=r.definition THEN RAISE EXCEPTION 'Writer body requires review: %',r.signature; END IF;
  EXECUTE definition;
 END LOOP;
END $$;
-- The standalone award boundary takes exclusion BEFORE resolving aliases.
-- Trigger callers already hold it via their outer statement/kernel entry.
CREATE OR REPLACE FUNCTION public.award_points(_user_id uuid,_event_id uuid,_amount integer,_type public.point_tx_type,_reason text DEFAULT '',_song_request_id uuid DEFAULT NULL,_created_by uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; BEGIN
 PERFORM pg_advisory_xact_lock_shared(8713201,1);
 u:=guest_runtime.actor(_user_id);
 IF _amount=0 THEN RETURN; END IF;
 IF u IS NULL THEN RAISE EXCEPTION 'Unknown principal'; END IF;
 UPDATE public.profiles SET points=greatest(0,points+_amount),updated_at=now() WHERE id=u;
 INSERT INTO public.points_transactions(user_id,event_id,song_request_id,amount,type,reason,created_by)
 VALUES(u,_event_id,_song_request_id,_amount,_type,coalesce(_reason,''),_created_by);
END $$;
REVOKE ALL ON FUNCTION public.award_points(uuid,uuid,integer,public.point_tx_type,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Guard remains private; server functions run as their protected owner.
-- Claimed source/target deletion is deliberately RESTRICTED by merged_into/claims
-- FKs. Unclaimed profile deletion cascades principal/credentials and original
-- request SET NULL / vote+tip+funnel CASCADE semantics; ledger remains audit history.