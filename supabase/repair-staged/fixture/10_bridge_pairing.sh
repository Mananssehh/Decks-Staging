#!/usr/bin/env bash
# Bridge Pairing Protocol v2 — disposable local PostgreSQL fixture. psql only: no Node/Bun/Deno
# dependency and no remote connection string is read. Run as a non-root account:
#   setpriv --reuid=1000 --regid=1000 --clear-groups bash supabase/repair-staged/fixture/10_bridge_pairing.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
command -v initdb >/dev/null || PATH="$(pg_config --bindir):$PATH"
unset PGHOSTADDR PGSERVICE PGPASSWORD DATABASE_URL SUPABASE_DB_URL
WORK="$(mktemp -d "${TMPDIR:-/tmp}/decks-bridge-v2-pg.XXXXXX")"
export PGHOST="$WORK/socket" PGPORT=55440 PGUSER=postgres PGDATABASE=decks_bridge_v2
mkdir "$PGHOST"
initdb -D "$WORK/data" -U postgres --auth=trust >"$WORK/init.log"
pg_ctl -D "$WORK/data" -o "-k $PGHOST -p $PGPORT -c listen_addresses='' -c max_connections=120" -w start >"$WORK/start.log"
trap 'pg_ctl -D "$WORK/data" -m immediate stop >/dev/null; rm -rf "$WORK"' EXIT
createdb "$PGDATABASE"
run_file(){ psql -X -v ON_ERROR_STOP=1 "$@" >"$WORK/last.log" 2>&1; }
run_file -f "$HERE/00_fixture.sql" || { cat "$WORK/last.log"; exit 1; }
run_file -f "$HERE/../00_preflight.sql" || { cat "$WORK/last.log"; exit 1; }
files=(); for sql in "$HERE"/../0[1-6]_*.sql; do files+=(-f "$sql"); done
run_file --single-transaction "${files[@]}" || { cat "$WORK/last.log"; exit 1; }

