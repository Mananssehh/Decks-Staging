SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
REVOKE INSERT,DELETE,UPDATE ON public.profiles FROM anon,authenticated;
GRANT UPDATE(nickname,is_public,updated_at) ON public.profiles TO authenticated;
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND
 (NEW.id IS DISTINCT FROM OLD.id OR NEW.points IS DISTINCT FROM OLD.points
 OR NEW.is_premium IS DISTINCT FROM OLD.is_premium OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
 RAISE EXCEPTION 'Sensitive profile fields are immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
-- Existing handle_new_user is idempotent and protected by uniq_starter_points_per_user.
DO $$ DECLARE attached integer; BEGIN
 SELECT count(*) INTO attached FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal AND tgenabled<>'D' AND tgfoid='public.handle_new_user()'::regprocedure;
 IF attached>1 THEN RAISE EXCEPTION 'Multiple bootstrap triggers: review before continuing'; END IF;
 IF attached=0 THEN CREATE TRIGGER repair_auth_bootstrap AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user(); END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.repair_points_reconciliation (
 user_id uuid PRIMARY KEY, balance integer NOT NULL, ledger_total bigint NOT NULL,
 difference bigint NOT NULL, classification text NOT NULL, captured_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.repair_points_reconciliation TO service_role;
REVOKE ALL ON public.repair_points_reconciliation FROM anon,authenticated;
ALTER TABLE public.repair_points_reconciliation ENABLE ROW LEVEL SECURITY;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.points_transactions IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.repair_points_reconciliation(user_id,balance,ledger_total,difference,classification)
SELECT p.id,p.points,coalesce(sum(t.amount),0),p.points-coalesce(sum(t.amount),0),
 CASE WHEN count(t.id) FILTER(WHERE t.reason='Starter points')=0 AND p.points-coalesce(sum(t.amount),0)=15 THEN 'missing_starter'
 WHEN p.points-coalesce(sum(t.amount),0)=0 THEN 'reconciled' ELSE 'quarantined' END
FROM public.profiles p LEFT JOIN public.points_transactions t ON t.user_id=p.id GROUP BY p.id,p.points
ON CONFLICT(user_id) DO NOTHING; -- Preserve first capture; never overwrite historical evidence on resume.
-- Add only the exactly proven missing ledger award. Never change balances.
INSERT INTO public.points_transactions(user_id,amount,type,reason)
SELECT r.user_id,15,'earned','Starter points' FROM public.repair_points_reconciliation r JOIN public.profiles p ON p.id=r.user_id
WHERE r.classification='missing_starter'
AND p.points-coalesce((SELECT sum(t.amount) FROM public.points_transactions t WHERE t.user_id=p.id),0)=15
ON CONFLICT(user_id) WHERE reason='Starter points' DO NOTHING;
