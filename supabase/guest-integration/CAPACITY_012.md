# 012 capacity repair: canonical source of the hosted reviewer state

## Current status (2026-11-03, base `b52f4fd8`)

- **Hosted (root-performed, not by this source):** the reviewer committed the materialized snapshot at
  06:33:40 UTC and materialized aliases/member at 06:45:05 UTC after full JSON equality; all 468 principal
  alias arrays and 40 membership outcomes unchanged. Prior definitions are captured by root in private RLS
  `guest_runtime.reviewer_snapshot_baseline` / `reviewer_identity_baseline` (audit evidence; 012/912 never touch them).
  No `guest_principals_merged_into` index and no `capacity_before` exist hosted.
- **Root hosted acceptance (root evidence, not reproduced here):** new QA event `f5290e13-...` (`GUESTQB`):
  25/25 flows 26.995 s, 50/50 36.535 s, 100/100 34.304 s (joins 5.979 s); 1231 HTTP 200 + 2 expected 401,
  0 Auth HTTP, Auth users 118 unchanged. 100 WebSockets connected in 5.076 s; all received 3 rounds and
  coherent 100 snapshots incl. 100 concurrent votes; all reconnected after 120 s rollover (130.743 s total;
  200 ready, 442 invalidate, 600 pong, 100 rollover hints, no `service_unavailable`).
- **This source:** `012_capacity.sql` now reproduces EXACTLY the three hosted definitions (verbatim
  `pg_get_functiondef`, md5 aliases `6b4fac91...`, member `c1dbf1dc...`, snapshot `c2cda1c3...`; reference copy
  `before/capacity_root_observed.sql`). States: fresh 011 triple (`b2a23574...`/`9b1f695d...`/`83fa330d...`) ->
  capture all three into private RLS `capacity_before` and install; exact hosted triple -> no-op; anything else
  (including partial snapshot-only state) -> refused, no artifacts. No index. 912 restores the three captured 011
  definitions only when `capacity_before` exists; on the hosted state it is a no-op. **Do not replay on hosted;**
  it would be a no-op there by design, and no hosted SQL was run in this turn.

The sections below are the original diagnosis and earlier (superseded) candidate history.


Base source `58d36da632e4ee4ec700f2dabbc96354a4fb3e2c`. Hosted 001..011 unchanged; markers untouched.

## Hosted evidence (staging, 2026-11-03 06:10:30-06:17:00 UTC, read-only log/catalog queries)

- Postgres logs: the ONLY error class was `57014 canceling statement due to statement timeout`, 26x
  (06:13:27-06:14:47), every one on the PostgREST call of `public.guest_event_api`.
  No deadlocks (`40P01`), no `55P03`, no OOM/connection errors.
- Lock waits (log_lock_waits, deadlock_timeout 1 s): ~410 waits, all on ONE tuple, relation 18087 =
  `public.events` ctid `(0,44)` = QA event `b8a94350-...` (`GUESTQA`). `AccessExclusiveLock on tuple`
  (queued FOR UPDATE writers) and `RowShareLock` (queued FOR SHARE readers). Mean wait grew
  1.4 s -> 4.7 s per 30 s bucket, max 7.8 s, i.e. right up to the timeout.
- API gateway for `/rpc/guest_event_api`: 1038x200, **26x500** (= the 57014s) and **22x504**
  (06:13:14-06:13:54, PostgREST pool acquisition timeout while all pool connections waited on the tuple).
  Edge `guest-event`: 1035x200, 47x503 (`upstream_unavailable`) = 26 + 22 (minus one in flight).
- Role settings: `authenticator statement_timeout=8s, lock_timeout=8s`; `jit=off` (JIT not involved).
- `pg_stat_statements`: `guest_event_api` slow group 1049 calls, mean 1613 ms, max 7853 ms. Root's own
  `EXPLAIN ANALYZE guest_runtime.snapshot(...)` on the QA event: 1537.547 ms JIT ON,
  1544.924 ms JIT OFF (default OFF). Root's minimal materialized snapshot candidate in a rolled-back
  transaction took 54.202 ms, roughly 28x faster; this is root-reported evidence, not our hosted benchmark.
- Data at failure: 293 `app_principals`, 149 songs, 279 votes, 175 members on the QA event.

## Cause

`guest_runtime.aliases()` has `SET search_path` (never inlined) and filtered
`id=actor(x) OR merged_into=actor(x)`; `merged_into` had no index, so every call seq-scanned all
principals and evaluated the non-inlined `actor()` per row (~2 x 293 function calls per alias lookup).
`snapshot()` called `aliases()` twice per song (`is_mine`, `my_vote`), so cost was O(songs x principals)
and grew as the test itself added guests and songs: fine at 25/50, ~1.5 s at 100.
Snapshot runs while the session holds the event row `FOR SHARE` (by design); request/vote take the same
row `FOR UPDATE`. 1.5 s share holds made writers and later readers queue on the tuple, the 10-connection
PostgREST pool filled with waiters (504), and queued statements hit the 8 s timeout (500 / 57014).
Not caused by Edge concurrency, JIT, deadlocks, or pool size itself.

## Earlier candidate (superseded by the canonical state above)

- Partial index `app_principals(merged_into) WHERE merged_into IS NOT NULL`.
- `aliases()` rewritten as two index probes (UNION) with `actor()` inlined as
  `coalesce(c.merged_into,c.id)` of the single row `c.id=_actor`. Same set, same order, `'{}'` for unknown.
