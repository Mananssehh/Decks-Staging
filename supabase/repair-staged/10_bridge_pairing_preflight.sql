-- READ ONLY hosted preflight for 10_bridge_pairing_security.sql. NOT YET EXECUTED ANYWHERE HOSTED.
-- Purpose: obtain, with a read-only database tool, the exact hosted values that the migration's
-- fail-closed guards compare, and the aggregate size of the destructive cutover, before the
-- migration is attempted.
-- Five statements; every one begins with SELECT and can be run on its own. They read catalog
-- metadata (signatures, owners, settings, ACLs, definitions, hashes) and aggregate counts only.
-- They execute no application function and return no application row, token, pairing code,
-- event identifier or user identifier. Application tables appear only inside count(*).
--
-- REQUIRED RESULT before the migration may be executed: statement 1 returns exactly 16 rows and
-- every row has result = 'MATCH'. Expected values, row by row:
--   01 v2_objects_absent            absent
--   02 api_roles_present            3
--   03 pgcrypto_in_extensions       present
--   04 auth_uid_present             present
--   05 md5_repair_claim_bridge_code fb34e3b2543e8783e370a21662cee062
--   06 md5_generate_pairing_code    0ce2c5f8fb7f9b867b0fb2f51ad9ae59
--   07 md5_regenerate_ingest_token  f0cf161384f1609e690b03be92ce6174
--   08 old_claim_closed_to_clients  closed
--   09 one_integration_index        present
--   10 duplicate_integrations       0
--   11 expected_columns             13
--   12 legacy_table_not_sealed      unsealed
--   13 duplicate_token_groups       0
--   14 token_unique_index_absent    absent
--   15 prior_routine_owners         postgres
--   16 bridge_table_owners          postgres
-- Rows 05-07 are md5 of pg_proc.prosrc as installed by 05_bridge.sql. If one differs, the hosted
-- body was changed (or stored with different whitespace or line endings) after capture: STOP,
-- compare statement 4's definition with 05_bridge.sql, and have the guard value re-reviewed.
-- Row 13: a nonzero count means two integrations share a token; the migration refuses to run.
-- Rows 15-16: 'postgres' is the owner recorded in evidence/function-dependencies.txt for every
-- captured application function. The table owners are NOT in the captured evidence, so row 16 is
-- an expectation that only this hosted preflight can confirm.
-- Never edit a guard to match an unexplained difference and never bypass the guards.
--
-- STILL REQUIRES HOSTED EVIDENCE (cannot be established from the repository):
--   * Statement 2: the role that will run the migration. The migration fails closed unless its
--     current_user is 'postgres' and owns the prior routines and tables. A read-only tool may
--     connect as a different role, so its current_user here is informative, not proof.
--   * That the migration runner executes the complete file in ONE transaction (see the contract).
--   * Statement 3: how many live legacy codes and paired devices the cutover will invalidate.

-- ── Statement 1: guard inputs versus expected values ──
SELECT lpad(checks.ord::text,2,'0') AS ord, checks.check_name, checks.expected, checks.actual,
       CASE WHEN checks.actual=checks.expected THEN 'MATCH' ELSE 'MISMATCH' END AS result
