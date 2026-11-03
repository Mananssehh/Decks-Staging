# Guest integration — SOURCE REVIEW CANDIDATE, DISABLED / NOT INSTALLED

Readiness-pass baseline: `8a813500b545f966ef342cffcd0ad2ac989ba4f3`. Staging only. No hosted
SQL, deployment, Auth signup/session minting, provider calls, secrets, quota,
publication or UI changes were performed. Disabled `repair_guest_probe` is untouched.

## Explicit unresolved review gates

1. Root identified and authorized repair of the sole genuine missing bootstrap
   profile: existing anonymous legacy DJ `46d7d47d-1b21-4351-a268-a1ccf95e1f42`.
   Separate `000_targeted_bootstrap.sql` is ready for independent review, NOT run.
   The normal orphan gate still refuses every other unresolved missing profile.
2. Root must inspect actual FK definitions, writer bodies/ACLs and dependencies
   against the before/after catalogs. Protected lifecycle and writer protocol are
   implemented and tested locally, not certified against the hosted catalog.
   Registered deletion is now a protected two-step retirement, not raw cascade;
   the deliberate fail-closed behavior below requires review before installation.
3. Receive-only Edge WebSocket transport and 010 revision overlay are source-built,
   disabled and not installed/deployed; hosted native upgrades/capacity await root.
   No anonymous Realtime policy will be authored. Platform/source review and tests
   are outstanding, as are frontend own-alias adapters, browser persistence and UI.

This is a backend candidate with local evidence, **not a completed/deployable guest
integration**. The existing app continues using unchanged deployed Auth boundaries.
Stripe config was independently reported not ready; provider checkout not tested.

## Review map and order

`000_preflight.sql`: read-only catalog/FK/ACL/ledger inventory; root must compare
actual installed core/payment definitions and save outputs before proceeding.
`000_targeted_bootstrap.sql`: separately reviewed exact existing-account repair.
`001_principals.sql`: fail on remaining Auth/profile orphan; add protected nullable
profiles.auth_user_id → auth.users and registered id consistency; private principals
reference profile id and (id,auth_user_id), not Auth. Capture actual before-functions
and named ownership constraints. Replace request/vote/tip/funnel ownership targets,
preserving original actions. No normal DJ/account Auth FK or identity changed.
`002_join_kernel.sql`: existing repaired admission, explicit actor/aliases.
`003_request_kernel.sql`: existing normalization/blocklist/cooldown/dedup, explicit
actor; authenticated request signature unchanged; shared vote kernel.
`004_sessions_api.sql`: hashed bootstrap/event token, deterministic lost-response
retry, real queue/profile/ledger/report/funnel operations and coherent SQL snapshot.
`005_claim.sql`: nonanonymous Auth + credential claim; deterministic exclusion,
immutable history, overlap evidence/dedup and ledger transfer with 15 starter dedup.
`006_financial_aliases.sql`: existing financial functions with canonical mutex,
alias cap/membership/consent/idempotency; frozen provider identity/params untouched.
`007_acl.sql`: RLS/ACL/backfill checks, installed marker DISABLED.
`008_writer_lifecycle.sql`: outer legacy-writer exclusion, statement guards,
immutable profile links, registered retirement and standalone alias-aware award.
`009_after_catalog.sql`: read-only post-install FK/trigger/function/rowcount evidence;
capture alongside `000_preflight.sql`. This is not an installation mutation.
`010_stream.sql`: private revisions, transactional triggers, coherent snapshot
revision overlay, token auth and bounded batch polling; stream marker DISABLED.
`910_drop_stream.sql`: transport-only teardown retaining guest core and evidence.
`before/`: canonical baseline function source copies; installation captures actual
hosted definitions for restoration. Source copies alone do not prove live parity.

## Installation — only AFTER gates resolved and independent review

Do NOT replay historical repairs/migrations. Root runs read-only preflight, reviews
all files, then executes **000_targeted_bootstrap, rerun 000_preflight, then 001..008 and 010_stream in one transaction**. Candidate deliberately
starts disabled. Root captures `009_after_catalog.sql` and checks rowcounts,
four ownership FK replacements, the protected profile chain and every remaining
Auth FK/action, all private table RLS/ACL, service-only API, authenticated-only claim,
all original function/table policy fingerprints not intentionally modified.
Only after blockers/tests pass, root may enable marker in a separate reviewed step.
Entrypoint `supabase/functions/guest-event/index.ts` calls only fixed guest_event_api,
using server service role. Deployment must set verify_jwt=false **only guest-event**;
no project config or existing endpoint config changed in this source turn.