MIGRATION="$HERE/../10_bridge_pairing_security.sql"
CONTAIN="$HERE/../rollback/10_bridge_pairing_contain.sql"
checks=0
pass(){ checks=$((checks+1)); echo "PASS $1"; }
fail(){ echo "FAIL $1"; exit 1; }
check(){ if [ "$2" = "$3" ]; then pass "$1"; else echo "FAIL $1: expected [$3] got [$2]"; exit 1; fi; }
q(){ psql -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
as_user(){ psql -X -q -At -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='$1';
$2
COMMIT;
SQL
}
as_role(){ psql -X -q -At -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL ROLE $1;
SET LOCAL request.jwt.claim.role='$1';
$2
COMMIT;
SQL
}
denied(){ local label="$1"; shift; if "$@" >/dev/null 2>&1; then fail "$label unexpectedly accepted"; else pass "$label"; fi; }
canon(){ printf %s "$1" | tr -d -- '-'; }
claim(){ as_role service_role "SELECT public.bridge_pair_claim_v2('$1','$2');"; }
field(){ q "SELECT ('$1'::jsonb)->>'$2'"; }
nonce(){ printf 'fixture-nonce-%08d-aaaaaaaa' "$1"; }

OWNER=00000000-0000-0000-0000-000000000011
OTHER=00000000-0000-0000-0000-000000000012
E1=00000000-0000-0000-0000-000000001001
E2=00000000-0000-0000-0000-000000001002
E3=00000000-0000-0000-0000-000000001003
q "INSERT INTO auth.users(id) VALUES('$OWNER'),('$OTHER')"
q "INSERT INTO public.events(id,dj_id,name,dj_name,room_code) VALUES('$E1','$OWNER','Fixture One','DJ','BRV201'),('$E2','$OWNER','Fixture Two','DJ','BRV202'),('$E3','$OTHER','Fixture Three','DJ','BRV203')"
q "INSERT INTO public.event_integrations(event_id,source_type) VALUES('$E3','manual'),('$E2','manual')"
DUPTOKEN=abababababababababababababababababababababababab
q "INSERT INTO public.bridge_pairing_codes(code,event_id,created_by,expires_at) VALUES('123456','$E1','$OWNER',now()+interval '5 minutes')"
ACL_BEFORE="$(q "SELECT string_agg(c.relname||'='||coalesce(c.relacl::text,''),';' ORDER BY c.relname) FROM pg_class c WHERE c.oid IN ('public.bridge_pairing_codes'::regclass,'public.bridge_pair_attempts'::regclass,'public.event_integrations'::regclass)")"

# ── Read-only preflight artifact agrees with the drift guards on the expected prior state ──
PREFLIGHT="$HERE/../10_bridge_pairing_preflight.sql"
psql -X -q -At -v ON_ERROR_STOP=1 -f "$PREFLIGHT" >"$WORK/preflight.out" 2>"$WORK/preflight.err" || { cat "$WORK/preflight.err"; fail 'preflight artifact failed to run'; }
check 'preflight: sixteen guard inputs all MATCH on the expected prior state' "$(grep -c '|MATCH$' "$WORK/preflight.out")" 16
check 'preflight: no MISMATCH rows' "$(grep -c '|MISMATCH$' "$WORK/preflight.out" || true)" 0
check 'preflight is read-only (runs inside a read-only transaction)' "$(PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At -v ON_ERROR_STOP=1 -f "$PREFLIGHT" 2>&1 | grep -c '|MATCH$')" 16
check 'preflight output carries no stored token or legacy code' "$(grep -c -e "$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E3'")" -e '123456' "$WORK/preflight.out" || true)" 0
psql -X -q -At -v ON_ERROR_STOP=1 >"$WORK/preflight.drift" 2>&1 <<SQL
BEGIN;
CREATE OR REPLACE FUNCTION public.regenerate_ingest_token(_event_id uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
\\i $PREFLIGHT
ROLLBACK;
SQL
check 'preflight: a drifted prior function is reported as MISMATCH' "$(grep '|MISMATCH$' "$WORK/preflight.drift" | cut -d'|' -f2)" md5_regenerate_ingest_token
check 'preflight drift probe rolled back' "$(psql -X -q -At -f "$PREFLIGHT" | grep -c '|MATCH$')" 16
# Duplicate ingest tokens: reported by the preflight as a count only, and refused by the migration.
psql -X -q -At -v ON_ERROR_STOP=1 >"$WORK/preflight.dup" 2>&1 <<SQL
BEGIN;
UPDATE public.event_integrations SET ingest_token='$DUPTOKEN' WHERE event_id IN ('$E2','$E3');
\\i $PREFLIGHT
ROLLBACK;
SQL
check 'preflight: duplicate tokens reported as MISMATCH with a count of 1' "$(grep '|MISMATCH$' "$WORK/preflight.dup" | cut -d'|' -f2,4)" 'duplicate_token_groups|1'
check 'preflight: cutover counts report the duplicate group as a number' "$(grep -c '^1|1|2|0|2|1|' "$WORK/preflight.dup")" 1
check 'preflight never prints a token, legacy code, event id or user id' "$(grep -c -e "$DUPTOKEN" -e '123456' -e "$E1" -e "$E2" -e "$E3" -e "$OWNER" -e "$OTHER" "$WORK/preflight.dup" "$WORK/preflight.out" | awk -F: '{n+=$2} END{print n}')" 0
check 'preflight cutover counts on the prior state (legacy rows, live legacy codes, integrations, bridge, tokens, duplicates, 48-hex, 64-hex, other)' "$(grep -c '^1|1|2|0|2|0|2|0|0$' "$WORK/preflight.out")" 1
if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -c "UPDATE public.event_integrations SET ingest_token='$DUPTOKEN' WHERE event_id IN ('$E2','$E3')" -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'duplicate tokens accepted'; fi
if grep -q 'Duplicate ingest tokens' "$WORK/drift.log"; then pass 'migration refuses to run while two integrations share a token'; else fail 'migration refuses to run while two integrations share a token'; fi
# Not one transaction: the marker guard stops before anything is changed.
if psql -X -q -v ON_ERROR_STOP=1 -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'statement-by-statement execution accepted'; fi
if grep -q 'Not running as one transaction' "$WORK/drift.log"; then pass 'migration refuses statement-by-statement (autocommit) execution'; else fail 'migration refuses statement-by-statement (autocommit) execution'; fi
check 'autocommit attempt left nothing behind' "$(q "SELECT (to_regclass('public.bridge_pairing_v2') IS NULL AND to_regclass('public.bridge_ingest_token_unique') IS NULL AND (SELECT count(*) FROM public.bridge_pairing_codes)=1)")" t
# Untrusted executor and unexpected grantee.
if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -c "SET ROLE supabase_admin" -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'untrusted executor accepted'; fi
if grep -q 'must run as the trusted owner' "$WORK/drift.log"; then pass 'migration refuses to run as a role other than the trusted owner'; else fail 'migration refuses to run as a role other than the trusted owner'; fi
if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -c "ALTER FUNCTION public.regenerate_ingest_token(uuid) OWNER TO supabase_admin" -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'foreign routine owner accepted'; fi
if grep -q 'Prior Bridge routine owner drift' "$WORK/drift.log"; then pass 'migration refuses a prior routine with an untrusted owner'; else fail 'migration refuses a prior routine with an untrusted owner'; fi
if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -c "CREATE ROLE fixture_rogue NOLOGIN" -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO fixture_rogue" -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'unexpected grantee accepted'; fi
if grep -q 'Unexpected grantees {fixture_rogue,service_role}' "$WORK/drift.log"; then pass 'post-apply gate fails on an unexpected non-owner grantee (aclexplode)'; else cat "$WORK/drift.log"; fail 'post-apply gate fails on an unexpected non-owner grantee (aclexplode)'; fi
check 'failed gate rolled everything back' "$(q "SELECT (to_regclass('public.bridge_pairing_v2') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fixture_rogue'))")" t

# ── Drift guards ──
if psql -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -c "CREATE OR REPLACE FUNCTION public.regenerate_ingest_token(_event_id uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void'" \
  -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'drifted prior function accepted'; fi
if grep -q 'regenerate_ingest_token drift' "$WORK/drift.log"; then pass 'drift guard stops on changed prior function'; else fail 'drift guard stops on changed prior function'; fi
check 'failed migration left nothing behind' "$(q "SELECT to_regclass('public.bridge_pairing_v2') IS NULL")" t
if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -c "DROP INDEX public.repair_one_integration_per_event" -f "$MIGRATION" >"$WORK/drift.log" 2>&1; then fail 'missing index accepted'; fi
if grep -q 'repair_one_integration_per_event missing' "$WORK/drift.log"; then pass 'drift guard stops on missing one-integration index'; else fail 'drift guard stops on missing one-integration index'; fi

# ── Apply ──
run_file --single-transaction -f "$MIGRATION" || { cat "$WORK/last.log"; exit 1; }
pass 'migration applies in one transaction with post-apply gate'
denied 'second application refused' psql -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$MIGRATION"
# ── Token uniqueness is enforced ──
denied 'duplicate ingest token rejected on UPDATE' q "UPDATE public.event_integrations SET ingest_token=(SELECT ingest_token FROM public.event_integrations WHERE event_id='$E3') WHERE event_id='$E2'"
denied 'duplicate ingest token rejected on INSERT' q "INSERT INTO public.event_integrations(event_id,source_type,ingest_token) SELECT '$E1','manual',ingest_token FROM public.event_integrations WHERE event_id='$E3'"
check 'unique partial index on non-null ingest tokens exists' "$(q "SELECT indisunique::text||(indpred IS NOT NULL)::text||pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid='public.bridge_ingest_token_unique'::regclass")" 'truetrueCREATE UNIQUE INDEX bridge_ingest_token_unique ON public.event_integrations USING btree (ingest_token) WHERE (ingest_token IS NOT NULL)'
check 'every stored token maps to exactly one integration' "$(q "SELECT count(*) FROM (SELECT 1 FROM public.event_integrations GROUP BY ingest_token HAVING count(*)>1) d")" 0

# ── Protocol v1 is gone ──
check 'legacy six-digit rows deleted' "$(q "SELECT count(*) FROM public.bridge_pairing_codes")" 0
denied 'legacy table sealed against new six-digit rows' q "INSERT INTO public.bridge_pairing_codes(code,event_id,created_by,expires_at) VALUES('654321','$E1','$OWNER',now()+interval '5 minutes')"
denied 'service role cannot call six-digit claim' as_role service_role "SELECT public.repair_claim_bridge_code('123456','x');"
check 'six-digit claim body is a constant refusal' "$(q "SELECT public.repair_claim_bridge_code('123456','x')->>'ok'")" false
check 'six-digit code refused by v2 claim' "$(claim 123456 "$(nonce 1)")" '{"ok": false}'
check 'unexpected legacy table ACLs left untouched' "$(q "SELECT string_agg(c.relname||'='||coalesce(c.relacl::text,''),';' ORDER BY c.relname) FROM pg_class c WHERE c.oid IN ('public.bridge_pairing_codes'::regclass,'public.bridge_pair_attempts'::regclass,'public.event_integrations'::regclass)")" "$ACL_BEFORE"

# ── Generation ──
GEN="$(as_user "$OWNER" "SELECT code||'|'||round(extract(epoch FROM expires_at-clock_timestamp())) FROM public.generate_bridge_pairing_code('$E1');")"
CODE="${GEN%%|*}"; C="$(canon "$CODE")"
if [[ "$CODE" =~ ^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$ ]]; then pass 'owner receives grouped 16-character Crockford code'; else fail 'owner receives grouped 16-character Crockford code'; fi
check 'expiry is five minutes' "${GEN##*|}" 300
check 'stored value is SHA-256 of canonical code' "$(q "SELECT count(*) FROM public.bridge_pairing_v2 WHERE code_hash=extensions.digest(convert_to('$C','UTF8'),'sha256') AND protocol_version=2")" 1
check 'no plaintext code in any stored column' "$(q "SELECT count(*) FROM public.bridge_pairing_v2 p WHERE p::text ILIKE '%$C%' OR p::text ILIKE '%$CODE%' OR encode(p.code_hash,'escape') ILIKE '%$C%'")" 0
check 'no plaintext code in legacy or attempt tables' "$(q "SELECT (SELECT count(*) FROM public.bridge_pairing_codes)+(SELECT count(*) FROM public.bridge_pair_attempts a WHERE a::text ILIKE '%$C%')")" 0
denied 'non-owner cannot generate' as_user "$OTHER" "SELECT * FROM public.generate_bridge_pairing_code('$E1');"
denied 'anon cannot generate' as_role anon "SELECT * FROM public.generate_bridge_pairing_code('$E1');"
denied 'service-only claim closed to authenticated' as_user "$OWNER" "SELECT public.bridge_pair_claim_v2('$C','$(nonce 2)');"
denied 'service-only claim closed to anon' as_role anon "SELECT public.bridge_pair_claim_v2('$C','$(nonce 2)');"
denied 'service-only revoke closed to authenticated' as_user "$OWNER" "SELECT public.bridge_revoke_v2('0123456789abcdef0123456789abcdef');"
denied 'private store unreadable by authenticated' as_user "$OWNER" "SELECT count(*) FROM public.bridge_pairing_v2;"
denied 'private store unreadable by service_role' as_role service_role "SELECT count(*) FROM public.bridge_pairing_v2;"
SYMBOLS="$(for i in $(seq 1 120); do as_user "$OWNER" "SELECT code FROM public.generate_bridge_pairing_code('$E2');"; done | tr -d -- '-\n' | fold -w1 | sort -u | tr -d '\n')"
check 'generator emits exactly the 32-symbol alphabet' "$SYMBOLS" '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
check 'regeneration keeps one unclaimed code per event' "$(q "SELECT count(*) FROM public.bridge_pairing_v2 WHERE event_id='$E2' AND claimed_at IS NULL")" 1
NEWGEN="$(as_user "$OWNER" "SELECT code FROM public.generate_bridge_pairing_code('$E1');")"
check 'superseded code is refused' "$(claim "$C" "$(nonce 3)")" '{"ok": false}'
CODE="$NEWGEN"; C="$(canon "$CODE")"

# ── Input form: SQL takes the canonical form only (the Edge Function normalizes) ──
for bad in "$CODE" "$(printf %s "$C" | tr 'A-Z' 'a-z')" "${C:0:15}" "${C}0" "${C:0:15}U" ''; do
 check "non-canonical input refused (${#bad} chars)" "$(claim "$bad" "$(nonce 4)")" '{"ok": false}'
done
check 'short nonce refused' "$(claim "$C" short)" '{"ok": false}'
check 'unsafe nonce characters refused' "$(claim "$C" 'nonce with spaces and $$ 0123456789')" '{"ok": false}'

# ── First claim rotates the token ──
OLD="$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")"
INTEGRATION="$(q "SELECT id FROM public.event_integrations WHERE event_id='$E1'")"
broadcast(){ as_role service_role "SELECT (public.repair_write_broadcast('$E1','{\"title\":\"Fixture\",\"artist\":\"Artist\",\"status\":\"playing\"}'::jsonb,NULL,'$INTEGRATION','$1')).event_id;"; }
check 'pre-pairing token is accepted by ingest boundary' "$(broadcast "$OLD")" "$E1"
R1="$(claim "$C" "$(nonce 10)")"
check 'valid claim succeeds' "$(field "$R1" ok)" true
T1="$(field "$R1" ingest_token)"
check 'claim returns event id' "$(field "$R1" event_id)" "$E1"
check 'claim returns event name' "$(field "$R1" event_name)" 'Fixture One'
if [[ "$T1" =~ ^[0-9a-f]{64}$ ]]; then pass 'issued token is 256 random bits, hex'; else fail 'issued token is 256 random bits, hex'; fi
if [ "$T1" != "$OLD" ]; then pass 'claim rotated the ingest token'; else fail 'claim rotated the ingest token'; fi
check 'returned token is the stored current token' "$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")" "$T1"
denied 'old token rejected at ingest boundary after rotation' broadcast "$OLD"
check 'new token accepted at ingest boundary' "$(broadcast "$T1")" "$E1"
check 'claim metadata stored as hashes only' "$(q "SELECT count(*) FROM public.bridge_pairing_v2 p WHERE p.claimed_at IS NOT NULL AND p.claim_nonce_hash=extensions.digest(convert_to('$(nonce 10)','UTF8'),'sha256') AND p.claim_token_hash=extensions.digest(convert_to('$T1','UTF8'),'sha256') AND p::text NOT ILIKE '%$T1%' AND p::text NOT ILIKE '%$(nonce 10)%'")" 1

# ── Idempotent retry rules ──
check 'same-nonce retry returns the same token' "$(field "$(claim "$C" "$(nonce 10)")" ingest_token)" "$T1"
check 'retry did not rotate again' "$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")" "$T1"
check 'different nonce cannot reclaim' "$(claim "$C" "$(nonce 11)")" '{"ok": false}'
q "UPDATE public.bridge_pairing_v2 SET retry_until=clock_timestamp()-interval '1 millisecond' WHERE code_hash=extensions.digest(convert_to('$C','UTF8'),'sha256')"
check 'same nonce refused after retry window' "$(claim "$C" "$(nonce 10)")" '{"ok": false}'
q "UPDATE public.bridge_pairing_v2 SET retry_until=clock_timestamp()+interval '2 minutes' WHERE code_hash=extensions.digest(convert_to('$C','UTF8'),'sha256')"
check 'same nonce accepted again inside window' "$(field "$(claim "$C" "$(nonce 10)")" ingest_token)" "$T1"
CODE2="$(as_user "$OWNER" "SELECT code FROM public.generate_bridge_pairing_code('$E1');")"; C2="$(canon "$CODE2")"
check 'earlier claimed row survives new generation' "$(q "SELECT count(*) FROM public.bridge_pairing_v2 WHERE event_id='$E1' AND claimed_at IS NOT NULL")" 1
T2="$(field "$(claim "$C2" "$(nonce 20)")" ingest_token)"
if [ -n "$T2" ] && [ "$T2" != "$T1" ]; then pass 'later pairing issues a new token'; else fail 'later pairing issues a new token'; fi
check 'earlier retry refused after later pairing (token generation mismatch)' "$(claim "$C" "$(nonce 10)")" '{"ok": false}'
denied 'earlier device token rejected after later pairing' broadcast "$T1"
check 'latest pairing retry still works' "$(field "$(claim "$C2" "$(nonce 20)")" ingest_token)" "$T2"

