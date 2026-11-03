-- Sequential behaviour assertions (run as postgres; RPC calls use SET ROLE service_role).
DO $t$
DECLARE
  a record; b record; r jsonb; tok text; tok2 text; req uuid; i int; adm int;
  f text := 'repair_guest_probe_rpc';
BEGIN
  -- ACL
  IF has_function_privilege('anon','public.repair_guest_probe_rpc(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon exec'; END IF;
  IF has_function_privilege('authenticated','public.repair_guest_probe_rpc(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'auth exec'; END IF;
  IF has_function_privilege('anon','repair_guest_probe.err(integer,text)','EXECUTE') THEN RAISE EXCEPTION 'private exec'; END IF;
  IF has_table_privilege('service_role','repair_guest_probe.sessions','SELECT') THEN RAISE EXCEPTION 'table select'; END IF;

  SELECT * INTO a FROM repair_guest_probe.operator_create_event('A');
  SELECT * INTO b FROM repair_guest_probe.operator_create_event('B');
  IF EXISTS (SELECT 1 FROM repair_guest_probe.events WHERE convert_to(a.code,'UTF8') = code_hash) THEN RAISE EXCEPTION 'plaintext'; END IF;

  r := public.repair_guest_probe_rpc('contract','{}');
  IF r->>'contract' <> 'guest-token-probe-v1' THEN RAISE EXCEPTION 'contract %', r; END IF;
  r := public.repair_guest_probe_rpc('drop_tables','{}');
  IF r->>'error' <> 'invalid_action' THEN RAISE EXCEPTION 'action %', r; END IF;

  -- wrong code / unknown event indistinguishable
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',a.event_id,'code','nope','nickname','x'));
  IF r->>'error' <> 'invalid_event_or_code' THEN RAISE EXCEPTION 'badcode %', r; END IF;
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',gen_random_uuid(),'code',a.code,'nickname','x'));
  IF r->>'error' <> 'invalid_event_or_code' THEN RAISE EXCEPTION 'unknown %', r; END IF;
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',a.event_id,'code',a.code,'nickname',repeat('n',41)));
  IF r->>'error' <> 'invalid_nickname' THEN RAISE EXCEPTION 'nick %', r; END IF;

  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',a.event_id,'code',a.code,'nickname','Ann'));
  tok := r->>'token';
  IF tok !~ '^[0-9a-f]{64}$' OR (r->>'resumed')::boolean THEN RAISE EXCEPTION 'join %', r; END IF;
  IF EXISTS (SELECT 1 FROM repair_guest_probe.sessions WHERE convert_to(tok,'UTF8') = token_hash) THEN RAISE EXCEPTION 'raw token stored'; END IF;
  SELECT admissions INTO adm FROM repair_guest_probe.events WHERE id=a.event_id;
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',a.event_id,'token',tok));
  IF NOT (r->>'resumed')::boolean OR r ? 'token' THEN RAISE EXCEPTION 'resume %', r; END IF;
  IF (SELECT admissions FROM repair_guest_probe.events WHERE id=a.event_id) <> adm THEN RAISE EXCEPTION 'resume consumed'; END IF;

  -- invalid / forged / missing / cross-event
  r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',a.event_id));
  IF r->>'status' <> '401' THEN RAISE EXCEPTION 'missing %', r; END IF;
  r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',a.event_id,'token',repeat('a',64)));
  IF r->>'status' <> '401' THEN RAISE EXCEPTION 'forged %', r; END IF;
  r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',a.event_id,'token','zz'));
  IF r->>'status' <> '401' THEN RAISE EXCEPTION 'malformed %', r; END IF;
  r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',b.event_id,'token',tok));
  IF r->>'status' <> '401' THEN RAISE EXCEPTION 'cross %', r; END IF;

  -- idempotent request
  r := public.repair_guest_probe_rpc('request', jsonb_build_object('event_id',a.event_id,'token',tok,'idempotency_key','11111111-1111-4111-8111-111111111111','title','Song 1'));
  req := (r->>'request_id')::uuid;
  r := public.repair_guest_probe_rpc('request', jsonb_build_object('event_id',a.event_id,'token',tok,'idempotency_key','11111111-1111-4111-8111-111111111111','title','Song 1'));
  IF (r->>'request_id')::uuid <> req OR NOT (r->>'replayed')::boolean THEN RAISE EXCEPTION 'idem %', r; END IF;
  IF (SELECT count(*) FROM repair_guest_probe.requests) <> 1 THEN RAISE EXCEPTION 'dup request'; END IF;
  r := public.repair_guest_probe_rpc('request', jsonb_build_object('event_id',a.event_id,'token',tok,'idempotency_key',gen_random_uuid(),'title',repeat('t',121)));
  IF r->>'error' <> 'invalid_title' THEN RAISE EXCEPTION 'title %', r; END IF;
  r := public.repair_guest_probe_rpc('request', jsonb_build_object('event_id',a.event_id,'token',tok,'idempotency_key',gen_random_uuid(),'title','t','body',repeat('b',4097)));
  IF r->>'error' <> 'invalid_body' THEN RAISE EXCEPTION 'body %', r; END IF;
  FOR i IN 2..5 LOOP
    r := public.repair_guest_probe_rpc('request', jsonb_build_object('event_id',a.event_id,'token',tok,'idempotency_key',gen_random_uuid(),'title','S'||i));
    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'req % %', i, r; END IF;
  END LOOP;
  r := public.repair_guest_probe_rpc('request', jsonb_build_object('event_id',a.event_id,'token',tok,'idempotency_key',gen_random_uuid(),'title','S6'));
  IF r->>'status' <> '429' OR r->>'error' <> 'guest_request_cap' THEN RAISE EXCEPTION 'req cap %', r; END IF;

  -- votes: desired state, idempotent, no duplicates, cross-event request rejected
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',a.event_id,'code',a.code,'nickname','Bob'));
  tok2 := r->>'token';
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',req,'value',1));
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',req,'value',1));
  IF (r->>'changed')::boolean OR (r->>'upvotes')::int <> 1 THEN RAISE EXCEPTION 'vote idem %', r; END IF;
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',req,'value',-1));
  IF (r->>'upvotes')::int <> 0 OR (r->>'downvotes')::int <> 1 THEN RAISE EXCEPTION 'flip %', r; END IF;
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',req,'value',0));
  IF (r->>'downvotes')::int <> 0 OR EXISTS (SELECT 1 FROM repair_guest_probe.votes) THEN RAISE EXCEPTION 'neutral %', r; END IF;
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',req,'value',2));
  IF r->>'error' <> 'invalid_vote_value' THEN RAISE EXCEPTION 'val %', r; END IF;
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',req,'value','1'));
  IF r->>'error' <> 'invalid_vote_value' THEN RAISE EXCEPTION 'strval %', r; END IF;
  r := public.repair_guest_probe_rpc('vote', jsonb_build_object('event_id',a.event_id,'token',tok2,'request_id',gen_random_uuid(),'value',1));
  IF r->>'error' <> 'request_not_found' THEN RAISE EXCEPTION 'nf %', r; END IF;

  r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',a.event_id,'token',tok2));
  IF jsonb_array_length(r->'requests') <> 5 THEN RAISE EXCEPTION 'read %', r; END IF;

  -- Immutable ownership
  BEGIN
    UPDATE repair_guest_probe.requests SET session_id = gen_random_uuid() WHERE id = req;
    RAISE EXCEPTION 'mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'mutable' THEN RAISE; END IF;
  END;

  -- guest op spam limit (30/min); tok2 used 7 ops so far
  FOR i IN 1..40 LOOP
    r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',a.event_id,'token',tok2));
    EXIT WHEN r->>'status' = '429';
  END LOOP;
  IF r->>'error' <> 'guest_rate_limited' THEN RAISE EXCEPTION 'spam %', r; END IF;

  -- revocation / expiry / closed event
  UPDATE repair_guest_probe.sessions SET revoked_at = now() WHERE token_hash = sha256(convert_to(tok,'UTF8'));
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',a.event_id,'token',tok));
  IF r->>'status' <> '401' THEN RAISE EXCEPTION 'revoked %', r; END IF;
  UPDATE repair_guest_probe.events SET active = false WHERE id = b.event_id;
  r := public.repair_guest_probe_rpc('join', jsonb_build_object('event_id',b.event_id,'code',b.code,'nickname','x'));
  IF r->>'status' <> '410' THEN RAISE EXCEPTION 'closed %', r; END IF;

  -- disabled marker
  UPDATE repair_guest_probe.marker SET enabled = false;
  r := public.repair_guest_probe_rpc('read', jsonb_build_object('event_id',a.event_id,'token',tok2));
  IF r->>'error' <> 'probe_disabled' THEN RAISE EXCEPTION 'disabled %', r; END IF;
  UPDATE repair_guest_probe.marker SET enabled = true;

  DELETE FROM repair_guest_probe.events;
  RAISE NOTICE 'assertions passed';
END $t$;
