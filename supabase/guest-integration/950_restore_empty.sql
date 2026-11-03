-- Destructive rollback only before ANY guest principal exists. NEVER orphan real guest data.
BEGIN;
DO $$ DECLARE r record; BEGIN
 IF EXISTS(SELECT 1 FROM guest_runtime.app_principals WHERE kind='guest') THEN RAISE EXCEPTION 'Refuse destructive rollback: guest records exist; use 900 containment'; END IF;
 FOR r IN SELECT * FROM guest_runtime.before_functions LOOP EXECUTE r.definition; END LOOP;
 FOR r IN SELECT * FROM guest_runtime.before_constraints LOOP
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.rel,r.name);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',r.rel,r.name,r.definition);
 END LOOP;
END $$;
DROP FUNCTION public.guest_event_api(text,jsonb);
DROP FUNCTION public.guest_validate_actor(uuid,text);
DROP FUNCTION public.claim_guest_principal(text,uuid,text);
DROP FUNCTION public.get_my_principal_aliases();
DROP SCHEMA guest_runtime CASCADE;
COMMIT;