# ── Expiration boundaries ──
mk(){ as_user "$OWNER" "SELECT code FROM public.generate_bridge_pairing_code('$E2');"; }
CE="$(canon "$(mk)")"
q "UPDATE public.bridge_pairing_v2 SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE code_hash=extensions.digest(convert_to('$CE','UTF8'),'sha256')"
check 'code refused just after expiry' "$(claim "$CE" "$(nonce 30)")" '{"ok": false}'
q "UPDATE public.bridge_pairing_v2 SET expires_at=clock_timestamp()+interval '5 seconds' WHERE code_hash=extensions.digest(convert_to('$CE','UTF8'),'sha256')"
check 'code accepted just before expiry' "$(field "$(claim "$CE" "$(nonce 30)")" ok)" true
CE="$(canon "$(mk)")"
q "UPDATE public.events SET requests_status='ended' WHERE id='$E2'"
check 'ended event refuses pairing' "$(claim "$CE" "$(nonce 31)")" '{"ok": false}'
q "UPDATE public.events SET requests_status='live' WHERE id='$E2'"
q "UPDATE public.events SET dj_id='$OTHER' WHERE id='$E2'"
check 'code refused after event ownership changes' "$(claim "$CE" "$(nonce 31)")" '{"ok": false}'
q "UPDATE public.events SET dj_id='$OWNER' WHERE id='$E2'"

