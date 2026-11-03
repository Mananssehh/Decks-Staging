-- DECKS STAGING ONLY: isolated event-scoped guest-token probe.
-- Contract: guest-token-probe-v1. Source-only until independently reviewed.
-- Creates ONLY schema repair_guest_probe and function public.repair_guest_probe_rpc.
-- No reads/writes/relationships to public app tables or auth.*.
-- Requires pg_catalog.sha256 (PG11+) and pgcrypto gen_random_bytes (extensions schema).

BEGIN;

DO $pre$
BEGIN
  IF to_regnamespace('repair_guest_probe') IS NOT NULL THEN
    RAISE EXCEPTION 'preflight: schema repair_guest_probe already exists; run 900 first or inspect';
  END IF;
  IF to_regprocedure('public.repair_guest_probe_rpc(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'preflight: public.repair_guest_probe_rpc already exists';
  END IF;
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'preflight: extensions.gen_random_bytes (pgcrypto) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'preflight: service_role missing';
  END IF;
END
$pre$;

CREATE SCHEMA repair_guest_probe;
REVOKE ALL ON SCHEMA repair_guest_probe FROM PUBLIC;
REVOKE ALL ON SCHEMA repair_guest_probe FROM anon, authenticated, service_role;
-- Functions created in this schema must not inherit PUBLIC EXECUTE.
ALTER DEFAULT PRIVILEGES IN SCHEMA repair_guest_probe REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA repair_guest_probe REVOKE ALL ON TABLES FROM PUBLIC;

CREATE TABLE repair_guest_probe.marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  installed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO repair_guest_probe.marker (contract) VALUES ('guest-token-probe-v1');

CREATE TABLE repair_guest_probe.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_admissions integer NOT NULL DEFAULT 300 CHECK (max_admissions BETWEEN 1 AND 300),
  admissions integer NOT NULL DEFAULT 0 CHECK (admissions >= 0),
  max_requests integer NOT NULL DEFAULT 400 CHECK (max_requests BETWEEN 1 AND 1000),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CHECK (admissions <= max_admissions),
  CHECK (request_count <= max_requests)
);

CREATE TABLE repair_guest_probe.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES repair_guest_probe.events(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 5),
  UNIQUE (id, event_id)
);

CREATE TABLE repair_guest_probe.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL DEFAULT '' CHECK (octet_length(body) <= 4096),
  upvotes integer NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  downvotes integer NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, event_id) REFERENCES repair_guest_probe.sessions(id, event_id) ON DELETE CASCADE,
  UNIQUE (session_id, idempotency_key),
  UNIQUE (id, event_id)
);

CREATE TABLE repair_guest_probe.votes (
  request_id uuid NOT NULL,
  session_id uuid NOT NULL,
  event_id uuid NOT NULL,
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, session_id),
  FOREIGN KEY (request_id, event_id) REFERENCES repair_guest_probe.requests(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, event_id) REFERENCES repair_guest_probe.sessions(id, event_id) ON DELETE CASCADE
);

