-- Rollback for 012 only (run BEFORE any 910/950 rollback). Restores the exact three captured 011
-- definitions (aliases, member, snapshot) and drops the private backup. Never touches the reviewer's
-- reviewer_snapshot_baseline / reviewer_identity_baseline audit tables. Repeat-safe; guest data untouched.
DO $$ DECLARE d record; BEGIN
 IF to_regclass('guest_runtime.capacity_before') IS NULL THEN RAISE NOTICE '012 backup absent (not installed by 012, or already rolled back); nothing to roll back'; RETURN; END IF;
 FOR d IN SELECT definition FROM guest_runtime.capacity_before ORDER BY signature LOOP EXECUTE d.definition; END LOOP;
 DROP TABLE guest_runtime.capacity_before;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guest_runtime FROM PUBLIC,anon,authenticated,service_role;
END $$;