# ── Concurrency: one winner; same nonce is idempotent ──
CC="$(canon "$(mk)")"
BEFORE="$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E2'")"
for i in $(seq 1 16); do claim "$CC" "$(nonce $((100+i)))" >"$WORK/race.$i" 2>&1 & done; wait
check 'concurrent distinct-nonce claims: exactly one winner' "$(cat "$WORK"/race.* | grep -c '"ok": true')" 1
check 'concurrent distinct-nonce claims: fifteen uniform refusals' "$(cat "$WORK"/race.* | grep -cx '{"ok": false}')" 15
AFTER="$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E2'")"
if [ "$AFTER" != "$BEFORE" ]; then pass 'winner rotated the token exactly once'; else fail 'winner rotated the token exactly once'; fi
check 'winner received the current token' "$(cat "$WORK"/race.* | grep -c "$AFTER")" 1
CS="$(canon "$(mk)")"
for i in $(seq 1 16); do claim "$CS" "$(nonce 200)" >"$WORK/same.$i" 2>&1 & done; wait
check 'concurrent same-nonce claims all succeed' "$(cat "$WORK"/same.* | grep -c '"ok": true')" 16
check 'concurrent same-nonce claims share one token' "$(for f in "$WORK"/same.*; do field "$(cat "$f")" ingest_token; done | sort -u | wc -l | tr -d ' ')" 1

