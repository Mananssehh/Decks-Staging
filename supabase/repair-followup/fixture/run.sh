#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/decks-followup-pg.XXXXXX)"
export PGHOST="$WORK/socket" PGPORT=55440 PGUSER=postgres PGDATABASE=decks_repair
mkdir "$PGHOST"
initdb -D "$WORK/data" -U postgres --auth=trust >"$WORK/init.log"
pg_ctl -D "$WORK/data" -o "-k $PGHOST -p $PGPORT -c listen_addresses=''" -w start >"$WORK/start.log"
trap 'pg_ctl -D "$WORK/data" -m immediate stop >/dev/null; rm -rf "$WORK"' EXIT
createdb "$PGDATABASE"
psql -X -v ON_ERROR_STOP=1 -f "$HERE/../../repair-staged/fixture/00_fixture.sql" >"$WORK/schema.log" 2>&1 || { cat "$WORK/schema.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 --single-transaction -f "$HERE/../01_tip_reservations.sql" -f "$HERE/../02_tip_lifecycle.sql" >"$WORK/migration.log" 2>&1 || { cat "$WORK/migration.log"; exit 1; }
NODE_PATH=/dev-server/node_modules bun "$HERE/payment.ts"
psql -X -v ON_ERROR_STOP=1 --single-transaction -f "$HERE/../rollback.sql" >"$WORK/rollback.log" 2>&1 || { cat "$WORK/rollback.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF has_function_privilege('service_role','public.followup_reserve_tip(uuid,uuid,uuid,integer,uuid,text)','execute') THEN RAISE EXCEPTION 'rollback failed'; END IF; IF NOT EXISTS(SELECT 1 FROM public.followup_tip_reservations) THEN RAISE EXCEPTION 'evidence missing'; END IF; END \$\$;" >"$WORK/verify.log" 2>&1 || { cat "$WORK/verify.log"; exit 1; }
echo 'PASS containment rollback retains payment evidence and disables new checkout'