## Operation shapes for later frontend integration

POST body `{action, payload}` only; never tokens/codes in URLs, logs or analytics.
- join: `{bootstrap: 64-lowercase-hex, code, nickname}`; valid code first, server
  UUID principal, starter 15 + existing join award, no Auth row. Browser bootstrap
  must be random 32 bytes, not UUID/fingerprint. Lost response retry uses same secret.
- resume/snapshot/ledger: `{event_id, token}`. Resume same session, no new token.
- request: scope + `{idempotency_key: UUID, source_platform, source_song_id, title,
  artist, album?, album_art_url?, duration_ms?, preview_url?, explicit?, external_url?}`.
- vote: scope + `{request_id,value:-1|0|1}`; remove: scope + `{request_id}`.
- profile: scope + `{nickname?}`; report: scope + `{target_type,target_id,reason,details?}`.
- funnel: scope + `{event_type}`. Arbitrary metadata discarded to keep credentials out.
- claim (authenticated RPC, not guest API): `claim_guest_principal(bootstrap,event_id?,token?)`;
  registered Auth UID canonical; `get_my_principal_aliases()` for signed-in adapters.
- future payment adapter: service-only `guest_validate_actor(event_id,token)`;
  NO provider adapter changes/deployment in this phase.

Authenticated-only `get_my_event_snapshot(event_id)` derives Auth UID, authorizes
event owner or unbanned alias member, and shares the snapshot kernel; supplied UUID
alone does not authorize. `get_my_principal_aliases()` remains available. Table RLS
is unchanged. Snapshot is one SQL statement returning safe event state, latest 500 songs with own
vote/ownership, points, now-playing, latest 100 own-alias ledger entries, truncation
flag. No private Auth/profile PII, provider params, bootstrap/hash/secret projection.
Songs include every existing SongRequestRow field (including immutable requested_by,
external/preview URLs, album/duration/source/explicit/playback evidence); now-playing
includes id/event_id/source/updated_at plus playback/link fields matching current row.
Profile projection is whitelisted and contains no Auth/provider PII. Reads acquire
shared event/session locks, mutations exclusive locks from entry, never upgrades.
No Broadcast topic supplied; receive-only Edge feed implementation remains next phase.

Budgets: 120 reads/min and 30 mutations/min/principal; bootstrap failed joins
10/10min, existing admission 300/event/10min and 10/identity/10min; three-event
anonymous gate retained. No shared-IP venue ceiling. 429 typed; no endpoint retries.
Sessions expire after 12h; expiry/revocation requires new authorized lifecycle design,
not silent token renewal. Treat 4xx as final; no tight client retry loops.

## Claim and evidence

Source historical request/vote/financial identities remain unchanged. Duplicate
votes/memberships are captured privately before removal; counter delta triggers run.
Claim takes exclusive integration guard, ordered identity/tip/event/profile locks;
normal kernels take shared guard. Legacy DJ transition/position/broadcast and
profile update acquire shared guard at entry using actual captured bodies.
Direct app DML and financial evidence/reservation DML acquire the shared guard
BEFORE STATEMENT, before tuple locks; award resolves aliases only after exclusion.
Never first acquire exclusion from a row trigger or after SELECT FOR UPDATE.
Operator multi-statement transactions must take the shared gate at entry before
any explicit row lock; arbitrary owner SQL is not a supported app writer.
This is correctness-first but global claim exclusion limits throughput. Guest balance must reconcile
exactly; inconsistent or spent-below-starter balance is refused for manual review.
Target existing balance preserved; source transfer-out zeros source ledger/balance;
target gets source minus duplicate 15 and matched overlapping Joined event rewards.
Each canonical one-point overlap has an explicit negative target ledger entry and
private source/target ledger evidence. Membership alone is not duplicate reward
evidence; nonoverlap rewards transfer fully. Unexpected reward amounts/net balance
refuse review. Prior alias compensations count in net reward evidence. Existing
original Starter ledger entries remain evidence. Claim retries to same account and
credential are idempotent; other accounts refused; source credentials revoked.

## Protected identity lifecycle and deletion

- Registered root: `profiles(id,auth_user_id)` with `auth_user_id=id` when nonnull;
  real FK to Auth uses RESTRICT. Auth principal composite FK requires that exact
  registered profile; guest principals use a profile-id FK, no Auth relationship.
