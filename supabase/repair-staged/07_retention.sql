-- Apply only after 01..06. Does not enable any email dispatch job.
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RAISE EXCEPTION 'pg_cron missing: configure service-only daily limiter cleanup before release'; END IF;
END $$;
SELECT cron.schedule('decks-core-limiter-retention','17 3 * * *','SELECT public.repair_prune_limiter_logs()');
