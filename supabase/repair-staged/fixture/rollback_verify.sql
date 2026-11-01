\ir ../rollback/01_contain.sql
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.dj_transition_request(uuid,uuid,text)','execute') THEN RAISE EXCEPTION 'Rollback did not contain playback'; END IF;
 IF has_function_privilege('authenticated','public.award_points(uuid,uuid,integer,public.point_tx_type,text,uuid,uuid)','execute') THEN RAISE EXCEPTION 'Rollback reopened award'; END IF;
 IF has_table_privilege('authenticated','public.song_requests','DELETE') THEN RAISE EXCEPTION 'Rollback reopened deletion'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.repair_points_reconciliation WHERE classification='quarantined') THEN RAISE EXCEPTION 'Rollback lost evidence'; END IF;
END $$;