FROM (VALUES
 (1,'v2_objects_absent','absent',
  CASE WHEN pg_catalog.to_regclass('public.bridge_pairing_v2') IS NULL
        AND pg_catalog.to_regprocedure('public.bridge_pair_claim_v2(text,text)') IS NULL
        AND pg_catalog.to_regprocedure('public.bridge_revoke_v2(text)') IS NULL THEN 'absent' ELSE 'present' END),
 (2,'api_roles_present','3',
  (SELECT count(*)::text FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role'))),
 (3,'pgcrypto_in_extensions','present',
  CASE WHEN pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL
        AND pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL THEN 'present' ELSE 'missing' END),
 (4,'auth_uid_present','present',
  CASE WHEN pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL THEN 'present' ELSE 'missing' END),
 (5,'md5_repair_claim_bridge_code','fb34e3b2543e8783e370a21662cee062',
  coalesce((SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.repair_claim_bridge_code(text,text)')),'missing')),
 (6,'md5_generate_pairing_code','0ce2c5f8fb7f9b867b0fb2f51ad9ae59',
  coalesce((SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.generate_bridge_pairing_code(uuid)')),'missing')),
 (7,'md5_regenerate_ingest_token','f0cf161384f1609e690b03be92ce6174',
  coalesce((SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.regenerate_ingest_token(uuid)')),'missing')),
 (8,'old_claim_closed_to_clients','closed',
  coalesce((SELECT CASE WHEN pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
                        THEN 'exposed' ELSE 'closed' END
            FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.repair_claim_bridge_code(text,text)')),'missing')),
 (9,'one_integration_index','present',
  CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
        WHERE i.indexrelid=pg_catalog.to_regclass('public.repair_one_integration_per_event') AND i.indrelid=pg_catalog.to_regclass('public.event_integrations')
        AND i.indisunique AND i.indisvalid AND i.indnkeyatts=1 AND i.indpred IS NULL AND a.attname='event_id') THEN 'present' ELSE 'missing' END),
 (10,'duplicate_integrations','0',
  (SELECT count(*)::text FROM (SELECT count(*) FROM public.event_integrations GROUP BY event_id HAVING count(*)>1) duplicate_event_groups)),
 (11,'expected_columns','13',
  (SELECT count(*)::text FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
   AND (c.relname,a.attname,pg_catalog.format_type(a.atttypid,NULL)) IN (
    ('events','id','uuid'),('events','dj_id','uuid'),('events','name','text'),('events','is_active','boolean'),
    ('events','ended_at','timestamp with time zone'),('events','requests_status','text'),
    ('event_integrations','event_id','uuid'),('event_integrations','source_type','text'),('event_integrations','ingest_token','text'),
    ('event_integrations','updated_at','timestamp with time zone'),
    ('bridge_pairing_codes','code','text'),('bridge_pairing_codes','event_id','uuid'),('bridge_pairing_codes','claimed_at','timestamp with time zone')))),
 (12,'legacy_table_not_sealed','unsealed',
  CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=pg_catalog.to_regclass('public.bridge_pairing_codes')
        AND k.conname='bridge_pairing_codes_v1_retired') THEN 'sealed' ELSE 'unsealed' END),
 (13,'duplicate_token_groups','0',
  (SELECT count(*)::text FROM (SELECT count(*) FROM public.event_integrations WHERE ingest_token IS NOT NULL GROUP BY ingest_token HAVING count(*)>1) duplicate_token_groups)),
 (14,'token_unique_index_absent','absent',
  CASE WHEN pg_catalog.to_regclass('public.bridge_ingest_token_unique') IS NULL THEN 'absent' ELSE 'present' END),
 (15,'prior_routine_owners','postgres',
  coalesce((SELECT pg_catalog.string_agg(DISTINCT pg_catalog.pg_get_userbyid(p.proowner),',' ORDER BY pg_catalog.pg_get_userbyid(p.proowner)) FROM pg_catalog.pg_proc p
            WHERE p.oid IN (pg_catalog.to_regprocedure('public.repair_claim_bridge_code(text,text)'),pg_catalog.to_regprocedure('public.generate_bridge_pairing_code(uuid)'),
                            pg_catalog.to_regprocedure('public.regenerate_ingest_token(uuid)'))),'missing')),
 (16,'bridge_table_owners','postgres',
  coalesce((SELECT pg_catalog.string_agg(DISTINCT pg_catalog.pg_get_userbyid(c.relowner),',' ORDER BY pg_catalog.pg_get_userbyid(c.relowner)) FROM pg_catalog.pg_class c
            WHERE c.oid IN (pg_catalog.to_regclass('public.events'),pg_catalog.to_regclass('public.event_integrations'),pg_catalog.to_regclass('public.bridge_pairing_codes'))),'missing'))
) AS checks(ord, check_name, expected, actual)
ORDER BY checks.ord;

-- ── Statement 2: identity of THIS session (informative; see "still requires hosted evidence") ──
SELECT current_user AS preflight_current_user, session_user AS preflight_session_user,
       (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname=current_user) AS current_user_is_superuser,
       pg_catalog.pg_has_role(current_user,'postgres','MEMBER') AS current_user_member_of_postgres,
       pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
       pg_catalog.current_setting('server_version') AS server_version;

-- ── Statement 3: size of the destructive cutover, as counts only ──
-- legacy_pairing_rows are deleted; live_unclaimed_legacy_codes stop working at install;
-- every counted token keeps working until its event next pairs, is rotated or is revoked.
SELECT
 (SELECT count(*) FROM public.bridge_pairing_codes) AS legacy_pairing_rows,
 (SELECT count(*) FROM public.bridge_pairing_codes WHERE claimed_at IS NULL AND expires_at>pg_catalog.now()) AS live_unclaimed_legacy_codes,
 (SELECT count(*) FROM public.event_integrations) AS integrations_total,
 (SELECT count(*) FROM public.event_integrations WHERE source_type='bridge') AS bridge_integrations,
 (SELECT count(*) FROM public.event_integrations WHERE ingest_token IS NOT NULL) AS non_null_tokens,
 (SELECT count(*) FROM (SELECT count(*) FROM public.event_integrations WHERE ingest_token IS NOT NULL GROUP BY ingest_token HAVING count(*)>1) duplicate_token_groups) AS duplicate_token_groups,
 (SELECT count(*) FROM public.event_integrations WHERE ingest_token ~ '^[0-9a-f]{48}$') AS tokens_legacy_48_hex,
 (SELECT count(*) FROM public.event_integrations WHERE ingest_token ~ '^[0-9a-f]{64}$') AS tokens_v2_64_hex,
 (SELECT count(*) FROM public.event_integrations WHERE ingest_token IS NOT NULL AND ingest_token !~ '^([0-9a-f]{48}|[0-9a-f]{64})$') AS tokens_not_revocable_by_device;

-- ── Statement 4: routine metadata and definitions for review (no execution) ──
SELECT p.oid::regprocedure AS signature,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS settings,
       p.proacl AS acl,
       pg_catalog.md5(p.prosrc) AS body_md5,
       pg_catalog.length(p.prosrc) AS body_chars,
       pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
AND p.proname IN ('repair_claim_bridge_code','generate_bridge_pairing_code','regenerate_ingest_token','get_ingest_token',
                  'repair_write_broadcast','bridge_pair_claim_v2','bridge_revoke_v2')
ORDER BY 1;

-- ── Statement 5: table owners, ACLs, RLS flags, policy and index names (metadata only) ──
SELECT c.oid::regclass AS relation, pg_catalog.pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls_enabled, c.relacl AS acl,
       (SELECT pg_catalog.array_agg(pol.polname ORDER BY pol.polname) FROM pg_catalog.pg_policy pol WHERE pol.polrelid=c.oid) AS policies,
       (SELECT pg_catalog.array_agg(i.indexrelid::regclass::text ORDER BY i.indexrelid::regclass::text) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid) AS indexes
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('events','bridge_pairing_codes','bridge_pair_attempts','event_integrations','bridge_pairing_v2')
ORDER BY 1;
