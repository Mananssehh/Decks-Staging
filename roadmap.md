# Roadmap

## Core staging audit repair
- [x] Stage ordered SQL for ACLs, admission, counters/bootstrap, atomic playback and bridge claims; retain preflight evidence and rollback.
- [x] Switch join, bridge and DJ source callers to repaired boundaries without deployment.
- [x] Run source tests and isolated database/concurrency fixtures; document unverified hosted behavior.
- [x] Independent reviewer installed core SQL; provider-owned supabase_admin defaults remain unavailable.

## Staging follow-up
- [x] Confirm core RPCs, regenerate hosted types, deploy matching core Edge functions.
- [x] Reconnect/cross-tab event and optimistic vote synchronization with regressions.
- [x] Safe disabled welcome sender deployed; domain absent explicitly reported.
- [x] Source-only reservation/settlement foundations, concurrency/retry fixtures and rollback.
- [x] PKCE code exchange and local redirect regression tests.
- [x] Zero-warning lint, frontend behavior and mocked Edge tests.
- [x] Root independently verified final production build/typecheck/lint/all 107 tests before the lifecycle repair; not agent-executed.
- [x] Complete canonical reserved/legacy webhook/refund/reconcile integration; reviewed SQL installed and canonical staging deployment complete.
- [ ] Official managed sender and durable business-event retry integration blocked on domain configuration and supported delivery design.
- [x] Root independently verified authenticated two-tab own-vote selection synchronization; no account/session minted here.
- [x] Independent reviewer installed follow-up SQL; canonical staging payment functions deployed in order.

## Backlog
- [ ] Replace hard-coded $100 tip limits ($50 single / $100 per 24h / $100 per event, currently constants inside `check_tip_cap` and `src/lib/purchaseCaps.ts`) with configurable, server-enforced limits (e.g. `app_config` row read by the cap function, admin-editable). Do not change current limit values as part of D3.
- [ ] Provider-blocked notification replay from financial/account evidence after owner-domain setup and official managed sender scaffolding; SQL email queues are prohibited.


## Payment integration completion (source-only)
- [x] Canonical reserved/legacy checkout, webhook and reconciliation boundaries.
- [x] Immutable redirects, retry lifecycle and evidence-backed ambiguity review.
- [x] Parallel PostgreSQL and canonical Edge integration regressions; lint/frontend behavior checks.
- [x] Ordered review/install/deployment and containment documentation.

## Final staging payment activation
- [x] Verified installed contract catalog and regenerated hosted types; deployed webhook/reconcile before checkout.
- [x] Read-only honest readiness and exact staging-origin fallback regressions.
- [x] Narrow generated MCP lint exclusion; preview refreshed; split snapshot race corrected and tested (authenticated two-tab proof remains root-owned).
- [x] Updated installed/deployed evidence and remaining provider gates.

## Final staging lifecycle repair
- [x] Remove the unpublished votes binding; preserve published song_requests/events feeds and all coherent refresh/optimistic/cleanup behavior.
- [x] Existing refresh/snapshot/event-entry regressions: 11 passed; zero-warning lint passed; runtime catch and source evidence recorded.
- [x] Root verified both tabs paused/live/ended without reload and ended-vote toast; reviewer evidence, no agent session access.

## Final staging Stripe key compatibility
- [ ] Validate secret/restricted test/live keys with pure no-provider tests and zero-warning lint.
- [ ] Deploy all inventoried shared-helper dependents to staging and record exact evidence; no provider operations.