# ── Hostile invalid traffic cannot deny a valid code, and leaves nothing behind ──
CH="$(canon "$(mk)")"
ATTEMPTS_BEFORE="$(q "SELECT count(*) FROM public.bridge_pair_attempts")"
V2_ROWS_BEFORE="$(q "SELECT count(*) FROM public.bridge_pairing_v2")"
for i in $(seq 1 320); do printf 'ZZZZZZZZZZZZ%04d\n' "$i"; done >"$WORK/hostile.txt"
hostile(){ psql -X -q -At -c "BEGIN" -c "SET LOCAL ROLE service_role" -c "SELECT public.bridge_pair_claim_v2('$1','hostile-nonce-0000000000000')" -c "COMMIT"; }
export -f hostile
xargs -P 16 -I{} bash -c 'hostile {}' <"$WORK/hostile.txt" >"$WORK/hostile.out" 2>&1 &
HOSTILE=$!
RH="$(claim "$CH" "$(nonce 300)")"
check 'valid claim succeeds during hostile invalid traffic' "$(field "$RH" ok)" true
wait "$HOSTILE"
check 'every hostile attempt got the uniform refusal' "$(grep -cx '{"ok": false}' "$WORK/hostile.out")" 320
check 'invalid attempts write no evidence rows' "$(q "SELECT count(*) FROM public.bridge_pair_attempts")" "$ATTEMPTS_BEFORE"
check 'invalid attempts leave pairing rows unchanged apart from the one valid claim' "$(q "SELECT count(*) FROM public.bridge_pairing_v2")" "$V2_ROWS_BEFORE"
check 'claim routine has no reference to the attempts table' "$(q "SELECT count(*) FROM pg_proc WHERE oid='public.bridge_pair_claim_v2(text,text)'::regprocedure AND prosrc ILIKE '%bridge_pair_attempts%'")" 0
# A saturated legacy attempts table (the old shared-bucket denial) must have no effect on v2.
q "INSERT INTO public.bridge_pair_attempts(ip,success) SELECT v.k,false FROM generate_series(1,500), (VALUES('unverified-gateway'),('bridge-pair-v2')) v(k)"
CH2="$(canon "$(mk)")"
check 'saturated legacy failure bucket: invalid attempt still uniform' "$(claim ZZZZZZZZZZZZ9999 "$(nonce 301)")" '{"ok": false}'
check 'saturated legacy failure bucket: valid claim still succeeds' "$(field "$(claim "$CH2" "$(nonce 302)")" ok)" true
q "UPDATE public.bridge_pair_attempts SET attempted_at=now()-interval '25 hours'"
as_role service_role "SELECT public.repair_prune_limiter_logs();" >/dev/null
check 'installed 24-hour retention still clears legacy attempt rows' "$(q "SELECT count(*) FROM public.bridge_pair_attempts")" 0

