-- Destructive rollback only before ANY guest principal exists. NEVER orphan real guest data.
BEGIN;
DO $$ DECLARE r record; BEGIN
 IF EXISTS(SELECT 1 FROM guest_runtime.app_principals WHERE kind='guest') THEN RAISE EXCEPTION 'Refuse destructive rollback: guest records exist; use 900 containment'; END IF;
 FOR r IN SELECT * FROM guest_runtime.before_functions LOOP EXECUTE r.definition; END LOOP;
 ALTER TABLE public.profiles DROP CONSTRAINT guest_profile_auth_fkey;
 ALTER TABLE public.profiles DROP CONSTRAINT guest_profile_registered_id;
 -- Drop dependent private schema only after original ownership FKs are restored below.
 FOR r IN SELECT * FROM guest_runtime.before_constraints LOOP
  IF r.rel<>'profiles' THEN EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',r.rel,r.name); END IF;
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',r.rel,r.name,r.definition);
 END LOOP;
END $$;
DROP FUNCTION public.guest_event_api(text,jsonb);
DROP FUNCTION public.guest_validate_actor(uuid,text);
DROP FUNCTION public.claim_guest_principal(text,uuid,text);
DROP FUNCTION public.get_my_principal_aliases();
DROP SCHEMA guest_runtime CASCADE;
ALTER TABLE public.profiles DROP CONSTRAINT guest_profile_identity;
ALTER TABLE public.profiles DROP COLUMN auth_user_id;
DROP FUNCTION public.guest_writer_guard();
DROP FUNCTION public.guest_profile_identity_guard();
COMMIT;
