#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" = 0 ]; then
 U="$(id -u nobody 2>/dev/null || id -u lovable)"; H="$(mktemp -d /tmp/guest-home.XXXXXX)"; chmod 777 "$H"
 exec setpriv --reuid="$U" --regid="$(id -g "$U")" --clear-groups env HOME="$H" bash "$0"
fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"; WORK="$(mktemp -d /tmp/guest-integration-pg.XXXXXX)"
export PGHOST="$WORK" PGPORT=55442 PGUSER=postgres PGDATABASE=decks_repair
initdb -D "$WORK/data" -U postgres -A trust >/dev/null
pg_ctl -D "$WORK/data" -o "-k $WORK -p $PGPORT -c listen_addresses='' -c max_connections=160" -l "$WORK/log" -w start >/dev/null
trap 'pg_ctl -D "$WORK/data" -m immediate stop >/dev/null; rm -rf "$WORK"' EXIT
createdb "$PGDATABASE"
psql -Xq -v ON_ERROR_STOP=1 -f "$HERE/../repair-staged/fixture/00_fixture.sql" >"$WORK/setup.log" 2>&1 || { cat "$WORK/setup.log"; exit 1; }
for f in "$HERE"/../repair-staged/0[1-6]_*.sql "$HERE"/../repair-followup/0[12]_*.sql; do psql -Xq -v ON_ERROR_STOP=1 -1 -f "$f" >>"$WORK/setup.log" 2>&1 || { tail -40 "$WORK/setup.log"; exit 1; }; done
# Restore exact ownership FKs omitted by historical catalog fixture; fixture auth UID exists.
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY(id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.song_requests ADD CONSTRAINT song_requests_requested_by_fkey FOREIGN KEY(requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.votes ADD CONSTRAINT votes_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.dj_tips ADD CONSTRAINT dj_tips_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.guest_funnel_events ADD CONSTRAINT guest_funnel_events_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
SQL
# Independently reviewed targeted bootstrap exercised only in a throwaway clone.
psql -Xq -v ON_ERROR_STOP=1 -c 'CREATE DATABASE reviewed_bootstrap TEMPLATE decks_repair'
NODE_PATH=/dev-server/node_modules bun "$HERE/test/bootstrap.ts"
PGDATABASE=reviewed_bootstrap psql -Xq -v ON_ERROR_STOP=1 -1 $(printf -- '-f %s ' "$HERE"/00[1-8]_*.sql) >"$WORK/repaired-install.log" 2>&1 || { cat "$WORK/repaired-install.log"; exit 1; }
echo 'PASS repaired existing Auth profile accepted by protected install'
# Explicit missing-profile preflight: reject, never invent a profile for an Auth orphan.
psql -Xq -v ON_ERROR_STOP=1 -c 'CREATE DATABASE orphan_preflight TEMPLATE decks_repair'
PGDATABASE=orphan_preflight psql -Xq -v ON_ERROR_STOP=1 -c "ALTER TABLE auth.users DISABLE TRIGGER USER; INSERT INTO auth.users(id) VALUES('00000000-0000-4000-8000-000000000777'); ALTER TABLE auth.users ENABLE TRIGGER USER"
if PGDATABASE=orphan_preflight psql -Xq -v ON_ERROR_STOP=1 -1 -f "$HERE/001_principals.sql" >"$WORK/orphan.log" 2>&1; then echo FAIL orphan accepted; exit 1; fi
grep -q 'Auth without profile' "$WORK/orphan.log"
echo 'PASS orphan preflight refuses installation without invented data'
psql -Xq -v ON_ERROR_STOP=1 -1 $(printf -- '-f %s ' "$HERE"/00[1-8]_*.sql) >"$WORK/install.log" 2>&1 || { cat "$WORK/install.log"; exit 1; }
NODE_PATH=/dev-server/node_modules bun "$HERE/test/matrix.ts"
psql -Xq -v ON_ERROR_STOP=1 -1 -f "$HERE/010_stream.sql" >"$WORK/stream.log" 2>&1 || { cat "$WORK/stream.log"; exit 1; }
NODE_PATH=/dev-server/node_modules bun "$HERE/test/stream.ts"
# Containment must preserve data; destructive rollback must refuse.
if psql -Xq -v ON_ERROR_STOP=1 -f "$HERE/950_restore_empty.sql" >"$WORK/refusal" 2>&1; then echo FAIL destructive rollback accepted; exit 1; fi
grep -q 'guest records exist' "$WORK/refusal"
psql -Xq -v ON_ERROR_STOP=1 -f "$HERE/900_contain.sql"
psql -Xq -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF (SELECT enabled FROM guest_runtime.installation) THEN RAISE EXCEPTION 'containment failed'; END IF; IF EXISTS(SELECT 1 FROM guest_runtime.sessions WHERE revoked_at IS NULL) THEN RAISE EXCEPTION 'live session'; END IF; END \$\$;"
echo 'PASS containment and destructive refusal'
psql -Xq -v ON_ERROR_STOP=1 -c "CREATE DATABASE empty_restore TEMPLATE decks_repair"
# Explicitly discard local guest fixtures only in cloned THROWAWAY DB, then reconstruct pre-install state.
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.followup_payment_events WHERE tip_id IN(SELECT id FROM public.dj_tips WHERE user_id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest'));
DELETE FROM public.followup_tip_financial_state WHERE tip_id IN(SELECT id FROM public.dj_tips WHERE user_id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest'));
DELETE FROM public.followup_tip_reservations WHERE user_id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest');
DELETE FROM public.dj_tips WHERE user_id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest');
DELETE FROM public.guest_funnel_events WHERE user_id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest');
DELETE FROM public.votes WHERE user_id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest');
DELETE FROM public.song_requests WHERE requested_by IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest');
DELETE FROM guest_runtime.claims;
UPDATE guest_runtime.app_principals SET merged_into=NULL WHERE kind='guest';
DELETE FROM guest_runtime.sessions;
DELETE FROM guest_runtime.bootstraps;
DELETE FROM public.profiles WHERE id IN(SELECT id FROM guest_runtime.app_principals WHERE kind='guest');
SQL
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 -f "$HERE/950_restore_empty.sql" >>"$WORK/empty.log" 2>&1 || { cat "$WORK/empty.log"; exit 1; }
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public._before_restore AS SELECT oid::regprocedure::text sig,pg_get_functiondef(oid) def FROM pg_proc WHERE pronamespace='public'::regnamespace;
CREATE TABLE public._before_catalog AS
SELECT 'constraint' kind,conrelid::regclass::text||':'||conname name,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace='public'::regnamespace
UNION ALL SELECT 'trigger',tgrelid::regclass::text||':'||tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
UNION ALL SELECT 'column',attrelid::regclass::text||':'||attname,format_type(atttypid,atttypmod)||':'||attnotnull::text FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND attrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname NOT LIKE '\_before%');
SQL
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 -1 $(printf -- '-f %s ' "$HERE"/00[1-8]_*.sql) >>"$WORK/empty.log" 2>&1
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 -1 -f "$HERE/010_stream.sql" >>"$WORK/empty.log" 2>&1
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 -f "$HERE/950_restore_empty.sql" >>"$WORK/empty.log" 2>&1 || { tail -40 "$WORK/empty.log"; exit 1; }
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF to_regnamespace('guest_runtime') IS NOT NULL OR EXISTS(SELECT 1 FROM public._before_restore WHERE def IS DISTINCT FROM pg_get_functiondef(to_regprocedure(sig))) THEN RAISE EXCEPTION 'restore mismatch'; END IF; IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attname='auth_user_id' AND NOT attisdropped) OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname LIKE 'guest_writer%' OR tgname LIKE 'guest_registered_profile%' OR tgname='guest_profile_identity') THEN RAISE EXCEPTION 'lifecycle rollback residue'; END IF; IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_id_fkey' AND confrelid='auth.users'::regclass AND confdeltype='c') THEN RAISE EXCEPTION 'Auth FK restore mismatch'; END IF; END \$\$;"
echo 'PASS empty rollback restores every original public function definition'
PGDATABASE=empty_restore psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF EXISTS(
 WITH after_catalog AS (
 SELECT 'constraint' kind,conrelid::regclass::text||':'||conname name,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace='public'::regnamespace
 UNION ALL SELECT 'trigger',tgrelid::regclass::text||':'||tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
 UNION ALL SELECT 'column',attrelid::regclass::text||':'||attname,format_type(atttypid,atttypmod)||':'||attnotnull::text FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND attrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname NOT LIKE '\_before%'))
 (SELECT * FROM public._before_catalog EXCEPT SELECT * FROM after_catalog) UNION ALL (SELECT * FROM after_catalog EXCEPT SELECT * FROM public._before_catalog)
 ) THEN RAISE EXCEPTION 'before/after constraints, columns or guards differ'; END IF;
END $$;
SQL
echo 'PASS exact local before/after constraints columns and guards restored'
