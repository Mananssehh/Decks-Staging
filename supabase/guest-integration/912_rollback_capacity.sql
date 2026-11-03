-- Rollback for 012 only (run BEFORE any 910/950 rollback). Restores the exact captured definitions,
-- drops the added index and evidence table. Guest data is untouched. Repeat-safe.
DO $$ DECLARE d record; BEGIN
 IF to_regclass('guest_runtime.capacity_before') IS NULL THEN RAISE NOTICE '012 not installed; nothing to roll back'; RETURN; END IF;
 FOR d IN SELECT definition FROM guest_runtime.capacity_before ORDER BY signature LOOP EXECUTE d.definition; END LOOP;
 DROP INDEX IF EXISTS guest_runtime.guest_principals_merged_into;
 DROP TABLE guest_runtime.capacity_before;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
END $$;