-- Rolling rate logs (bounded by retention in rpc).
CREATE TABLE repair_guest_probe.op_log (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON repair_guest_probe.op_log (session_id, at);
CREATE TABLE repair_guest_probe.join_failures (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON repair_guest_probe.join_failures (at);

-- Immutable ownership.
CREATE FUNCTION repair_guest_probe.immutable_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  -- Nested IFs: PL/pgSQL may resolve NEW fields even past a false AND.
  IF TG_TABLE_NAME = 'sessions' THEN
    IF NEW.id <> OLD.id OR NEW.event_id <> OLD.event_id OR NEW.token_hash <> OLD.token_hash THEN
      RAISE EXCEPTION 'immutable session identity';
    END IF;
  ELSIF TG_TABLE_NAME = 'requests' THEN
    IF NEW.id <> OLD.id OR NEW.event_id <> OLD.event_id OR NEW.session_id <> OLD.session_id OR NEW.idempotency_key <> OLD.idempotency_key THEN
      RAISE EXCEPTION 'immutable request identity';
    END IF;
  ELSIF TG_TABLE_NAME = 'votes' THEN
    IF NEW.request_id <> OLD.request_id OR NEW.session_id <> OLD.session_id OR NEW.event_id <> OLD.event_id THEN
      RAISE EXCEPTION 'immutable vote identity';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER sessions_immutable BEFORE UPDATE ON repair_guest_probe.sessions FOR EACH ROW EXECUTE FUNCTION repair_guest_probe.immutable_owner();
CREATE TRIGGER requests_immutable BEFORE UPDATE ON repair_guest_probe.requests FOR EACH ROW EXECUTE FUNCTION repair_guest_probe.immutable_owner();
CREATE TRIGGER votes_immutable BEFORE UPDATE ON repair_guest_probe.votes FOR EACH ROW EXECUTE FUNCTION repair_guest_probe.immutable_owner();

DO $acl$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marker','events','sessions','requests','votes','op_log','join_failures'] LOOP
    EXECUTE format('ALTER TABLE repair_guest_probe.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON repair_guest_probe.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $acl$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA repair_guest_probe FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION repair_guest_probe.immutable_owner() FROM PUBLIC, anon, authenticated, service_role;

-- Operator-only fixture creation (not exposed via any endpoint).
-- Returns the plaintext code ONCE to the operator; only its hash is stored.
CREATE FUNCTION repair_guest_probe.operator_create_event(_label text, _ttl interval DEFAULT interval '2 hours', _max_admissions integer DEFAULT 300)
RETURNS TABLE (event_id uuid, code text, expires_at timestamptz)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
DECLARE _code text := encode(extensions.gen_random_bytes(12), 'hex'); _id uuid;
BEGIN
  IF _ttl <= interval '0' OR _ttl > interval '24 hours' THEN RAISE EXCEPTION 'ttl out of bounds'; END IF;
  INSERT INTO repair_guest_probe.events (label, code_hash, expires_at, max_admissions)
  VALUES (_label, sha256(convert_to(_code, 'UTF8')), now() + _ttl, _max_admissions)
  RETURNING id INTO _id;
  RETURN QUERY SELECT _id, _code, now() + _ttl;
END $f$;
REVOKE ALL ON FUNCTION repair_guest_probe.operator_create_event(text, interval, integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION repair_guest_probe.err(_status integer, _code text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT jsonb_build_object('ok', false, 'status', _status, 'error', _code)
$f$;
REVOKE ALL ON FUNCTION repair_guest_probe.err(integer, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION repair_guest_probe.try_uuid(_v text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF _v IS NULL OR _v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  RETURN _v::uuid;
END $f$;
REVOKE ALL ON FUNCTION repair_guest_probe.try_uuid(text) FROM PUBLIC, anon, authenticated, service_role;

-- Single narrow public entrypoint. service_role only.
CREATE FUNCTION public.repair_guest_probe_rpc(_action text, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $f$
DECLARE
  c_guest_ops_per_min constant integer := 30;
  c_join_fail_per_10min constant integer := 200;
  c_admit_per_10min constant integer := 300;
  c_req_per_guest constant integer := 5;
  _enabled boolean; _contract text;
  _event_id uuid := repair_guest_probe.try_uuid(_payload->>'event_id');
  _token text := _payload->>'token';
  _ev repair_guest_probe.events%ROWTYPE;
  _s repair_guest_probe.sessions%ROWTYPE;
  _r repair_guest_probe.requests%ROWTYPE;
  _new_token text; _nick text; _title text; _body text; _idem uuid; _req_id uuid;
  _value integer; _old smallint; _n integer; _rows jsonb;
BEGIN
  IF jsonb_typeof(_payload) IS DISTINCT FROM 'object' THEN RETURN repair_guest_probe.err(400, 'invalid_payload'); END IF;
  SELECT enabled, contract INTO _enabled, _contract FROM repair_guest_probe.marker WHERE singleton;
  IF _action = 'contract' THEN
    RETURN jsonb_build_object('ok', true, 'contract', _contract, 'enabled', coalesce(_enabled, false));
  END IF;
  IF _contract IS DISTINCT FROM 'guest-token-probe-v1' THEN RETURN repair_guest_probe.err(503, 'probe_contract_mismatch'); END IF;
  IF NOT coalesce(_enabled, false) THEN RETURN repair_guest_probe.err(503, 'probe_disabled'); END IF;
  IF _action NOT IN ('join', 'request', 'read', 'vote') THEN RETURN repair_guest_probe.err(400, 'invalid_action'); END IF;
  IF _event_id IS NULL THEN RETURN repair_guest_probe.err(400, 'invalid_event_id'); END IF;
  IF _token IS NOT NULL AND _token !~ '^[0-9a-f]{64}$' THEN RETURN repair_guest_probe.err(401, 'invalid_session'); END IF;

  -- Event lock FIRST (FOR UPDATE for counter-changing ops, FOR SHARE otherwise).
  IF _action IN ('join', 'request') THEN
    SELECT * INTO _ev FROM repair_guest_probe.events WHERE id = _event_id FOR UPDATE;
  ELSE
    SELECT * INTO _ev FROM repair_guest_probe.events WHERE id = _event_id FOR SHARE;
  END IF;

  IF _action = 'join' AND _token IS NULL THEN
    -- Fresh admission. Unknown event and wrong code are indistinguishable.
    IF _ev.id IS NULL OR _ev.code_hash <> sha256(convert_to(coalesce(_payload->>'code', ''), 'UTF8')) THEN
      -- Global failure bucket serialized by a probe-specific xact advisory mutex.
      -- Order: (optional) event row lock -> this mutex; no path takes the mutex before an event lock.
      PERFORM pg_advisory_xact_lock(7420113, 1);
      DELETE FROM repair_guest_probe.join_failures WHERE at <= now() - interval '10 minutes';
      SELECT count(*) INTO _n FROM repair_guest_probe.join_failures WHERE at > now() - interval '10 minutes';
      IF _n >= c_join_fail_per_10min THEN RETURN repair_guest_probe.err(429, 'join_rate_limited'); END IF;
      INSERT INTO repair_guest_probe.join_failures DEFAULT VALUES;
      RETURN repair_guest_probe.err(404, 'invalid_event_or_code');
    END IF;
    IF NOT _ev.active OR _ev.expires_at <= now() THEN RETURN repair_guest_probe.err(410, 'event_closed'); END IF;
    _nick := btrim(coalesce(_payload->>'nickname', ''));
    IF char_length(_nick) NOT BETWEEN 1 AND 40 THEN RETURN repair_guest_probe.err(400, 'invalid_nickname'); END IF;
    IF _ev.admissions >= _ev.max_admissions THEN RETURN repair_guest_probe.err(429, 'event_admission_cap'); END IF;
    SELECT count(*) INTO _n FROM repair_guest_probe.sessions WHERE event_id = _ev.id AND created_at > now() - interval '10 minutes';
    IF _n >= c_admit_per_10min THEN RETURN repair_guest_probe.err(429, 'event_admission_rate'); END IF;
    _new_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO repair_guest_probe.sessions (event_id, token_hash, nickname, expires_at)
    VALUES (_ev.id, sha256(convert_to(_new_token, 'UTF8')), _nick, _ev.expires_at)
    RETURNING * INTO _s;
    UPDATE repair_guest_probe.events SET admissions = admissions + 1 WHERE id = _ev.id;
    RETURN jsonb_build_object('ok', true, 'resumed', false, 'token', _new_token,
      'session_id', _s.id, 'event_id', _ev.id, 'nickname', _s.nickname, 'expires_at', _s.expires_at);
  END IF;

  -- All other paths require a valid session for THIS event.
  IF _token IS NULL THEN RETURN repair_guest_probe.err(401, 'invalid_session'); END IF;
  IF _ev.id IS NULL THEN RETURN repair_guest_probe.err(401, 'invalid_session'); END IF;
  SELECT * INTO _s FROM repair_guest_probe.sessions
   WHERE token_hash = sha256(convert_to(_token, 'UTF8')) AND event_id = _ev.id FOR UPDATE;
  IF _s.id IS NULL OR _s.revoked_at IS NOT NULL OR _s.expires_at <= now() THEN
    RETURN repair_guest_probe.err(401, 'invalid_session');
  END IF;
  IF NOT _ev.active OR _ev.expires_at <= now() THEN RETURN repair_guest_probe.err(410, 'event_closed'); END IF;

  IF _action = 'join' THEN
    -- Resume: no admission consumed, no rate charge.
    RETURN jsonb_build_object('ok', true, 'resumed', true,
      'session_id', _s.id, 'event_id', _ev.id, 'nickname', _s.nickname, 'expires_at', _s.expires_at);
  END IF;

  -- Per-guest op rate (session row already locked -> serialized per guest).
  DELETE FROM repair_guest_probe.op_log WHERE at < now() - interval '1 hour';
  SELECT count(*) INTO _n FROM repair_guest_probe.op_log WHERE session_id = _s.id AND at > now() - interval '1 minute';
  IF _n >= c_guest_ops_per_min THEN RETURN repair_guest_probe.err(429, 'guest_rate_limited'); END IF;
  INSERT INTO repair_guest_probe.op_log (session_id) VALUES (_s.id);

  IF _action = 'read' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'title', q.title, 'upvotes', q.upvotes, 'downvotes', q.downvotes,
      'mine', q.session_id = _s.id, 'my_vote', coalesce(v.value, 0)) ORDER BY q.upvotes - q.downvotes DESC, q.created_at), '[]'::jsonb)
      INTO _rows
      FROM (SELECT * FROM repair_guest_probe.requests WHERE event_id = _ev.id ORDER BY created_at LIMIT 500) q
      LEFT JOIN repair_guest_probe.votes v ON v.request_id = q.id AND v.session_id = _s.id;
    RETURN jsonb_build_object('ok', true, 'event_id', _ev.id, 'requests', _rows);
  END IF;

  IF _action = 'request' THEN
    _idem := repair_guest_probe.try_uuid(_payload->>'idempotency_key');
    IF _idem IS NULL THEN RETURN repair_guest_probe.err(400, 'invalid_idempotency_key'); END IF;
    SELECT * INTO _r FROM repair_guest_probe.requests WHERE session_id = _s.id AND idempotency_key = _idem;
    IF _r.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'request_id', _r.id, 'title', _r.title);
    END IF;
    _title := btrim(coalesce(_payload->>'title', ''));
    _body := coalesce(_payload->>'body', '');
    IF char_length(_title) NOT BETWEEN 1 AND 120 THEN RETURN repair_guest_probe.err(400, 'invalid_title'); END IF;
    IF octet_length(_body) > 4096 THEN RETURN repair_guest_probe.err(400, 'invalid_body'); END IF;
    IF _s.request_count >= c_req_per_guest THEN RETURN repair_guest_probe.err(429, 'guest_request_cap'); END IF;
    IF _ev.request_count >= _ev.max_requests THEN RETURN repair_guest_probe.err(429, 'event_request_cap'); END IF;
    INSERT INTO repair_guest_probe.requests (event_id, session_id, idempotency_key, title, body)
    VALUES (_ev.id, _s.id, _idem, _title, _body) RETURNING * INTO _r;
    UPDATE repair_guest_probe.sessions SET request_count = request_count + 1 WHERE id = _s.id;
    UPDATE repair_guest_probe.events SET request_count = request_count + 1 WHERE id = _ev.id;
    RETURN jsonb_build_object('ok', true, 'replayed', false, 'request_id', _r.id, 'title', _r.title);
  END IF;

  -- vote: desired state -1/0/1.
  _req_id := repair_guest_probe.try_uuid(_payload->>'request_id');
  IF _req_id IS NULL THEN RETURN repair_guest_probe.err(400, 'invalid_request_id'); END IF;
  IF jsonb_typeof(_payload->'value') IS DISTINCT FROM 'number' OR (_payload->>'value') NOT IN ('-1', '0', '1') THEN
    RETURN repair_guest_probe.err(400, 'invalid_vote_value');
  END IF;
  _value := (_payload->>'value')::integer;
  SELECT * INTO _r FROM repair_guest_probe.requests WHERE id = _req_id AND event_id = _ev.id FOR UPDATE;
  IF _r.id IS NULL THEN RETURN repair_guest_probe.err(404, 'request_not_found'); END IF;
  SELECT value INTO _old FROM repair_guest_probe.votes WHERE request_id = _r.id AND session_id = _s.id FOR UPDATE;
  _old := coalesce(_old, 0);
  IF _old <> _value THEN
    IF _value = 0 THEN
      DELETE FROM repair_guest_probe.votes WHERE request_id = _r.id AND session_id = _s.id;
    ELSE
      INSERT INTO repair_guest_probe.votes (request_id, session_id, event_id, value)
      VALUES (_r.id, _s.id, _ev.id, _value)
      ON CONFLICT (request_id, session_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    END IF;
    UPDATE repair_guest_probe.requests SET
      upvotes = upvotes + (CASE WHEN _value = 1 THEN 1 ELSE 0 END) - (CASE WHEN _old = 1 THEN 1 ELSE 0 END),
      downvotes = downvotes + (CASE WHEN _value = -1 THEN 1 ELSE 0 END) - (CASE WHEN _old = -1 THEN 1 ELSE 0 END)
    WHERE id = _r.id RETURNING * INTO _r;
  END IF;
  RETURN jsonb_build_object('ok', true, 'request_id', _r.id, 'my_vote', _value,
    'changed', _old <> _value, 'upvotes', _r.upvotes, 'downvotes', _r.downvotes);
EXCEPTION WHEN OTHERS THEN
  -- Fail closed; never echo internals.
  RAISE WARNING 'repair_guest_probe internal sqlstate %', SQLSTATE; -- no payload/token logged
   RETURN repair_guest_probe.err(500, 'internal');
END
$f$;

REVOKE ALL ON FUNCTION public.repair_guest_probe_rpc(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_guest_probe_rpc(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_guest_probe_rpc(text, jsonb) TO service_role;
COMMENT ON FUNCTION public.repair_guest_probe_rpc(text, jsonb) IS 'STAGING PROBE guest-token-probe-v1; isolated; drop via repair-guest-probe/900';

-- Verify ACL inside the transaction.
DO $v$
BEGIN
  IF has_function_privilege('anon', 'public.repair_guest_probe_rpc(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.repair_guest_probe_rpc(text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.repair_guest_probe_rpc(text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verify: rpc ACL wrong';
  END IF;
  IF has_schema_privilege('anon', 'repair_guest_probe', 'USAGE')
     OR has_schema_privilege('authenticated', 'repair_guest_probe', 'USAGE')
     OR has_schema_privilege('service_role', 'repair_guest_probe', 'USAGE') THEN
    RAISE EXCEPTION 'verify: schema ACL wrong';
  END IF;
  IF has_function_privilege('anon', 'repair_guest_probe.operator_create_event(text,interval,integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'repair_guest_probe.operator_create_event(text,interval,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verify: operator function exposed';
  END IF;
END $v$;

COMMIT;