- Backfill only existing profiles validated by their original Auth FK. The 118/117
  orphan gate remains mandatory after the separately reviewed repair. No fake Auth
  rows or shared identities.
- Signup: existing app-owned handle_new_user inserts protected profile first,
  then principal, existing guest role and starter ledger once. An AFTER profile
  insert trigger also supports legacy ensure/upgrade recovery; BEFORE insert
  derives link only from an existing real Auth row. Existing profile ownership and
  sensitive-column guards are not weakened; links cannot be edited or cleared.
- Raw Auth DELETE is restricted while a profile exists: no new Auth deletion
  trigger, and no Auth tuple → profile cascade → claim-gate inversion.
- Operator retirement: service-only `prepare_registered_profile_deletion(id)`
  acquires exclusive claim gate BEFORE Auth tuple, authorizes profile removal only
  for that transaction, then deletes profile/principal/credentials atomically.
  After commit the operator's existing Auth deletion process can remove the real
  Auth account. This source never calls an Auth provider. If deletion later fails,
  account remains real but without a profile; operator must finish or explicitly
  repair before reinstall preflight (no silent backfill). Prefer one operator
  transaction for retirement + authorized Auth deletion where available.
- Direct registered profile DELETE refuses while its Auth account exists.
  Unclaimed guest profile DELETE cascades principal and credentials. Original
  request SET NULL / vote+tip+funnel CASCADE remain; point ledger is historical.
  Other financial evidence FKs can deliberately refuse removal; do not force it.
- Claimed source or target deletion is RESTRICTED by claims/merged_into genuine
  FKs; both raw Auth deletion and protected retirement refuse atomically. Keep
  alias history and original provider owners; an eventual retention/deletion
  workflow needs independent review, not dangling unchecked Auth UUIDs.
- Direct ban writes share claim exclusion; source bans remain alias-effective.
  This is claim compatibility, not a new strict event-mutex ordering guarantee
  for ban versus ordinary vote/reservation authorization checks.

## Disable / containment / destructive rollback

Root can run `900_contain.sql`: marker disabled, all guest bootstrap/sessions revoked,
guest API/validate/claim execution closed. Auth wrappers/principals/FKs/evidence stay
installed. Does not disable app events, Auth, payments, email or isolated probe.
`950_restore_empty.sql` restores captured function definitions/FK constraints and
drops only integration objects **only if ZERO guest principals exist**. Any guest
records, even claimed/revoked, force refusal. Do not delete guests to bypass guard.
Rollback removes new guards/retirement functions/profile column and restores actual
captured FKs/functions; it refuses even revoked/claimed guest history. Preserve
before/after catalog and ACL evidence and review defaults before executing.
Never deploy source rollback without review.

## Local evidence (2026-11-03 UTC)

`bash supabase/guest-integration/test/run.sh`: throwaway UNIX-socket Postgres;
reconstructs baseline from canonical fixtures, no hosted queries. 100 readiness assertions
passed including 100 concurrent fresh joins, unchanged Auth rowcount, lost-response
join retries, exact starter/join points, request idempotency, 100 concurrent votes,
coherent own snapshot, paused behavior, parallel claim/ledger/counter/alias-ban,
alias financial 50/100/30% boundaries, expiry/contract/ACL, normalized profanity/spam,
three-event gate, cross-event denial, 30-success/10-typed-429 mutation burst,
independent read budget and immutable alias financial settlement/mismatch refusal.
Additional lifecycle assertions prove real FK rejection, immutable registered
links, ensure/upgrade compatibility, raw Auth/profile deletion refusal, protected
retirement, guest credential cascade, claimed-source/target and retirement refusal.
Six concurrent writer/claim transactions are observed waiting on the exclusion
gate (not a timing-only test): DJ playing transition, ban, profile update,
standalone award, financial settlement and claim. All finish with reconciled
ledgers, immutable tip owner, succeeded settlement, one-playing and alias ban.
Separate Auth-orphan fixture refuses installation without generating data.
Raw Auth deletion under an exclusive claim gate returns FK refusal rather than
waiting for a profile cascade; protected retirement then deletion succeeds.
Containment/refusal passed; separate local empty rollback restored every original
public function definition, original profiles Auth cascade FK and removed all new
lifecycle triggers/column. Existing payment fixture: 57 assertions plus containment
passed on a separate throwaway database. The test's cloned local fixtures are disposable only;
it does not demonstrate permission to delete hosted guest records.
`deno test supabase/functions/guest-event/handler_test.ts`: 8 no-network tests passed.
Endpoint/index Deno checks and full zero-warning eslint passed. Existing Vitest:
98 passed, 9 production-bundle checks failed because no compiled dist assets exist
in this sandbox; no app build was manually run and tests were not weakened.
This is not hosted acceptance, venue Wi-Fi/Realtime capacity, browser persistence,
full production compatibility, payment provider readiness or sustained load proof.