# ── Revoke ──
E3TOKEN="$(as_user "$OTHER" "SELECT public.get_ingest_token('$E3');")"
CUR="$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")"
OTHERS="$(q "SELECT md5(string_agg(ingest_token,',' ORDER BY event_id)) FROM public.event_integrations WHERE event_id<>'$E1'")"
check 'revoke succeeds once' "$(as_role service_role "SELECT public.bridge_revoke_v2('$CUR');")" t
check 'revoke of the same token again changes nothing' "$(as_role service_role "SELECT public.bridge_revoke_v2('$CUR');")" f
denied 'revoked token rejected at ingest boundary' broadcast "$CUR"
if [ "$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")" != "$CUR" ]; then pass 'revoke replaced the stored token'; else fail 'revoke replaced the stored token'; fi
check 'revoke leaves other events untouched' "$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E3'")" "$E3TOKEN"
NEWCUR="$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")"
for i in $(seq 1 5); do as_role service_role "SELECT public.bridge_revoke_v2('$CUR');" >/dev/null; done
check 'repeating a spent revoke never rotates this integration again' "$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E1'")" "$NEWCUR"
check 'repeating a spent revoke never rotates a different integration' "$(q "SELECT md5(string_agg(ingest_token,',' ORDER BY event_id)) FROM public.event_integrations WHERE event_id<>'$E1'")" "$OTHERS"
for i in $(seq 1 12); do as_role service_role "SELECT public.bridge_revoke_v2('$NEWCUR');" >"$WORK/revoke.$i" 2>&1 & done; wait
check 'concurrent revokes of one token: exactly one rotation' "$(cat "$WORK"/revoke.* | grep -cx t)" 1
check 'concurrent revokes of one token: eleven no-ops' "$(cat "$WORK"/revoke.* | grep -cx f)" 11
check 'concurrent revokes left other integrations untouched' "$(q "SELECT md5(string_agg(ingest_token,',' ORDER BY event_id)) FROM public.event_integrations WHERE event_id<>'$E1'")" "$OTHERS"
check 'revoked tokens are stored nowhere afterwards' "$(q "SELECT count(*) FROM public.event_integrations WHERE ingest_token IN ('$CUR','$NEWCUR')")" 0
check 'unknown 64-hex token revoke is a no-op' "$(as_role service_role "SELECT public.bridge_revoke_v2(repeat('f',64));")" f
check 'unknown 48-hex token revoke is a no-op' "$(as_role service_role "SELECT public.bridge_revoke_v2(repeat('f',48));")" f
# Stored tokens of a shape the revoke rule rejects must stay untouched even though they exist.
for shape in "repeat('A',64)" "repeat('a',47)" "repeat('a',49)" "repeat('a',63)" "repeat('a',65)" "repeat('a',32)" "repeat('a',128)" "repeat('a',47)||'_'" "repeat('a',63)||'-'" "repeat('a',47)||'g'" "'short'"; do
 q "UPDATE public.event_integrations SET ingest_token=$shape WHERE event_id='$E2'"
 check "revoke refuses token shape $shape even when it is stored" "$(as_role service_role "SELECT public.bridge_revoke_v2($shape);")$(q "SELECT (ingest_token=$shape)::text FROM public.event_integrations WHERE event_id='$E2'")" ftrue
