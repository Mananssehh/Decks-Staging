# Roadmap

## Staging Sentry instrumentation
- [x] Activated supplied public staging DSN; removed obsolete transaction hook; preview SDK initialized to project 4512372180320256/staging; one synthetic event HTTP 200, ID 1293111cd5a643329bd25b0d77695da2 (accepted, not dashboard-confirmed).
- [x] Focused throttle-warning follow-up: genuine429/search busy/rate_limited retained, cooldown429 business and5xx server preserved; 91 focused tests/typecheck/lint passed, DSN still unconfigured; root owns final build.
- [x] Add exact-backend/DSN gate, allowlisted privacy envelope and bounded nonblocking reporting; official React SDK, no automatic integrations/spans.
- [x] Instrument join/search/request/vote/snapshot/stream refresh boundaries and evidence-only saved-request observation; preserve outcomes, no room-silence health claims.
- [x] Focused privacy/operation/guest/QR/confirmation regressions, typecheck/lint and native build checked; docs/STAGING_SENTRY.md records synthetic acceptance and honest exclusions.
- [ ] Root verifies dashboard issue, project-side privacy and alert routing; no Sentry connection is available for issue queries here.

## Staging QR and email confirmation repair
- [x] Refine event-only QR to exact uploaded flat disc/arrows crop; GUESTQB/Z57YRB 160/260 displays and four PNG1024 downloads independently decoded; nine QR tests/typecheck/lint passed. Bounded read-only sign-in status audit empty, DJ password sign-in unverified; global branding and confirmation preserved.
- [x] Brand shared event QR with official logo, H correction, four internal quiet-zone modules and safe 1024px download; two-code 160/260 display + PNG independently decoded in browser.
- [x] Persistent tab-scoped confirmation/resend for signup and upgrades; safe same-origin callback/continuation and verified matching guest claim; profile completion deferred until verification.
- [x] Read-only hosted audit: confirmation ON, signup/email/legacy anonymous enabled, staging wildcard callback allowed, published Site URL observed; bounded error-log query empty (not delivery proof).
- [ ] Actual confirmation delivery and clicked-link acceptance blocked on user-provided safe test inbox; no email/account created here. Root owns final full build/test.

## Authorized staging integration deployment
- [x] Harden bounded JSON/UTF-8 validation: 46 no-network Edge tests, four entrypoint checks, zero-warning lint; frontend 132 passed/nine unchanged missing-bundle failures.
- [x] Regenerate actual hosted public types; deploy only guest-event, guest-event-stream, then music-search, tip-create-checkout with four explicit gateway overrides.
- [x] Read-only before/after disabled contract and invalid-proof HTTP checks; live UTF-8/oversize rejection and one disabled socket verified. OFF frontend and DB markers unchanged.
- [ ] Root-owned enablement, valid-proof catalog/readiness and 100-WS/browser acceptance; blocked on independent root enablement, no guest/Auth identity created here.

## Guest backend integration (source-only)
- [x] Frontend refinement: backend Web Lock join exclusion (fresh unsupported browsers fail closed), session-keyed restored snapshots/error recovery, account-bound accurate signup outcome, caught/coalesced socket refresh and Auth-only DJ/admin guards. Full suite: 132 passed, nine unchanged absent-bundle failures; zero-warning lint and automatic typecheck pass. Flag OFF; no SQL/Edge/hosted changes; root owns final build and hosted acceptance.
- [x] Application source phase: OFF staging actor/provider, persistent proof/explicit account-bound claim, event/profile/ledger/socket paths; verified catalog/tip/consent adapters; 011 manual/URL/lifecycle/helpers. Local 16 application +100 guest +15 bootstrap +39 stream SQL assertions/rollback, 57 financial checks, 25 Edge tests; lint/typecheck pass. Hosted acceptance pending.
- [x] Stage candidate principals/FK replacement, actor kernels, sessions, snapshots, claim and alias-aware financial boundaries; not install-ready.
- [x] Stage bounded guest-event API and 8 no-network endpoint tests; retain probe and existing UI unchanged.
- [x] Local database suite: 49 assertions plus containment/refusal/empty restore; preflight and canonical backups.
- [x] Document capability Broadcast constraints and independent hosted review gates.
- [x] Protected profiles-to-Auth lifecycle, orphan refusal, registered retirement and guest/claimed deletion tests; 72 local assertions plus rollback; existing 57 payment assertions pass.
- [x] Legacy writer/claim entry and statement exclusion reviewed; concurrent DJ/ban/profile/award/financial/claim checks passed.
- [x] Readiness source: targeted legacy-DJ repair, shared reads, safe DTO/authenticated alias snapshot, overlap compensation; 100 guest +15 repair +57 financial +8 endpoint assertions, rollback/lint.
- [x] Root reports independent bootstrap+001..008+010+011 installation in one transaction with disabled markers and actual catalog/rolled-back assertions; SQL not reapplied here.
- [x] Stream source: 010 revision overlay, private token/batch RPCs, native receive-only socket/shared hubs; 39 SQL +13 transport +8 endpoint tests, 100 guest +15 repair +57 financial regressions and rollback/lint; 001..008 byte-identical.
- [x] Authorized four-endpoint staging deployment completed; independent root owns remaining enablement/flagged browser/100-socket acceptance, no anonymous channel policy or cron.

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
- [x] Validate secret/restricted test/live keys: 7 SDK-free tests, 34 combined Edge tests, 95 frontend tests and zero-warning lint.
- [x] Deploy all seven inventoried shared-helper dependents to staging; checkout last. No provider operations; evidence recorded.

## Staging fresh-100 capacity failure
- [x] Incorporate root's exact materialized snapshot derivative; read-only observed already optimized root pair captured; both exact baseline gates/rollbacks verified. 25 capacity + 170 existing SQL assertions, 12 no-network Edge tests and zero-warning lint; 100 local flows completed, all final snapshots coherent. Hosted repeat NOT yet passed.
- [x] Diagnose from hosted Postgres/gateway logs: 26x 57014 + 22x PostgREST 504 from event-row tuple convoy behind O(songs x principals) snapshot.
- [x] Source-only 012 candidate + 912 rollback, equivalence/concurrency proof (local fresh100 58.7s -> 2.5s), safe Edge upstream logging + tests.
- [x] Root installed reviewed snapshot/aliases/member hosted; root HTTP 100/100 and WS 100 passed on GUESTQB.

## Final staging enablement
- [x] Canonicalize 012 to exact hosted aliases/member/snapshot (fresh install, hosted no-op, drift refused); 912 restores all three.
- [x] Frontend guest application ON behind exact staging backend gate; config test covers ON/explicit OFF/other backends.
- [x] RequestPicker search no longer reruns on unrelated refreshes; regression test.
- [ ] Root browser check and fixture cleanup (root-owned). Logging guest-event remains undeployed.