Readiness rerun: 100 guest assertions (original lifecycle/concurrency coverage
retained and extended), 15 separate targeted-bootstrap assertions, exact empty
before/after function/constraint/column/guard restoration and containment passed.
100 simultaneous read transactions held shared event locks before release; an
exclusive mutator waited then completed without upgrade deadlock. DTO tests assert
concrete full request/now-playing data; authenticated owner/member/alias snapshot,
outsider/ban refusal, multiple overlap rewards, missing-reward/nonoverlap evidence,
prior-compensation aliases, retry and both-balance reconciliation are covered.
57 existing financial assertions and 8 unchanged no-network endpoint tests passed;
endpoint checks and zero-warning lint passed. Unchanged frontend suite: 98 passed,
9 failed solely because compiled bundle assets were absent, no manual build/skip.

## Exact targeted pre-install bootstrap plan (NOT EXECUTED)

Root confirmed the named Auth ID is anonymous, sole role DJ, owns one existing
event, has metadata nickname, and no profile/ledger/membership/request/vote/tip/
payout evidence. The repair copies actual metadata nickname using the canonical
`coalesce(metadata nickname, 'Guest')` fallback. Inserts +1 profile with 15 points,
is_public=false/is_premium=false and +1 earned Starter points ledger of 15; default
current timestamps, never backdated. Existing 117 profiles unchanged; Auth/roles/
events unchanged (+0 each). Planned totals after repair: 118 Auth /118 profiles,
ledger +1, total points +15. 001 backfills 118 registered principals (+118), keeps
legacy IDs, and installs the protected profile FK chain. Retry of exact completed
bootstrap changes zero rows. Existing unexpected profile/ledger, changed identity/
role/event counts or financial/ownership evidence abort rather than overwrite.
Root saves preflight before repair and reruns it after repair in the same transaction,
verifying exactly one Starter ledger and points=15, no orphan, unchanged fingerprints
of the other 117 profiles and the original Auth/role/event. No repair was run hosted.
Empty integration rollback preserves this legitimate audited bootstrap repair; it
restores the catalog captured after repair, not the previously broken missing profile.

## Next adapter / stream gates (not implemented)

Before guest UI integration: verified guest-capable music-search and tip/consent
adapters must validate event credentials server-side, retain canonical pricing,
consent/cap/idempotency and immutable financial parameters. No provider or Edge
changes here; current Stripe config remains unready. Worker-shared private revision
polling WebSocket feed is now source-built; next are root platform acceptance and
frontend persistence/alias adapters. See REALTIME_DESIGN.md; no policies or cron.

## Stream phase evidence and protocol (source only)

Baseline `9cde36149c75fa6573750b32c7cdcddebc36757a`; 001..008 unchanged.
`supabase/functions/guest-event-stream/` contains SDK-free protocol, connection,
hubs, injected upgrade handler, thin native Deno entrypoint and no-network tests.
GET upgrade only, exact staging backend, no query/subprotocol credentials. First
frame `{type:"auth",event_id,token}` within 5s, max 4KB; trusted session/expiry
retained, token not retained in connection/hub state. After auth only bounded
`{type:"ping"}` / `{type:"pong"}` at most one/second; client publishing/re-auth denied.
Initial `{type:"ready",revision,resync:true}` always requires full API snapshot.
Poll every 2s/event/worker (one inflight), batch <=256, <=256 sockets/event and
1024/worker including pending upgrades, no IP cap. Empty hubs stop all poll timers;
5s backend timeout and 64KB outbound backpressure limit. Invalid batch sessions
close1008 BEFORE sending changed revision to survivors. Ended events remain readable
and yield lifecycle hints; event deletion/missing membership closes access.
503/network failures send service_unavailable/retry and close1013, not invalid Auth;
clients must preserve credentials. Worker shutdown/120s connection rollover send
reconnect/resync then close1001. Heartbeat stale after60s closes. UI jittered reconnect
and low-rate snapshot fallback are NEXT phase. No claim of hosted runtime acceptance.

