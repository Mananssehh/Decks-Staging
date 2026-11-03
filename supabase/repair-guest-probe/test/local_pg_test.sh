#!/usr/bin/env bash
# Isolated throwaway PostgreSQL test of 001/900. No network, no hosted DB.
set -euo pipefail
if [ "$(id -u)" = 0 ]; then exec setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp bash "$0" "$@"; fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d /tmp/gtp-pg.XXXXXX)"; PORT=55439
initdb -D "$D/data" -U postgres -A trust >/dev/null
pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" start >/dev/null
trap 'pg_ctl -D "$D/data" stop -m fast >/dev/null; rm -rf "$D"' EXIT
P="psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -qAtX"
$P -d postgres -c "CREATE DATABASE t"
P="$P -d t"
$P <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;
-- Sentinel app table to prove the probe never touches it.
CREATE TABLE public.app_sentinel(x int); INSERT INTO public.app_sentinel VALUES (1);
SQL
$P -f "$HERE/001_install.sql"
$P -f "$HERE/test/assertions.sql"

# Concurrency: 100 parallel fresh joins + parallel votes on one request.
EV=$($P -c "SELECT event_id||'|'||code FROM repair_guest_probe.operator_create_event('conc', interval '1 hour', 120)")
EID=${EV%%|*}; CODE=${EV##*|}
for i in $(seq 1 100); do
  $P -c "SET ROLE service_role; SELECT public.repair_guest_probe_rpc('join', jsonb_build_object('event_id','$EID','code','$CODE','nickname','g$i'))->>'ok'" &
done | sort | uniq -c > "$D/joins"; wait
grep -q "100 true" "$D/joins" || { cat "$D/joins"; echo FAIL concurrent joins; exit 1; }
[ "$($P -c "SELECT admissions FROM repair_guest_probe.events WHERE id='$EID'")" = 100 ] || { echo FAIL admissions; exit 1; }
# Admission cap: 30 more concurrent, cap 120 -> exactly 20 succeed, 10 typed 429.
for i in $(seq 1 30); do
  $P -c "SET ROLE service_role; SELECT public.repair_guest_probe_rpc('join', jsonb_build_object('event_id','$EID','code','$CODE','nickname','x$i'))->>'status'" &
done | sort | uniq -c > "$D/cap"; wait
grep -q "10 429" "$D/cap" || { cat "$D/cap"; echo FAIL cap; exit 1; }
# Parallel votes from 50 guests on one request; sessions created in SQL so tokens are known locally only.
$P <<SQL
CREATE TABLE public._toks AS SELECT g, (public.repair_guest_probe_rpc('join', jsonb_build_object('event_id', e.event_id, 'code', e.code, 'nickname', 'v'||g))->>'token') tok, e.event_id
  FROM repair_guest_probe.operator_create_event('votes', interval '1 hour', 300) e, generate_series(1,50) g;
CREATE TABLE public._req AS SELECT (public.repair_guest_probe_rpc('request', jsonb_build_object('event_id', event_id, 'token', tok, 'idempotency_key', gen_random_uuid()::text, 'title', 'Song'))->>'request_id')::uuid id FROM public._toks WHERE g = 1;
SQL
for g in $(seq 1 50); do
  for v in 1 -1 1; do
    $P -c "SELECT public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id', t.event_id, 'token', t.tok, 'request_id', r.id, 'value', $v))->>'ok' FROM public._toks t, public._req r WHERE t.g=$g" &
  done
done | sort | uniq -c > "$D/votes"; wait
grep -q "150 true" "$D/votes" || { cat "$D/votes"; echo FAIL votes; exit 1; }
$P <<'SQL'
DO $c$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM repair_guest_probe.requests q
   WHERE q.upvotes <> (SELECT count(*) FROM repair_guest_probe.votes v WHERE v.request_id=q.id AND v.value=1)
      OR q.downvotes <> (SELECT count(*) FROM repair_guest_probe.votes v WHERE v.request_id=q.id AND v.value=-1);
  IF bad <> 0 THEN RAISE EXCEPTION 'FAIL counter mismatch %', bad; END IF;
  IF (SELECT count(*) FROM repair_guest_probe.votes) <> 50 THEN RAISE EXCEPTION 'FAIL vote rows'; END IF;
END $c$;
DROP TABLE public._toks, public._req;
SQL
grep -q "deadlock" "$D/log" && { echo FAIL deadlock in log; exit 1; }

$P -f "$HERE/900_disable_and_drop.sql"
$P <<'SQL'
DO $z$ BEGIN
  IF to_regnamespace('repair_guest_probe') IS NOT NULL OR to_regprocedure('public.repair_guest_probe_rpc(text,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'FAIL drop'; END IF;
  IF (SELECT count(*) FROM public.app_sentinel) <> 1 THEN RAISE EXCEPTION 'FAIL sentinel'; END IF;
END $z$;
SQL
echo "PASS local_pg_test: install, assertions, 100 concurrent joins, admission cap 429, 150 concurrent votes exact counters, no deadlock, disable+drop, app sentinel untouched"
