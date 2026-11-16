-- DECKS Bridge Pairing Protocol v2 — SOURCE-ONLY MIGRATION CANDIDATE.
-- Not installed. Requires independent review, then execution on DECKS Staging only, and ONLY
-- through a mechanism independently confirmed to run this complete file in ONE transaction.
-- The file contains no BEGIN/COMMIT: how the deployment runner frames statements is not known
-- from the repository. A transaction-local marker (below) makes the guards and the post-apply
-- gate refuse to proceed when statements are committed one by one. Not idempotent: the first
-- guard refuses a second run. Contract: docs/BRIDGE_PAIRING_PROTOCOL_V2.md.
--
-- What changes
--   * Pairing secrets are 80 random bits (extensions.gen_random_bytes(10)), shown once to the
--     event owner as XXXX-XXXX-XXXX-XXXX and stored only as SHA-256 of the canonical form.
--   * Secrets live in a new private table with no client grants and no policies. The legacy
--     table public.bridge_pairing_codes is emptied and sealed with CHECK(false); its unexpected
--     table ACLs are deliberately NOT changed here (separate finding, see contract document).
--   * The first successful claim rotates the event's ingest token. A retry is honoured only for
--     the same client nonce, inside two minutes, while the issued token is still current.
--   * The six-digit claim routine is replaced by a constant refusal and loses every grant.
--     Protocol v1 is not an authorization path after this file, and no rollback restores it.
--   * Invalid attempts are refused and leave nothing behind: no evidence row, counter or budget
--     exists, so hostile traffic cannot deny legitimate pairing and nothing grows. The 80-bit
--     single-use secret is the control. public.bridge_pair_attempts is no longer written.
--   * No network address is accepted, stored or trusted.
-- Hosted values for the guards below: run 10_bridge_pairing_preflight.sql (SELECT-only) first.
--
-- Containment / rollback companion: supabase/repair-staged/rollback/10_bridge_pairing_contain.sql
-- (disables new pairing; never restores six-digit pairing). Summary at the end of this file.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Transaction-local marker. Outside one enclosing transaction SET LOCAL does not survive its own
-- statement, so the checks below see no marker and stop before anything is changed.
SET LOCAL bridge_pairing_v2.single_transaction='10_bridge_pairing_security';

