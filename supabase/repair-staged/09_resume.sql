-- READ ONLY installed-state inventory, not a migration and not permission to replay 01..07.
SELECT p.oid::regprocedure,md5(p.prosrc) body_hash,p.provolatile,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
AND p.proname IN ('join_event_by_code','request_song','set_song_vote','dj_transition_request','repair_claim_bridge_code','repair_write_broadcast','get_ingest_token','boost_request','email_queue_dispatch','email_queue_wake');
SELECT tgname,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal;
SELECT count(*) counter_mismatches FROM public.song_requests s WHERE s.upvotes<>(SELECT count(*) FROM public.votes v WHERE v.song_request_id=s.id AND v.value=1) OR s.downvotes<>(SELECT count(*) FROM public.votes v WHERE v.song_request_id=s.id AND v.value=-1);
SELECT event_id,count(*) FROM public.song_requests WHERE status='playing' GROUP BY event_id HAVING count(*)>1;
SELECT event_id,count(*) FROM public.event_integrations GROUP BY event_id HAVING count(*)>1;
SELECT classification,count(*) FROM public.repair_points_reconciliation GROUP BY classification;
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl WHERE defaclobjtype='f';
-- Reviewer reported one daily cron job. Agent hosted SQL cannot inspect cron internals.