- `snapshot()` computes canonical actor and alias set once (`WITH ... AS MATERIALIZED`, so the planner
  cannot substitute the calls back per row); `profile_linkable` uses the exact root-supplied protected
  principal/profile scalar join. `self_identity`, `canonical_id`, `alias_ids` and all DTO expressions
  match that derivative, not a different projection or lock protocol.
  Still ONE SQL statement (single MVCC snapshot); projection/DTO unchanged.
- Unchanged: event-before-request lock order, SHARE/UPDATE choice at entry, actor advisory mutex,
  claim exclusion, writer kernels, budgets/caps, ACLs, no browser DML, no public object touched.
- Guards: requires 011, refuses reinstall, refuses unless installed `aliases`/`snapshot` md5 equal the
  original hosted pair (`b2a23574...`, `83fa330d...`) OR the exact root materialization pair
  (`6b4fac91...`, `c2cda1c3...`); captures exact prior definitions for rollback.
  No pool, timeout, quota or instance changes (even the previous local timeout SET was removed).
  May be installed with markers enabled (only STABLE read helpers + brief SHARE lock on a small table);
  root decides. Run 912 before any 910/950 rollback.

## Local proof (`bash supabase/guest-integration/test/run.sh`, PG 17, full suite exit 0)

Latest refinement run: 15 bootstrap + 100 matrix + 39 stream + 16 application + **25 capacity**
assertions, both baseline rollback paths twice, containment and exact empty restore passed.
Snapshot **370.5 -> 28.5 ms** (~13x); local fresh100 **37.25 -> 2.91 seconds**, zero SQL/typed
errors after 012. All 100 final snapshots verified, not a 25-person sample. This local run did NOT
reproduce the hosted failure (its unoptimized flow also completed); it verifies the optimization,
not hosted acceptance. Prior local timing below is retained as historical evidence.

Added rolled-back 510-song/110-ledger fixture: old/new JSON equality, 500-song cap/truncation,
100-ledger cap, unsafe URL removal/HTTPS preservation, private DTO fields; every other public/private
function definition unchanged; backup RLS and anon/authenticated/service-role access denial.
Different-actor writer remains blocked behind a snapshot's event SHARE lock until release, then
completes. No timeout or lock weakening. 12 no-network Edge observability tests and zero-warning lint pass.

`test/capacity.ts` reproduces the hosted shape (293 principals, 149 songs, 280 votes) and drives 100
fresh guests (join, snapshot, request, vote common, snapshot) through a 10-connection pool with
8 s statement/lock timeouts:

| | snapshot mean | fresh100 wall | snapshot p95 | request p95 | vote p95 |
|---|---|---|---|---|---|
| 011 | 625 ms | 58.7 s | 31.3 s | 15.6 s | 3.6 s |
| 012 | 25 ms | 2.5 s | 0.56 s | 0.58 s | 0.54 s |

(Latencies include pool queueing.) Assertions: aliases identical for every principal (+ unknown actor,
incl. merged sets); snapshot identical for every principal x small event and for DJ, all alias principals,
40 members and 5 non-members (NULL) of the capacity event; >=5x faster; zero SQL errors and zero typed
failures; exactly +100 requests; common upvotes exactly +100 and equal to vote rows; 25 final snapshots
coherent (own request `is_mine`, `my_vote=1`, own profile); no leaked advisory locks; 012 reinstall
refused; 912 twice restores exact 011 definitions and removes index/evidence table. Existing 15
bootstrap + 100 matrix + 39 stream + 16 application assertions and containment/empty rollback still pass.

## Edge observability (source only, not deployed)

`guest-event` now logs one JSON line per upstream failure: `evt, cid, action, sqlstate` (5-char SQLSTATE
or `PGRSTnnn`, else `none`), `category` (statement_timeout, pool_timeout, lock_timeout, deadlock, ...),
`upstream_status`, `ms`. The random `cid` is returned in `x-correlation-id`; the public 503 body stays
`upstream_unavailable`. No payload, token, bootstrap, room code, SQL detail, raw message or PII. Typed
backend refusals are not logged; no retries. 12 Deno handler tests pass. Deployment not needed for the
diagnosis above (Postgres/gateway logs sufficed); deploy only after root review.

## Hosted repeat note

The first hosted 100 guests ALL JOINED but request/vote/snapshot operations failed; **not a pass**.
Root will repeat fresh100 HTTP on a **new QA event** to avoid admission-window and fixture confounding,
then 100 WebSockets (not yet tested). The unchanged event budget is 300 admissions/10 minutes.
Frontend flag remains OFF; root-enabled guest/stream markers are untouched here. No deployments,
hosted writes, SQL installs, providers, Auth creation or retry identities in this refinement.

## Read-only baseline discovery during refinement

Read-only `pg_get_functiondef` inspection already found root's exact optimized snapshot AND a
materialized-root `aliases()` hosted, **without `capacity_before`**. This differs from the message's
rolled-back-only state; do not infer how/when another actor installed it or apply 012 blindly.
Captured source: `before/capacity_root_observed.sql` (reference only, NEVER an install script).
012 now accepts only these two explicitly reviewed pairs, not arbitrary combinations. 912 restores
the captured installed definition; with the root pair, rollback retains the root's optimized snapshot,
instead of regressing to old 011. Root must confirm the current baseline and review before installing.
