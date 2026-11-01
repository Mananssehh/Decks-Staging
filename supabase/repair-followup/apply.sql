-- OPERATOR ONLY: run from this directory with psql -X -v ON_ERROR_STOP=1 -f apply.sql.
-- Do not run on production. Preflight must show no installed followup contract.
\set ON_ERROR_STOP on
BEGIN;
\ir 01_tip_reservations.sql
\ir 02_tip_lifecycle.sql
COMMIT;
\ir 03_verify.sql