010 revision triggers cover events/songs/now-playing/bans/memberships/sessions,
including claim revocation and profile/session cascades; actual no-op writes skip.
Bumps use only existing revision UPDATE after child writes, no identity/event mutex
acquisition or FK upsert that reverses event locks. Event insert seeds a row; event
delete cascades without resurrection. Transaction rollback rolls back revision.
Snapshot overlay modifies the captured safe SQL expression to include revision in
the SAME SQL view and refuses unrecognized source; revision encoded decimal text.
Both enabled contract markers required for stream auth/poll, marker starts disabled.
No idle cron, Realtime channel/policy, provider or Auth API. Poll is one MVCC read,
service-only IDs from successful token auth stored server-side, never public auth.

Local: 100 guest assertions with overlay installed +15 targeted bootstrap, 39 new
stream SQL assertions, 13 pure/native-adapter transport tests +8 existing endpoint
tests, 57 financial assertions; containment, stream-only teardown twice and exact
empty catalog restoration. Deno checks/lint verified. Frontend unchanged:98 pass,
9 absent-production-bundle failures, no manual build/weakening. Root must review
SQL/source and enable markers before separately authorized deployment; future new
endpoint deployment verify_jwt=false only guest-event-stream, configuration unchanged
here. Actual100 API+100socket/reconnect capacity and platform limits remain untested.

## 011 application source review (not installed or deployed)

The browser guest flag is **OFF** (`ENABLE_GUEST_APPLICATION=false`) and can only
enable on the authorized staging backend. Existing Auth and legacy anonymous Auth
keep their old path. No hosted SQL, deployment, Auth creation, provider request,
publication or secret/quota changes were made in this phase.

Event-scoped credentials live only in backend-scoped browser storage and POST/auth
frames, never URLs or analytics. Real guest actors are separate from Auth users.
Guest screens use the verified snapshot/API and one receive-only socket, with
coalesced refresh, desired-vote safeguards, reconnect resync and low-rate fallback.
Claim needs explicit pending intent and verified nonanonymous Auth; proof survives
confirmation/PKCE and is cleared only on confirmed/idempotent claim. Unrelated
login does not create intent. Pending tip keys can be recovered through own aliases.

**Eventual install order, one independently reviewed transaction:** targeted
`000_targeted_bootstrap.sql`, rerun preflight, `001` through `008`, `010_stream.sql`,
`011_application.sql`, then `009_after_catalog.sql` and application assertions.
Keep both runtime and stream markers disabled until root explicitly verifies and
enables them. Do not run historical migrations. Existing `001..010` files remain
unchanged; 011 captures replaced definitions for review and empty rollback.

011 adds protected retirement evidence, stale-JWT insertion refusal, atomic
returning-bootstrap nickname synchronization, HTTPS-only input and stored snapshot
links, deterministic manual identity and active provider/title/artist deduplication.
Both Auth and guest requests share the same kernel. Service-only
`guest_application_actor(event,token,operation)` validates scoped catalog/tip/consent
access; consent records `v2-tips-2026-06-12` server-side. Scoped public profile and
aggregate succeeded-tip helpers expose no Auth/email/provider identities. Private
profiles are not linked from queue entries. Pricing/payment-v3 reservations and
provider parameters remain unchanged; Stripe readiness is still unready and no
provider checkout success is claimed.

Containment remains `900_contain.sql`: disable markers/revoke sessions and preserve
data. Empty destructive rollback refuses guest evidence, restores captured public
definitions, drops the new application RPCs and private overlay. Stream-only
teardown is safe before application installation; after 011 use containment/full
reviewed empty restore rather than dropping its snapshot dependencies independently.

Source inventory: `guestApplication/guestClient/guestStream`, `GuestProvider` and
`useActor`; Join/EventPage/header/profile/ledger/public profile/report/upgrade/
callback/now-playing/tip callers; shared `_shared/application-actor` resolver,
music-search, guest-event dispatch and canonical checkout adapter. Generated hosted
types and MCP ownership/exact lint exclusion are unchanged.

Remaining acceptance gates: root SQL/ACL/lifecycle review and install, disabled
marker/endpoint readiness checks, authorized endpoint deployment, actual browser
join/claim/multi-tab/provider-link testing and 100 guest API+socket/reconnect load.
These are not established by mocks or the earlier isolated probe. Full account-wide
ledger pagination and shared-browser explicit existing-account claim UX require
additional acceptance review before turning the flag on.
