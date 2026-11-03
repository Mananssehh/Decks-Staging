# Guest integration — SOURCE REVIEW CANDIDATE, NOT INSTALL-READY

Baseline: `6c093735ccb2a7f1846f46cda26583a3c808e2e6`. Staging only. No hosted
SQL, deployment, Auth signup/session minting, provider calls, secrets, quota,
publication or UI changes were performed. Disabled `repair_guest_probe` is untouched.

## Explicit unresolved review gates

1. Requested private `app_principals.auth_user_id → auth.users` FK conflicts with
   current managed schema rules (only public profiles/user_roles may reference
   Auth). **No substitute is represented as equivalent protection.** Candidate
   backfills Auth IDs and inserts principals in existing bootstrap trigger but
   does not yet preserve Auth deletion cascade/lifecycle. Do not install until
   an approved identity/FK lifecycle design replaces this gap.
2. Anonymous receive-only private capability Broadcast policy conflicts with
   current supported per-Auth-user topic guidance. No policy/cron/Realtime mutation
   was authored. `REALTIME_DESIGN.md` records exact coalescing/rotation/wake/drain
   requirements for independent authorization and hosted testing.
3. Full compatibility review still required: direct Auth RLS reads of old alias
   votes/points/tips are unchanged; UI must use own-alias adapters after installation.
   Profile profanity/spam parity is not complete (current basic length/control/URL
   validation is not equivalent to existing frontend profanity/spam lists).

This is a backend candidate with local evidence, **not a completed/deployable guest
integration**. The existing app continues using unchanged deployed Auth boundaries.
Stripe config was independently reported not ready; provider checkout not tested.

## Review map and order

`000_preflight.sql`: read-only catalog/FK/ACL/ledger inventory; root must compare
actual installed core/payment definitions and save outputs before proceeding.
`001_principals.sql`: backfill every Auth ID; captures actual before-functions and
exact named ownership constraints, replaces ONLY profiles.id, requests.requested_by,
votes.user_id, tips.user_id and funnel.user_id FK targets; preserves delete action.
Private RLS/no browser or service table access. No normal DJ/account FK changed.
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
`before/`: canonical baseline function source copies; installation captures actual
hosted definitions for restoration. Source copies alone do not prove live parity.

## Installation — only AFTER gates resolved and independent review

Do NOT replay historical repairs/migrations. Root runs read-only preflight, reviews
all files, then executes **001..007 in one transaction**. Candidate deliberately
starts disabled. Root checks rowcounts, five FK replacements and every remaining
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
No Broadcast topic supplied while the capability policy remains blocked.

Budgets: 120 reads/min and 30 mutations/min/principal; bootstrap failed joins
10/10min, existing admission 300/event/10min and 10/identity/10min; three-event
anonymous gate retained. No shared-IP venue ceiling. 429 typed; no endpoint retries.
Sessions expire after 12h; expiry/revocation requires new authorized lifecycle design,
not silent token renewal. Treat 4xx as final; no tight client retry loops.

## Claim and evidence

Source historical request/vote/financial identities remain unchanged. Duplicate
votes/memberships are captured privately before removal; counter delta triggers run.
Claim takes exclusive integration guard, ordered identity/tip/event/profile locks;
normal kernels take shared guard. This is correctness-first but global claim
exclusion is a throughput limitation needing review. Guest balance must reconcile
exactly; inconsistent or spent-below-starter balance is refused for manual review.
Target existing balance preserved; source transfer-out zeros source ledger/balance;
target gets source minus duplicate 15 via explicit auditable transfer-in. Existing
original Starter ledger entries remain evidence. Claim retries to same account and
credential are idempotent; other accounts refused; source credentials revoked.

## Disable / containment / destructive rollback

Root can run `900_contain.sql`: marker disabled, all guest bootstrap/sessions revoked,
guest API/validate/claim execution closed. Auth wrappers/principals/FKs/evidence stay
installed. Does not disable app events, Auth, payments, email or isolated probe.
`950_restore_empty.sql` restores captured function definitions/FK constraints and
drops only integration objects **only if ZERO guest principals exist**. Any guest
records, even claimed/revoked, force refusal. Do not delete guests to bypass guard.
Full rollback must additionally review grants/default ACL and future lifecycle/
Realtime changes once those are added. Never deploy source rollback without review.

## Local evidence (2026-11-03 UTC)

`bash supabase/guest-integration/test/run.sh`: throwaway UNIX-socket Postgres;
reconstructs baseline from canonical fixtures, no hosted queries. 36 assertions
passed including 100 concurrent fresh joins, unchanged Auth rowcount, lost-response
join retries, exact starter/join points, request idempotency, 100 concurrent votes,
coherent own snapshot, paused behavior, parallel claim/ledger/counter/alias-ban,
alias financial 50/100/30% boundaries, expiry/contract/ACL and containment refusal.
`deno test supabase/functions/guest-event/handler_test.ts`: 8 no-network tests passed.
This is not hosted acceptance, venue Wi-Fi/Realtime capacity, browser persistence,
full production compatibility, payment provider readiness or sustained load proof.
