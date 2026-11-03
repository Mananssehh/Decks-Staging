# Guest-token probe (DECKS STAGING ONLY) — contract `guest-token-probe-v1`

Hypothesis under test: 100 fresh guests can join an event and perform server-authorized
request/read/vote operations **without any Supabase anonymous sign-in**, using an
event-scoped, server-issued, hashed-at-rest guest token.

**Status: INSTALLED + DEPLOYED IN STAGING, then DISABLED AFTER TEST.** `001_install.sql` and the
`guest-token-probe` Edge function are installed on the DECKS staging backend, the probe was exercised
over real HTTP, and it was then disabled (marker off, all probe events closed, all sessions revoked).
The app's own guest flow is **not** integrated with it and **not** replaced. Production was never
touched, deployed to, or published from this work. Dated hosted results are below.

## What this is NOT
- Not a migration of the app's guest model and not a UI replacement.
- Does **not** integrate production guest points, payments/tips, boosts, DJ UI, Realtime,
  `public.*` app tables or `auth.users`. No reads/writes/foreign keys to any of them.
- Does **not** certify app capacity, Realtime fan-out, provider quotas, or egress-IP behaviour.
  The runner's "auth_signup_calls_observed = 0" is client-side counting in the test driver, not
  network proof (the hosted run's 1273-call / 0-Auth tally is the same kind of evidence).

## Hosted staging results (2026-11-03 UTC — Nov 2 America/New_York)

Installed and deployed by root's independent review, exercised over real HTTP, then disabled.

- **Capacity (fresh clients):** 25/25 full flows in 39.61 s, 50/50 in 25.59 s, 100/100 in 26.29 s.
  No unexpected HTTP errors; every request / read / vote / idempotency / resume check passed.
  The runner made 1273 calls, all to the probe endpoint, with 0 Auth calls.
- **Rate limiter (same-token burst):** 40 simultaneous reads on one guest token → 30× 200 plus
  10× typed 429 in 4.082 s.
- **Totals** across both capacity runs plus the security/independent burst: 353 unique hashed probe
  sessions, 350 requests, 350 votes, and 0 counter / admission / request-count mismatches.
  `auth.users` stayed at 118.
- **App untouched:** six original app fingerprints matched (profiles, events, requests, votes,
  function definitions, table permissions).
- **Disabled after test** at 2026-11-03 02:07:43 UTC: marker off, all probe events closed, all 353
  sessions revoked. Verified over HTTP: `contract` reports `enabled:false` and `join` returns
  503 `probe_disabled`. The objects are still installed; the step-6 teardown remains available.

### Run-history honesty
- The **first** overall runner run reported `pass:false`. Every capacity stage passed; the failure came
  from the spam check, whose driver issued its reads sequentially (~13/min at real HTTP latency) and so
  never reached the 30/min limit. That was a test-driver defect, not a limiter or capacity finding.
- The **corrected** driver fires the reads as one simultaneous burst; the final overall run is
  `pass:true`, with the burst result above (30× 200 + 10× 429).

### What the hosted result does NOT establish
- One runner on one egress path. The runner's egress IP was **not independently verified**, so the
  30/hour-per-IP+project Auth limit was never exercised as a comparison — the probe simply never used Auth.
- Not venue WiFi, not Realtime fan-out, not sustained or long-duration capacity, not UI/browser persistence.
- Not points, payments/tips, boosts, DJ UI or any app integration; the app guest flow is untouched.
- Not production: nothing here was deployed to or published from production.

## Objects (only these)
- Schema `repair_guest_probe`: `marker`, `events`, `sessions`, `requests`, `votes`, `op_log`,
  `join_failures`; private functions `operator_create_event`, `err`, `try_uuid`, `immutable_owner`.
  RLS on all tables, no policies; ALL revoked from PUBLIC/anon/authenticated/service_role;
  schema USAGE revoked from all three; schema default privileges revoke PUBLIC EXECUTE/table access.
- `public.repair_guest_probe_rpc(text, jsonb)` — SECURITY DEFINER, `search_path = pg_catalog, pg_temp`,
  EXECUTE revoked from PUBLIC/anon/authenticated, granted to `service_role` only.
- Edge function `guest-token-probe` (`verify_jwt = false` for this function only in `supabase/config.toml`).

## Rules enforced in the DB
- Event code: random 12-byte hex returned once to operator; only `sha256` stored. TTL ≤ 24h,
  admissions ≤ 300 (`max_admissions`), requests/event ≤ `max_requests` (default 400).
  Only operator SQL creates events; no endpoint creates/enables events.
- Token: `gen_random_bytes(32)` hex (256-bit), only `sha256` stored, bound to one event,
  expiry = event expiry, revocable. Unknown/forged/malformed/wrong-event/expired/revoked → 401.
- Unknown event vs wrong code are indistinguishable (404 `invalid_event_or_code`); failures logged,
  global 200 failed joins/10 min → 429; that bucket is serialized by a probe-specific transaction
  advisory mutex taken only after any event row lock (event → mutex; never mutex → event).
- Lock order: event row (FOR UPDATE for join/request, FOR SHARE for read/vote) → session row
  FOR UPDATE → request row FOR UPDATE → vote row. Admission atomic under the event lock.
- Resume (`join` with token) returns the same session, no admission consumed, no new token.
- Per-guest: 30 ops/min (429 `guest_rate_limited`), 5 requests max (429 `guest_request_cap`).
  Per-event: admission cap (429 `event_admission_cap`), 300 admissions/10 min (429 `event_admission_rate`),
  request cap (429 `event_request_cap`).
- Request idempotency: unique `(session_id, idempotency_key uuid)`; replay returns `replayed: true`.
- Vote: desired state -1/0/1 (JSON number only), PK `(request_id, session_id)`, counters updated
  under request row lock; repeat is `changed: false`. Identity columns immutable via trigger.
- Bounds: nickname ≤ 40, title ≤ 120, body ≤ 4096 bytes, Edge body ≤ 8 KB read via a bounded stream (Content-Length not trusted; stream cancelled on overflow).
- Marker contract must equal exactly `guest-token-probe-v1` (else 503 `probe_contract_mismatch`) and
  `enabled=true` (else 503 `probe_disabled`), checked on every non-contract action. Unexpected errors →
  500 `internal` (only SQLSTATE logged server-side; never payload/token).

## Operation JSON (POST body `{ "action", "payload" }`)
| action | payload | success |
|---|---|---|
| `contract` | `{}` | `{ok, contract, enabled}` |
| `join` (fresh) | `{event_id, code, nickname}` | `{ok, resumed:false, token, session_id, event_id, nickname, expires_at}` |
| `join` (resume) | `{event_id, token}` | `{ok, resumed:true, session_id, event_id, nickname, expires_at}` |
| `request` | `{event_id, token, idempotency_key, title, body?}` | `{ok, replayed, request_id, title}` |
| `read` | `{event_id, token}` | `{ok, event_id, requests:[{id,title,upvotes,downvotes,mine,my_vote}]}` |
| `vote` | `{event_id, token, request_id, value:-1|0|1}` | `{ok, request_id, my_vote, changed, upvotes, downvotes}` |

Error: `{ok:false, status, error}` with HTTP status = `status` (400/401/404/405/410/413/429/500/503).
Edge returns 503 `probe_unavailable` unless `SUPABASE_URL` host is exactly `ldxgejbzmpvsvozqmpfe.supabase.co` (https, default port).

## Install / operate / rollback (in order)
1. Install: run `001_install.sql` as one transaction (it contains its own BEGIN/COMMIT, preflight
   refuses if probe objects exist or pgcrypto/service_role missing, and verifies ACL before COMMIT).
2. Deploy Edge function `guest-token-probe` (after 1).
3. Fixtures (operator SQL only; codes are shown once — keep them out of logs/reports):
   `SELECT * FROM repair_guest_probe.operator_create_event('probe-A', interval '2 hours', 300);`
   `SELECT * FROM repair_guest_probe.operator_create_event('probe-B', interval '2 hours', 10);`
4. Run: `PROBE_URL=… PROBE_EVENT_A=… PROBE_CODE_A=… PROBE_EVENT_B=… PROBE_CODE_B=… python3 runner/fresh_clients.py --stages 25,50,100 --workers 100 > report.json`
   Report has `pass`; exit code 1 on any failed check or unexpected HTTP status. 176 admissions used (175 + 1 security guest).
   (keep event A `max_admissions` ≥ 176; event B only receives cross-event attempts.)
5. Disable immediately if needed: step 1 block of `900_disable_and_drop.sql` (marker off, events inactive, sessions revoked).
6. Remove: delete the Edge function, then run `900_disable_and_drop.sql` (disables first, refuses to drop a
   `public.repair_guest_probe_rpc` not carrying the probe comment, then drops only the RPC and schema),
   then remove the `[functions.guest-token-probe]` block from `config.toml`.
   The drop step is idempotent: it looks the function up with `to_regprocedure` (NULL when absent) rather than a
   literal `'<sig>'::regprocedure` cast, so re-running teardown after the objects are gone is a safe no-op while a
   same-signature function carrying a different comment is still refused.

## Tests (no network, no hosted DB)
- `bash supabase/repair-guest-probe/test/local_pg_test.sh` — throwaway local Postgres: install, ACL,
  hashing-at-rest, wrong/unknown code, resume, missing/forged/malformed/cross-event tokens, idempotent
  request, bounds, guest request cap, desired-state votes, immutable identity, spam 429, expiry, revocation,
  closed event, contract mismatch, disabled marker, 100 concurrent fresh joins, admission cap 429 under 30 concurrent,
  150 concurrent votes with exact counters and no deadlock, 100 barrier-released bad joins on a
  150-row bucket → exactly 200 rows / 50 typed 429 (fails without the mutex: observed 59/41), disable+drop,
  repeat teardown is a safe no-op, a same-signature function with a foreign comment is refused, app sentinel untouched.
  The throwaway cluster is started with `max_connections=400` so the 100–150 client bursts fit.
- `deno test supabase/functions/guest-token-probe/handler_test.ts` — host gate, methods, validation,
  field allowlist, typed error passthrough, no leakage, zero `fetch` calls (no Auth) over a full flow,
  endless stream without Content-Length → 413 + cancelled, oversized declared length, invalid UTF-8, 4 KB inner body bytes.
- `python3 supabase/repair-guest-probe/runner/test_runner_offline.py` — runner vs loopback fake:
  25/50/100 concurrent fresh clients with every check required, SHA-256 token uniqueness, same
  session on resume, 0 auth calls, negatives on a separate security guest, no token/code in report, and a
  broken-resume control that must yield `pass:false` and exit 1.