-- ── 1. Drift guards: stop unless the prior installed state is exactly what this file expects ──
DO $guard$
DECLARE expected_columns integer; trusted constant text := 'postgres';
BEGIN
 IF pg_catalog.current_setting('bridge_pairing_v2.single_transaction',true) IS DISTINCT FROM '10_bridge_pairing_security' THEN
  RAISE EXCEPTION 'Not running as one transaction: refuse to apply statement by statement';
 END IF;
 -- Trusted owner. 'postgres' is the owner recorded for every captured application function
 -- (evidence/function-dependencies.txt). The SECURITY DEFINER routines created below run with
 -- the rights of whoever executes this file, so that role must be exactly that owner.
 IF current_user<>trusted THEN RAISE EXCEPTION 'Migration must run as the trusted owner, not %',current_user; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid IN (to_regprocedure('public.repair_claim_bridge_code(text,text)'),
    to_regprocedure('public.generate_bridge_pairing_code(uuid)'),to_regprocedure('public.regenerate_ingest_token(uuid)'))
    AND pg_catalog.pg_get_userbyid(p.proowner)<>trusted) THEN
  RAISE EXCEPTION 'Prior Bridge routine owner drift';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN (to_regclass('public.events'),to_regclass('public.event_integrations'),
    to_regclass('public.bridge_pairing_codes')) AND pg_catalog.pg_get_userbyid(c.relowner)<>trusted) THEN
  RAISE EXCEPTION 'Bridge table owner drift';
 END IF;
 IF to_regclass('public.bridge_pairing_v2') IS NOT NULL OR to_regprocedure('public.bridge_pair_claim_v2(text,text)') IS NOT NULL
  OR to_regprocedure('public.bridge_revoke_v2(text)') IS NOT NULL THEN
  RAISE EXCEPTION 'Bridge pairing v2 objects already exist: this candidate is not a resume script';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated')
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
  RAISE EXCEPTION 'Expected API roles are missing';
 END IF;
 IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
  RAISE EXCEPTION 'pgcrypto is not installed in schema extensions';
 END IF;
 IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'auth.uid() missing'; END IF;
 -- Bodies installed by 05_bridge.sql. Any other body means the catalog was changed after capture.
 IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.repair_claim_bridge_code(text,text)'))
   IS DISTINCT FROM 'fb34e3b2543e8783e370a21662cee062' THEN
  RAISE EXCEPTION 'repair_claim_bridge_code drift: review live catalog before applying';
 END IF;
 IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.generate_bridge_pairing_code(uuid)'))
   IS DISTINCT FROM '0ce2c5f8fb7f9b867b0fb2f51ad9ae59' THEN
  RAISE EXCEPTION 'generate_bridge_pairing_code drift: review live catalog before applying';
 END IF;
 IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.regenerate_ingest_token(uuid)'))
   IS DISTINCT FROM 'f0cf161384f1609e690b03be92ce6174' THEN
  RAISE EXCEPTION 'regenerate_ingest_token drift: review live catalog before applying';
 END IF;
 -- 05_bridge.sql ACL state for the old claim routine: service only.
 IF pg_catalog.has_function_privilege('anon','public.repair_claim_bridge_code(text,text)','EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated','public.repair_claim_bridge_code(text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'repair_claim_bridge_code ACL drift';
 END IF;
 -- One integration per event is what makes ON CONFLICT(event_id) and token rotation exact.
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
   WHERE i.indexrelid=to_regclass('public.repair_one_integration_per_event') AND i.indrelid='public.event_integrations'::regclass
   AND i.indisunique AND i.indisvalid AND i.indnkeyatts=1 AND i.indpred IS NULL AND a.attname='event_id') THEN
  RAISE EXCEPTION 'repair_one_integration_per_event missing or different';
 END IF;
 IF EXISTS(SELECT 1 FROM public.event_integrations GROUP BY event_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Multiple integration rows: preserve evidence and resolve independently';
 END IF;
 -- A token must identify exactly one integration, or revoke and ingest could act on the wrong event.
 IF EXISTS(SELECT 1 FROM public.event_integrations WHERE ingest_token IS NOT NULL GROUP BY ingest_token HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Duplicate ingest tokens: preserve evidence and resolve independently';
 END IF;
 IF to_regclass('public.bridge_ingest_token_unique') IS NOT NULL THEN RAISE EXCEPTION 'bridge_ingest_token_unique already exists'; END IF;
 SELECT count(*) INTO expected_columns FROM information_schema.columns c WHERE c.table_schema='public' AND (c.table_name,c.column_name,c.data_type) IN (
  ('events','id','uuid'),('events','dj_id','uuid'),('events','name','text'),('events','is_active','boolean'),
  ('events','ended_at','timestamp with time zone'),('events','requests_status','text'),
  ('event_integrations','event_id','uuid'),('event_integrations','source_type','text'),('event_integrations','ingest_token','text'),
  ('event_integrations','updated_at','timestamp with time zone'),
  ('bridge_pairing_codes','code','text'),('bridge_pairing_codes','event_id','uuid'),('bridge_pairing_codes','claimed_at','timestamp with time zone'));
 IF expected_columns<>13 THEN RAISE EXCEPTION 'Bridge/event column drift: % of 13 expected columns found',expected_columns; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.bridge_pairing_codes'::regclass AND conname='bridge_pairing_codes_v1_retired') THEN
  RAISE EXCEPTION 'Legacy pairing table is already sealed';
 END IF;
END $guard$;

-- ── 2. Private v2 pairing store: hashes only, no client access ──
CREATE TABLE public.bridge_pairing_v2(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 protocol_version smallint NOT NULL DEFAULT 2 CONSTRAINT bridge_pairing_v2_protocol CHECK(protocol_version=2),
 code_hash bytea NOT NULL CONSTRAINT bridge_pairing_v2_code_hash_key UNIQUE CONSTRAINT bridge_pairing_v2_code_hash_len CHECK(octet_length(code_hash)=32),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 claimed_at timestamptz,
 claim_nonce_hash bytea,
 claim_token_hash bytea,
 retry_until timestamptz,
 CONSTRAINT bridge_pairing_v2_claim_shape CHECK(
  (claimed_at IS NULL AND claim_nonce_hash IS NULL AND claim_token_hash IS NULL AND retry_until IS NULL)
  OR (claimed_at IS NOT NULL AND claim_nonce_hash IS NOT NULL AND octet_length(claim_nonce_hash)=32
      AND claim_token_hash IS NOT NULL AND octet_length(claim_token_hash)=32 AND retry_until IS NOT NULL))
);
CREATE INDEX bridge_pairing_v2_event ON public.bridge_pairing_v2(event_id);
ALTER TABLE public.bridge_pairing_v2 ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. Only the SECURITY DEFINER routines below (owner) touch this table.
REVOKE ALL ON TABLE public.bridge_pairing_v2 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.bridge_pairing_v2 IS 'Bridge Pairing Protocol v2. SHA-256 of pairing secret, client nonce and issued token only; never plaintext.';

-- One token, one integration: enforced, not assumed. The non-unique event_integrations_token_idx is left as it is.
CREATE UNIQUE INDEX bridge_ingest_token_unique ON public.event_integrations(ingest_token) WHERE ingest_token IS NOT NULL;

-- ── 3. Retire Protocol v1: no stored six-digit code, no way to store or claim one ──
DELETE FROM public.bridge_pairing_codes;
ALTER TABLE public.bridge_pairing_codes ADD CONSTRAINT bridge_pairing_codes_v1_retired CHECK(false);
-- Signature kept so the installed containment script (rollback/01_contain.sql) still resolves it.
CREATE OR REPLACE FUNCTION public.repair_claim_bridge_code(_code text,_ip text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT '{"ok":false,"reason":"unavailable"}'::jsonb
$$;

-- ── 4. Owner-only generation: plaintext leaves the database exactly once, to the event owner ──
CREATE OR REPLACE FUNCTION public.generate_bridge_pairing_code(_event_id uuid)
RETURNS TABLE(code text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 uid uuid := auth.uid();
 alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
 bits bit(80);
 canonical text;
 expiry timestamptz;
 attempts integer := 0;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 -- Event row first: same order as claim, revoke, rotation and ingest.
 PERFORM 1 FROM public.events e WHERE e.id=_event_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=_event_id AND e.dj_id=uid) THEN
  RAISE EXCEPTION 'Not the DJ for this event' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.event_integrations(event_id,source_type)
 SELECT _event_id,'bridge' WHERE NOT EXISTS(SELECT 1 FROM public.event_integrations ei WHERE ei.event_id=_event_id);
 -- A new code supersedes every unclaimed one. Claimed rows stay for their retry window, then age out.
 DELETE FROM public.bridge_pairing_v2 p
 WHERE p.event_id=_event_id AND (p.claimed_at IS NULL OR p.created_at<clock_timestamp()-interval '1 hour');
 LOOP
  attempts:=attempts+1;
  -- 10 random bytes = 80 bits = sixteen 5-bit symbols: no modulo, no bias.
  bits:=('x'||encode(extensions.gen_random_bytes(10),'hex'))::bit(80);
  canonical:='';
  FOR i IN 0..15 LOOP
   canonical:=canonical||substr(alphabet,substring(bits FROM i*5+1 FOR 5)::integer+1,1);
  END LOOP;
  expiry:=clock_timestamp()+interval '5 minutes';
  BEGIN
   INSERT INTO public.bridge_pairing_v2(code_hash,event_id,created_by,expires_at)
   VALUES(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),_event_id,uid,expiry);
   EXIT;
  EXCEPTION WHEN unique_violation THEN
   IF attempts>=3 THEN RAISE EXCEPTION 'Could not allocate pairing code'; END IF;
  END;
 END LOOP;
 code:=substr(canonical,1,4)||'-'||substr(canonical,5,4)||'-'||substr(canonical,9,4)||'-'||substr(canonical,13,4);
 expires_at:=expiry;
 RETURN NEXT;
END $$;

-- ── 5. Service-only atomic claim with token rotation and same-nonce retry ──
CREATE FUNCTION public.bridge_pair_claim_v2(_code text,_client_nonce text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 h bytea; nh bytea; eid uuid; pc public.bridge_pairing_v2; ts timestamptz;
 token text; current_token text; ename text;
BEGIN
 <<attempt>>
 BEGIN
  -- Canonical form only: the Edge Function normalizes. Anything else is an invalid attempt.
  IF _code IS NULL OR _code !~ '^[0-9A-HJKMNP-TV-Z]{16}$'
   OR _client_nonce IS NULL OR _client_nonce !~ '^[A-Za-z0-9_-]{22,64}$' THEN EXIT attempt; END IF;
  h:=extensions.digest(convert_to(_code,'UTF8'),'sha256');
  nh:=extensions.digest(convert_to(_client_nonce,'UTF8'),'sha256');
  -- Find the event without locking the code; then event row before code row.
  SELECT p.event_id INTO eid FROM public.bridge_pairing_v2 p WHERE p.code_hash=h;
  IF eid IS NULL THEN EXIT attempt; END IF;
  PERFORM 1 FROM public.events e WHERE e.id=eid AND e.is_active AND e.ended_at IS NULL AND e.requests_status<>'ended' FOR UPDATE;
  IF NOT FOUND THEN EXIT attempt; END IF;
  SELECT p.* INTO pc FROM public.bridge_pairing_v2 p WHERE p.code_hash=h AND p.event_id=eid FOR UPDATE;
  IF pc.id IS NULL OR pc.protocol_version<>2 THEN EXIT attempt; END IF;
  ts:=clock_timestamp();
  IF pc.claimed_at IS NULL THEN
   IF pc.expires_at<=ts OR NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=eid AND e.dj_id=pc.created_by) THEN EXIT attempt; END IF;
   -- First claim: every earlier token for this event stops working here.
   token:=encode(extensions.gen_random_bytes(32),'hex');
   INSERT INTO public.event_integrations(event_id,source_type,ingest_token) VALUES(eid,'bridge',token)
   ON CONFLICT(event_id) DO UPDATE SET source_type='bridge',ingest_token=EXCLUDED.ingest_token,updated_at=clock_timestamp();
   UPDATE public.bridge_pairing_v2 p SET claimed_at=ts,claim_nonce_hash=nh,
    claim_token_hash=extensions.digest(convert_to(token,'UTF8'),'sha256'),retry_until=ts+interval '2 minutes'
   WHERE p.id=pc.id AND p.claimed_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Claim changed'; END IF;
  ELSE
   -- Retry: same nonce, inside the window, and the token issued by that claim is still the current one.
   IF pc.claim_nonce_hash IS DISTINCT FROM nh OR pc.retry_until<=ts THEN EXIT attempt; END IF;
   SELECT ei.ingest_token INTO current_token FROM public.event_integrations ei WHERE ei.event_id=eid;
   IF current_token IS NULL OR extensions.digest(convert_to(current_token,'UTF8'),'sha256') IS DISTINCT FROM pc.claim_token_hash THEN EXIT attempt; END IF;
   token:=current_token;
  END IF;
  SELECT e.name INTO ename FROM public.events e WHERE e.id=eid;
  RETURN jsonb_build_object('ok',true,'event_id',eid,'event_name',ename,'ingest_token',token);
 END attempt;
 -- One uniform refusal for malformed, unknown, expired and claimed attempts. Nothing is
 -- written, counted or consulted here: a refusal has no lasting effect on any later claim.
 RETURN '{"ok":false}'::jsonb;
END $$;

-- ── 6. Service-only revoke: the presented token can retire only its own integration ──
CREATE FUNCTION public.bridge_revoke_v2(_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid;
BEGIN
 -- Exactly a legacy 48-character or a v2 64-character lowercase hexadecimal token; same rule as the Edge Function.
 IF _token IS NULL OR _token !~ '^([0-9a-f]{48}|[0-9a-f]{64})$' THEN RETURN false; END IF;
 SELECT ei.event_id INTO eid FROM public.event_integrations ei WHERE ei.ingest_token=_token;
 IF eid IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM public.events e WHERE e.id=eid FOR UPDATE;
 -- Re-checked under the event lock: a concurrent rotation wins and this call revokes nothing.
 UPDATE public.event_integrations ei SET ingest_token=encode(extensions.gen_random_bytes(32),'hex'),updated_at=clock_timestamp()
 WHERE ei.event_id=eid AND ei.ingest_token=_token;
 RETURN FOUND;
END $$;

-- ── 7. Owner rotation also retires v2 codes; fixed search_path and qualified references ──
CREATE OR REPLACE FUNCTION public.regenerate_ingest_token(_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.events e WHERE e.id=_event_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=_event_id AND e.dj_id=uid) THEN
  RAISE EXCEPTION 'Not the DJ for this event' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.event_integrations(event_id,source_type,ingest_token)
 VALUES(_event_id,'bridge',encode(extensions.gen_random_bytes(32),'hex'))
 ON CONFLICT(event_id) DO UPDATE SET ingest_token=EXCLUDED.ingest_token,updated_at=clock_timestamp();
 DELETE FROM public.bridge_pairing_v2 p WHERE p.event_id=_event_id;
END $$;

-- ── 8. Grants: strip every API role first, then grant the intended end state and nothing else ──
REVOKE ALL ON FUNCTION public.bridge_pair_claim_v2(text,text),public.bridge_revoke_v2(text),
 public.generate_bridge_pairing_code(uuid),public.regenerate_ingest_token(uuid),public.repair_claim_bridge_code(text,text)
FROM PUBLIC,anon,authenticated,service_role;
-- Claim and revoke: service role only.
GRANT EXECUTE ON FUNCTION public.bridge_pair_claim_v2(text,text),public.bridge_revoke_v2(text) TO service_role;
-- Generation and owner rotation: authenticated only (each checks event ownership itself).
GRANT EXECUTE ON FUNCTION public.generate_bridge_pairing_code(uuid),public.regenerate_ingest_token(uuid) TO authenticated;
-- The retired six-digit routine: nobody.

-- ── 9. Post-apply gate: the transaction fails unless the security properties hold ──
DO $verify$
DECLARE f record; trusted constant text := 'postgres'; t record;
BEGIN
 IF pg_catalog.current_setting('bridge_pairing_v2.single_transaction',true) IS DISTINCT FROM '10_bridge_pairing_security' THEN
  RAISE EXCEPTION 'Not running as one transaction: post-apply gate refuses';
 END IF;
 IF current_user<>trusted THEN RAISE EXCEPTION 'Post-apply gate must run as the trusted owner'; END IF;
 -- Exact catalog ACLs: the complete set of non-owner grantees of each routine must equal the intended set.
 FOR f IN SELECT p.oid,p.oid::regprocedure AS signature,p.prosecdef,p.proconfig,p.proacl,pg_catalog.pg_get_userbyid(p.proowner) AS owner,
   coalesce((SELECT array_agg(DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END
             ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END)
             FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee<>p.proowner),ARRAY[]::text[]) AS grantees,
   CASE WHEN p.oid IN ('public.bridge_pair_claim_v2(text,text)'::regprocedure,'public.bridge_revoke_v2(text)'::regprocedure) THEN ARRAY['service_role']
        WHEN p.oid IN ('public.generate_bridge_pairing_code(uuid)'::regprocedure,'public.regenerate_ingest_token(uuid)'::regprocedure) THEN ARRAY['authenticated']
        ELSE ARRAY[]::text[] END AS intended,
   p.oid<>'public.repair_claim_bridge_code(text,text)'::regprocedure AS definer_expected
  FROM pg_catalog.pg_proc p
  WHERE p.oid IN ('public.bridge_pair_claim_v2(text,text)'::regprocedure,'public.bridge_revoke_v2(text)'::regprocedure,
   'public.generate_bridge_pairing_code(uuid)'::regprocedure,'public.regenerate_ingest_token(uuid)'::regprocedure,
   'public.repair_claim_bridge_code(text,text)'::regprocedure) LOOP
  IF f.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'Unsafe search_path on %',f.signature; END IF;
  IF f.owner<>trusted THEN RAISE EXCEPTION 'Untrusted owner % on %',f.owner,f.signature; END IF;
  IF f.prosecdef IS DISTINCT FROM f.definer_expected THEN RAISE EXCEPTION 'Unexpected security mode on %',f.signature; END IF;
  -- A NULL ACL is the built-in default, which grants EXECUTE to PUBLIC.
  IF f.proacl IS NULL THEN RAISE EXCEPTION 'Default (PUBLIC) ACL on %',f.signature; END IF;
  IF f.grantees IS DISTINCT FROM f.intended THEN RAISE EXCEPTION 'Unexpected grantees % on % (intended %)',f.grantees,f.signature,f.intended; END IF;
  IF pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'anon can execute %',f.signature; END IF;
 END LOOP;
 SELECT c.relacl,pg_catalog.pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,
   (SELECT count(*) FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee<>c.relowner) AS foreign_grants,
   (SELECT count(*) FROM pg_catalog.pg_policy pol WHERE pol.polrelid=c.oid) AS policies
 INTO t FROM pg_catalog.pg_class c WHERE c.oid='public.bridge_pairing_v2'::regclass;
 IF t.owner<>trusted OR NOT t.relrowsecurity OR t.policies<>0 OR t.relacl IS NULL OR t.foreign_grants<>0 THEN
  RAISE EXCEPTION 'Private pairing store has an unexpected owner, policy or grantee';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid='public.bridge_ingest_token_unique'::regclass
    AND i.indrelid='public.event_integrations'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL) THEN
  RAISE EXCEPTION 'Ingest token uniqueness is not enforced';
 END IF;
 IF pg_catalog.has_function_privilege('authenticated','public.bridge_pair_claim_v2(text,text)','EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated','public.bridge_revoke_v2(text)','EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated','public.repair_claim_bridge_code(text,text)','EXECUTE')
  OR pg_catalog.has_function_privilege('service_role','public.repair_claim_bridge_code(text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Service-only or retired routine is exposed';
 END IF;
 IF NOT pg_catalog.has_function_privilege('service_role','public.bridge_pair_claim_v2(text,text)','EXECUTE')
  OR NOT pg_catalog.has_function_privilege('service_role','public.bridge_revoke_v2(text)','EXECUTE')
  OR NOT pg_catalog.has_function_privilege('authenticated','public.generate_bridge_pairing_code(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Required grant missing';
 END IF;
 IF pg_catalog.has_table_privilege('anon','public.bridge_pairing_v2','SELECT') OR pg_catalog.has_table_privilege('authenticated','public.bridge_pairing_v2','SELECT')
  OR pg_catalog.has_table_privilege('service_role','public.bridge_pairing_v2','SELECT') THEN
  RAISE EXCEPTION 'Private pairing store is readable by an API role';
 END IF;
 IF EXISTS(SELECT 1 FROM public.bridge_pairing_codes) THEN RAISE EXCEPTION 'Legacy pairing codes remain'; END IF;
END $verify$;

-- ── Containment / rollback (reviewed companion: rollback/10_bridge_pairing_contain.sql) ──
-- Boundary: executed as one transaction (the only supported way), a failure before COMMIT
-- leaves the installed state untouched. After COMMIT there is no path back to six-digit pairing: the legacy rows are gone,
-- the legacy table is sealed and the old claim routine is a constant refusal. The companion
-- script revokes generation and claim from every role and deletes unclaimed codes, which stops
-- new pairing while leaving token revocation, owner rotation, ingest and already paired
-- devices working. Re-enabling means re-granting the two v2 routines listed there, nothing else.
