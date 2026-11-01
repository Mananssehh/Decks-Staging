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
- [ ] Complete reserved/legacy webhook and refund/reconcile integration before payment candidate deployment (requires independently reviewed SQL).
- [ ] Official managed sender and durable business-event retry integration blocked on domain configuration and supported delivery design.
- [ ] Authenticated UI E2E blocked on authorized staging session; own-account mint found no matching account.
- [ ] Independent review/install follow-up SQL before deploying dependent functions.

## Backlog
- [ ] Replace hard-coded $100 tip limits ($50 single / $100 per 24h / $100 per event, currently constants inside `check_tip_cap` and `src/lib/purchaseCaps.ts`) with configurable, server-enforced limits (e.g. `app_config` row read by the cap function, admin-editable). Do not change current limit values as part of D3.
- [ ] Durable email outbox + reconciliation for the accepted D1 crash window: if the process dies between claiming the Stripe payout activation (false→true) and enqueuing `dj-stripe-connected:${acct.id}`, the confirmation email is never sent. Add a persisted outbox row written in the same transaction as the claim, plus a periodic reconciler that re-enqueues unsent notifications.


## Payment integration completion (source-only)
- [ ] Canonical reserved/legacy checkout, webhook and reconciliation boundaries.
- [ ] Immutable redirects, retry lifecycle and evidence-backed ambiguity review.
- [ ] Parallel PostgreSQL and canonical Edge integration regressions; lint/frontend checks.
- [ ] Ordered review/install/deployment and containment documentation.
