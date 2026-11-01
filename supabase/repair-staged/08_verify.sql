-- Read-only post-apply gate. Must return no counter mismatches or exposed internal functions.
SELECT sr.id,sr.upvotes,sr.downvotes FROM public.song_requests sr
LEFT JOIN LATERAL(SELECT count(*) FILTER(WHERE value=1) u,count(*) FILTER(WHERE value=-1) d FROM public.votes WHERE song_request_id=sr.id) v ON true
WHERE sr.upvotes<>v.u OR sr.downvotes<>v.d;
SELECT * FROM public.repair_points_reconciliation WHERE classification='quarantined';
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN('award_points','enqueue_email','read_email_batch','delete_email','move_to_dlq','boost_request','repair_claim_bridge_code','repair_prune_limiter_logs')
AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'));
SELECT has_table_privilege('authenticated','public.event_participants','INSERT') participant_bypass,
has_table_privilege('authenticated','public.votes','UPDATE') vote_bypass,
has_table_privilege('authenticated','public.song_requests','DELETE') delete_bypass;
SELECT event_id,count(*) FROM public.song_requests WHERE status='playing' GROUP BY event_id HAVING count(*)>1;
SELECT jobname,schedule,active FROM cron.job WHERE jobname='decks-core-limiter-retention';
