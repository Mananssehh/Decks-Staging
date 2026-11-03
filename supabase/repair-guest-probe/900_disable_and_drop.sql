-- DECKS STAGING ONLY: disable then drop the guest-token probe.
-- Touches ONLY public.repair_guest_probe_rpc and schema repair_guest_probe.
-- Step 1 (disable, can be run alone): stops all non-contract actions immediately.
BEGIN;
DO $d$
BEGIN
  IF to_regclass('repair_guest_probe.marker') IS NOT NULL THEN
    UPDATE repair_guest_probe.marker SET enabled = false WHERE singleton;
    UPDATE repair_guest_probe.events SET active = false;
    UPDATE repair_guest_probe.sessions SET revoked_at = coalesce(revoked_at, now());
  END IF;
END $d$;
COMMIT;

-- Step 2 (drop). Guard: the public function must be the probe's (by comment) before dropping.
BEGIN;
DO $g$
DECLARE
  -- to_regprocedure() yields NULL when the function is already gone, so a
  -- repeat teardown is a no-op. A literal '<sig>'::regprocedure cast here would
  -- be resolved while planning the IF expression and error out before the
  -- IS NOT NULL guard could short-circuit.
  _rpc oid := to_regprocedure('public.repair_guest_probe_rpc(text,jsonb)');
BEGIN
  IF _rpc IS NOT NULL
     AND coalesce(obj_description(_rpc, 'pg_proc'), '')
         NOT LIKE 'STAGING PROBE guest-token-probe-v1%' THEN
    RAISE EXCEPTION 'refusing to drop: public.repair_guest_probe_rpc is not the probe function';
  END IF;
END $g$;
DROP FUNCTION IF EXISTS public.repair_guest_probe_rpc(text, jsonb);
DROP SCHEMA IF EXISTS repair_guest_probe CASCADE; -- contains only probe objects
COMMIT;