done
check 'null token revoke is a no-op' "$(as_role service_role "SELECT public.bridge_revoke_v2(NULL);")" f
# A legacy 48-character token and a v2 64-character token each revoke exactly their own integration.
q "UPDATE public.event_integrations SET ingest_token=repeat('c',48) WHERE event_id='$E2'"
SNAP="$(q "SELECT md5(string_agg(ingest_token,',' ORDER BY event_id)) FROM public.event_integrations WHERE event_id<>'$E2'")"
check 'legacy 48-hex token revokes its integration' "$(as_role service_role "SELECT public.bridge_revoke_v2(repeat('c',48));")" t
check 'legacy revoke issued a 64-hex replacement' "$(q "SELECT (ingest_token ~ '^[0-9a-f]{64}\$')::text FROM public.event_integrations WHERE event_id='$E2'")" true
check 'one token revoked only its unique integration' "$(q "SELECT md5(string_agg(ingest_token,',' ORDER BY event_id)) FROM public.event_integrations WHERE event_id<>'$E2'")" "$SNAP"
check 'TypeScript and SQL revoke rules are the same expression' "$(q "SELECT count(*) FROM pg_proc WHERE oid='public.bridge_revoke_v2(text)'::regprocedure AND position('^([0-9a-f]{48}|[0-9a-f]{64})\$' in prosrc)>0")$(grep -c "REVOCABLE_TOKEN = /^(?:\[0-9a-f\]{48}|\[0-9a-f\]{64})\$/" "$HERE/../../functions/_shared/bridge-protocol.ts")" 11
check 'retry refused after revoke (token generation mismatch)' "$(claim "$C2" "$(nonce 20)")" '{"ok": false}'
CR="$(canon "$(as_user "$OWNER" "SELECT code FROM public.generate_bridge_pairing_code('$E1');")")"
as_user "$OWNER" "SELECT public.regenerate_ingest_token('$E1');" >/dev/null
check 'owner rotation retires outstanding v2 codes' "$(claim "$CR" "$(nonce 40)")" '{"ok": false}'
denied 'non-owner cannot rotate' as_user "$OTHER" "SELECT public.regenerate_ingest_token('$E1');"

