# Guest integration — SOURCE REVIEW CANDIDATE, DISABLED / NOT INSTALLED

Lifecycle-pass baseline: `ca6ba866d4d6849e6b4d4c4e10fb36329136c966`. Staging only. No hosted
SQL, deployment, Auth signup/session minting, provider calls, secrets, quota,
publication or UI changes were performed. Disabled `repair_guest_probe` is untouched.

## Explicit unresolved review gates

1. Root reports 118 Auth users /117 profiles. `000_preflight.sql` lists missing
   profiles and their event/request/ledger/tip references, without emails or tokens.
   Installation REFUSES any orphan; root must inspect and resolve its disposition
   explicitly. No missing nickname/balance/profile is fabricated by this package.
2. Root must inspect actual FK definitions, writer bodies/ACLs and dependencies
   against the before/after catalogs. Protected lifecycle and writer protocol are
   implemented and tested locally, not certified against the hosted catalog.
   Registered deletion is now a protected two-step retirement, not raw cascade;
   the deliberate fail-closed behavior below requires review before installation.
3. Receive-only Edge WebSocket relay is the chosen NEXT bounded phase, not built.
   No anonymous Realtime policy will be authored. Platform/source review and tests
   are outstanding, as are frontend own-alias adapters, browser persistence and UI.

This is a backend candidate with local evidence, **not a completed/deployable guest
integration**. The existing app continues using unchanged deployed Auth boundaries.
Stripe config was independently reported not ready; provider checkout not tested.

## Review map and order

`000_preflight.sql`: read-only catalog/FK/ACL/ledger inventory; root must compare
actual installed core/payment definitions and save outputs before proceeding.
`001_principals.sql`: fail on Auth/profile orphan; add protected nullable
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
`before/`: canonical baseline function source copies; installation captures actual
hosted definitions for restoration. Source copies alone do not prove live parity.

## Installation — only AFTER gates resolved and independent review

Do NOT replay historical repairs/migrations. Root runs read-only preflight, reviews
all files, then executes **001..008 in one transaction**. Candidate deliberately
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

Snapshot is one SQL statement returning safe event state, latest 500 songs with own
vote/ownership, points, now-playing, latest 100 own-alias ledger entries, truncation
flag. No private Auth/profile PII, provider params, bootstrap/hash/secret projection.
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
target gets source minus duplicate 15 via explicit auditable transfer-in. Existing
original Starter ledger entries remain evidence. Claim retries to same account and
credential are idempotent; other accounts refused; source credentials revoked.

## Protected identity lifecycle and deletion

- Registered root: `profiles(id,auth_user_id)` with `auth_user_id=id` when nonnull;
  real FK to Auth uses RESTRICT. Auth principal composite FK requires that exact
  registered profile; guest principals use a profile-id FK, no Auth relationship.
- Backfill only existing profiles validated by their original Auth FK. The 118/117
  orphan aborts before any source schema change can commit. Root resolves it, not
  an automated guessed profile. No fake Auth rows or shared identities.
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
reconstructs baseline from canonical fixtures, no hosted queries. 72 assertions
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
