-- SAFE CONTAINMENT for Bridge Pairing Protocol v2 (companion to 10_bridge_pairing_security.sql).
-- Disables NEW pairing. It does not, and must never, restore six-digit pairing.
-- Run on DECKS Staging only, after independent review, and ONLY through a mechanism independently
-- confirmed to run this complete file in ONE transaction. No BEGIN/COMMIT is included because the
-- deployment runner's statement framing is not known from the repository; the marker check below
-- refuses to proceed when statements are committed one by one.
SET LOCAL lock_timeout='5s';
SET LOCAL bridge_pairing_v2.single_transaction='10_bridge_pairing_contain';
DO $guard$ BEGIN
 IF pg_catalog.current_setting('bridge_pairing_v2.single_transaction',true) IS DISTINCT FROM '10_bridge_pairing_contain' THEN
  RAISE EXCEPTION 'Not running as one transaction: refuse to apply statement by statement';
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public.generate_bridge_pairing_code(uuid),public.bridge_pair_claim_v2(text,text)
FROM PUBLIC,anon,authenticated,service_role;
-- Outstanding unclaimed codes can no longer be claimed anyway; remove them so none survive a later re-enable.
DELETE FROM public.bridge_pairing_v2 WHERE claimed_at IS NULL;
-- Kept on purpose: public.bridge_revoke_v2(text) and public.regenerate_ingest_token(uuid), so tokens
-- can still be retired; the sealed legacy table; the refusing public.repair_claim_bridge_code(text,text);
-- ingest and snapshot behaviour for devices that are already paired.
-- To re-enable after review (and only this):
--   GRANT EXECUTE ON FUNCTION public.generate_bridge_pairing_code(uuid) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.bridge_pair_claim_v2(text,text) TO service_role;