# ── Grants and SECURITY DEFINER search_path ──
check 'all definer routines pin an empty search_path' "$(q "SELECT count(*) FROM pg_proc p WHERE p.oid IN ('public.bridge_pair_claim_v2(text,text)'::regprocedure,'public.bridge_revoke_v2(text)'::regprocedure,'public.generate_bridge_pairing_code(uuid)'::regprocedure,'public.regenerate_ingest_token(uuid)'::regprocedure) AND p.prosecdef AND p.proconfig=ARRAY['search_path=\"\"']")" 4
check 'service-only routines: no PUBLIC, anon or authenticated EXECUTE' "$(q "SELECT count(*) FROM pg_proc p CROSS JOIN (VALUES('anon'),('authenticated'),('public')) r(n) WHERE p.oid IN ('public.bridge_pair_claim_v2(text,text)'::regprocedure,'public.bridge_revoke_v2(text)'::regprocedure,'public.repair_claim_bridge_code(text,text)'::regprocedure) AND has_function_privilege(r.n,p.oid,'EXECUTE')")" 0
check 'service role holds exactly the two v2 service routines' "$(q "SELECT has_function_privilege('service_role','public.bridge_pair_claim_v2(text,text)','EXECUTE')::text||has_function_privilege('service_role','public.bridge_revoke_v2(text)','EXECUTE')::text||has_function_privilege('service_role','public.repair_claim_bridge_code(text,text)','EXECUTE')::text")" truetruefalse
check 'exact non-owner grantees per routine (aclexplode)' "$(q "SELECT string_agg(p.oid::regprocedure::text||'='||coalesce((SELECT string_agg(DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,',') FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner),'-'),';' ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN ('public.bridge_pair_claim_v2(text,text)'::regprocedure,'public.bridge_revoke_v2(text)'::regprocedure,'public.generate_bridge_pairing_code(uuid)'::regprocedure,'public.regenerate_ingest_token(uuid)'::regprocedure,'public.repair_claim_bridge_code(text,text)'::regprocedure)")" 'bridge_pair_claim_v2(text,text)=service_role;bridge_revoke_v2(text)=service_role;generate_bridge_pairing_code(uuid)=authenticated;regenerate_ingest_token(uuid)=authenticated;repair_claim_bridge_code(text,text)=-'
check 'no routine is left on the default (PUBLIC) ACL and all are owned by the trusted owner' "$(q "SELECT count(*) FROM pg_proc p WHERE p.oid IN ('public.bridge_pair_claim_v2(text,text)'::regprocedure,'public.bridge_revoke_v2(text)'::regprocedure,'public.generate_bridge_pairing_code(uuid)'::regprocedure,'public.regenerate_ingest_token(uuid)'::regprocedure,'public.repair_claim_bridge_code(text,text)'::regprocedure) AND p.proacl IS NOT NULL AND pg_get_userbyid(p.proowner)='postgres'")" 5
denied 'service role cannot generate a pairing code' as_role service_role "SELECT * FROM public.generate_bridge_pairing_code('$E1');"
denied 'service role cannot use owner rotation' as_role service_role "SELECT public.regenerate_ingest_token('$E1');"
check 'private store: owned by the trusted owner with no non-owner grantee' "$(q "SELECT pg_get_userbyid(c.relowner)||(SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee<>c.relowner) FROM pg_class c WHERE c.oid='public.bridge_pairing_v2'::regclass")" postgres0
check 'generation: authenticated only, never anon or PUBLIC' "$(q "SELECT has_function_privilege('authenticated','public.generate_bridge_pairing_code(uuid)','EXECUTE')::text||has_function_privilege('anon','public.generate_bridge_pairing_code(uuid)','EXECUTE')::text||has_function_privilege('public','public.generate_bridge_pairing_code(uuid)','EXECUTE')::text")" truefalsefalse
check 'private store: no table privilege for any API role' "$(q "SELECT count(*) FROM (VALUES('anon'),('authenticated'),('service_role'),('public')) r(n) CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(x) WHERE has_table_privilege(r.n,'public.bridge_pairing_v2',p.x)")" 0
check 'private store has RLS enabled and no policies' "$(q "SELECT relrowsecurity::text||(SELECT count(*) FROM pg_policy WHERE polrelid=c.oid) FROM pg_class c WHERE c.oid='public.bridge_pairing_v2'::regclass")" true0

# ── Containment companion: stops new pairing, never restores six-digit pairing ──
CK="$(canon "$(mk)")"
KEEP="$(q "SELECT ingest_token FROM public.event_integrations WHERE event_id='$E3'")"
if psql -X -q -v ON_ERROR_STOP=1 -f "$CONTAIN" >"$WORK/drift.log" 2>&1; then fail 'containment accepted statement-by-statement execution'; fi
if grep -q 'Not running as one transaction' "$WORK/drift.log"; then pass 'containment refuses statement-by-statement (autocommit) execution'; else fail 'containment refuses statement-by-statement (autocommit) execution'; fi
check 'refused containment changed nothing' "$(q "SELECT has_function_privilege('authenticated','public.generate_bridge_pairing_code(uuid)','EXECUTE')")" t
if [[ "$KEEP" =~ ^[0-9a-f]{48}$ ]]; then pass 'containment revoke check uses a legacy 48-hex token'; else fail 'containment revoke check uses a legacy 48-hex token'; fi
run_file --single-transaction -f "$CONTAIN" || { cat "$WORK/last.log"; exit 1; }
denied 'containment: owner cannot generate' as_user "$OWNER" "SELECT * FROM public.generate_bridge_pairing_code('$E1');"
denied 'containment: service role cannot claim' claim "$CK" "$(nonce 50)"
check 'containment: unclaimed codes removed' "$(q "SELECT count(*) FROM public.bridge_pairing_v2 WHERE claimed_at IS NULL")" 0
denied 'containment: six-digit claim still closed' as_role service_role "SELECT public.repair_claim_bridge_code('123456','x');"
denied 'containment: legacy table still sealed' q "INSERT INTO public.bridge_pairing_codes(code,event_id,created_by,expires_at) VALUES('654321','$E1','$OWNER',now()+interval '5 minutes')"
check 'containment: revoke still works' "$(as_role service_role "SELECT public.bridge_revoke_v2('$KEEP');")" t
echo "RESULT: $checks checks passed"
