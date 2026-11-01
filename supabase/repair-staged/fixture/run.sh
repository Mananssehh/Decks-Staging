#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/decks-core-pg.XXXXXX)"
export PGHOST="$WORK/socket" PGPORT=55439 PGUSER=postgres PGDATABASE=decks_repair
mkdir "$PGHOST"
initdb -D "$WORK/data" -U postgres --auth=trust >"$WORK/init.log"
pg_ctl -D "$WORK/data" -o "-k $PGHOST -p $PGPORT -c listen_addresses=''" -w start >"$WORK/start.log"
trap 'pg_ctl -D "$WORK/data" -m immediate stop >/dev/null; rm -rf "$WORK"' EXIT
createdb "$PGDATABASE"
psql -X -v ON_ERROR_STOP=1 -f "$HERE/00_fixture.sql" >"$WORK/schema.log" 2>&1 || { cat "$WORK/schema.log"; exit 1; }
for sql in "$HERE"/../0[1-6]_*.sql; do
 psql -X -v ON_ERROR_STOP=1 --single-transaction -f "$sql" >"$WORK/migration.log" 2>&1 || { cat "$WORK/migration.log"; exit 1; }
done
NODE_PATH=/dev-server/node_modules bun "$HERE/matrix.ts"
NODE_PATH=/dev-server/node_modules bun "$HERE/locks.ts"
psql -X -v ON_ERROR_STOP=1 --single-transaction -f "$HERE/rollback_verify.sql" >"$WORK/rollback.log" 2>&1 || { cat "$WORK/rollback.log"; exit 1; }
echo 'PASS containment rollback preserves security and reconciliation evidence'
