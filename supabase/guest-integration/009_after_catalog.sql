-- READ ONLY AFTER candidate installation; save alongside 000 preflight output.
SELECT c.conrelid::regclass,c.conname,c.confrelid::regclass,pg_get_constraintdef(c.oid)
FROM pg_constraint c WHERE c.contype='f' AND (c.confrelid='auth.users'::regclass OR c.connamespace='guest_runtime'::regnamespace OR c.conrelid='public.profiles'::regclass)
ORDER BY 1,2;
SELECT count(*) auth_users FROM auth.users;
SELECT count(*) profiles,count(*) FILTER(WHERE auth_user_id IS NOT NULL) registered_profiles FROM public.profiles;
SELECT kind,count(*) FROM guest_runtime.app_principals GROUP BY kind;
SELECT signature,definition FROM guest_runtime.before_functions ORDER BY signature;
SELECT rel,name,definition FROM guest_runtime.before_constraints ORDER BY rel,name;
SELECT c.oid::regclass,t.tgname,pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE t.tgname IN ('guest_stream_revision','guest_writer_gate','guest_profile_identity','guest_registered_profile_insert','guest_registered_profile_delete') ORDER BY 1,2;
SELECT oid::regprocedure,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace
AND proname IN ('handle_new_user','award_points','dj_transition_request','dj_set_queue_position','repair_write_broadcast','update_my_profile');
SELECT attrelid::regclass,attname,format_type(atttypid,atttypmod),attnotnull FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND attrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r') ORDER BY 1,2;
SELECT oid::regprocedure,proacl,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_my_event_snapshot','get_my_principal_aliases');
-- Run after 010 as well; no token/secret projection.
SELECT oid::regprocedure,proacl,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('guest_stream_auth','guest_stream_poll');
SELECT relname,relrowsecurity,relacl FROM pg_class WHERE relnamespace='guest_runtime'::regnamespace AND relname IN ('event_revisions','stream_installation');