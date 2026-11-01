-- Isolated local model. auth is minimal; application columns/functions/indexes/policies are live-catalog copies.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}',is_anonymous boolean NOT NULL DEFAULT false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,public,extensions TO anon,authenticated,service_role;
CREATE TYPE public.app_role AS ENUM('dj','guest','admin');
CREATE TYPE public.error_severity AS ENUM('critical','warning','info');
CREATE TYPE public.point_tx_type AS ENUM('earned','spent','manual_adjustment','refunded');
CREATE TYPE public.request_status AS ENUM('pending','approved','playing','played','skipped','removed');
\ir ../evidence/catalog.sql
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
\ir ../evidence/acl.sql
-- Catalog capture includes indexes, not FK constraints. Restore relevant live relationships for fixture fidelity.
ALTER TABLE public.song_requests ADD FOREIGN KEY(event_id) REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE public.votes ADD FOREIGN KEY(song_request_id) REFERENCES public.song_requests(id) ON DELETE CASCADE;
ALTER TABLE public.points_transactions ADD FOREIGN KEY(song_request_id) REFERENCES public.song_requests(id) ON DELETE SET NULL;
ALTER TABLE public.votes ADD CONSTRAINT votes_value_check CHECK(value IN(-1,1));
