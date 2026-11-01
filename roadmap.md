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
- [ ] Production-bundle verification blocked on production build artifact; nine assertions fail honestly.
- [x] Complete canonical reserved/legacy webhook and refund/reconcile integration in source; independent SQL install/deployment remain gated.
- [ ] Official managed sender and durable business-event retry integration blocked on domain configuration and supported delivery design.
- [ ] Authenticated UI E2E blocked on authorized staging session; own-account mint found no matching account.
- [ ] Independent review/install follow-up SQL before deploying dependent functions.

## Backlog
- [ ] Replace hard-coded $100 tip limits ($50 single / $100 per 24h / $100 per event, currently constants inside `check_tip_cap` and `src/lib/purchaseCaps.ts`) with configurable, server-enforced limits (e.g. `app_config` row read by the cap function, admin-editable). Do not change current limit values as part of D3.
- [ ] Provider-blocked notification replay from financial/account evidence after owner-domain setup and official managed sender scaffolding; SQL email queues are prohibited.


## Payment integration completion (source-only)
- [x] Canonical reserved/legacy checkout, webhook and reconciliation boundaries.
- [x] Immutable redirects, retry lifecycle and evidence-backed ambiguity review.
- [x] Parallel PostgreSQL and canonical Edge integration regressions; lint/frontend behavior checks.
- [x] Ordered review/install/deployment and containment documentation.
