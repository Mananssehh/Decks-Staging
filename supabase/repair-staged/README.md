# DECKS Staging core repair group — source-only review package

## Scope and source identity

- Only DECKS Staging project `3bde3db6-ee77-4460-95f2-891bb19a0278`.
- Starting source SHA independently verified before edits: `41620157daf3c40254adc16590e0b52008ebe3bb`.
- Lovable automatically records source changes; no manual Git commit/checkout/push was performed. `SOURCE_STATE.txt` records the observed source head and a file digest manifest for review.
- **No hosted SQL was executed, no Edge functions deployed, no site published, no email sent, no payments created, no secrets changed, no Auth quota requested.** Hosted accesses were read-only catalog/schema queries.
- Email dispatch/wake remain their captured no-op definitions. Historical `joinb`, `d5b`, `e0*` drafts are neither authoritative nor promoted by this package.

## Exact ordered SQL files

1. `supabase/repair-staged/00_preflight.sql` — read-only drift/bootstrap/email/duplicate checks and live catalog review.
2. `supabase/repair-staged/01_admission.sql` — rolling, serialized admission with private logs/settings; same-identity mutex followed by event lock; no join IP budget.
3. `supabase/repair-staged/02_mutations.sql` — remove browser request/vote DML, vote identity guard, desired-state voting, atomic counter deltas, evidence-preserving cache repair, event-first removal, paused boost.
4. `supabase/repair-staged/03_bootstrap.sql` — sensitive-profile protection, account bootstrap trigger, historical reconciliation and precise missing-starter ledger backfill.
5. `supabase/repair-staged/04_playback.sql` — owner queue/transition RPCs, one-playing index, transactional request+broadcast transition, owner/manual and service/ingest broadcast coordination.
6. `supabase/repair-staged/05_bridge.sql` — one-integration index, service-only atomic expiry/ownership/code claim, fail-closed serialized failure counters, token function volatility/event locks, integration DML closure.
7. `supabase/repair-staged/06_acl.sql` — explicit client/policy-helper manifest, service-only internal functions, default EXECUTE containment for postgres and supabase_admin.
8. `supabase/repair-staged/07_retention.sql` — daily pg_cron cleanup of limiter logs older than 24 hours. Does not touch email jobs.
9. `supabase/repair-staged/08_verify.sql` — read-only post-apply invariants and retention job check.

**Execute 01–07 in one explicit SQL transaction during a staging maintenance window**, with the read-only preflight checked first. Individual files intentionally have `SET LOCAL` and no BEGIN/COMMIT; the SQL interface operator owns transaction control. This avoids temporary partial repairs or PUBLIC execution gaps between files. Any lock timeout aborts the transaction: investigate, then retry the complete transaction; never continue from a partially failed file. Execute exactly one migration channel—do not also promote old overlapping drafts.

Review the latest live catalog and function creator roles before execution. The captured catalog has app function owner postgres and defaults from postgres/supabase_admin; additional owners/overloads require re-review. Catalog dependencies alone omit late-bound PL/pgSQL calls. Policy helpers `has_role`, `is_event_owner`, `is_event_member` deliberately retain authenticated EXECUTE. Internal trigger functions are not browser APIs; their creator/owner needs EXECUTE when creating triggers, and invoker dependencies require explicit grants.

## Rules preserved and intentional behavior

- New admissions: **300 per event per rolling 10 minutes; 10 chargeable attempts per guest per rolling 10 minutes**. Returning active, non-banned members spend neither budget and earn no duplicate join point. All denied-code/ban/full/guest-limit outcomes have identical unavailable bodies. SQL errors fail closed through Edge, never manufacture success or zero counts.
- Anonymous guest limit uses authoritative `app_config.guest_join_limits` or existing UI defaults. At require_at=4 the fourth distinct event is blocked **before** membership, matching the existing upgrade gate. Non-anonymous identities are not subject to that gate. No Auth provider limit is claimed repaired.
- Paused events permit existing queue votes, matching the visible app contract; new song requests stay paused. Ended/inactive events and terminal requests reject votes.
- Boosts remain unconditionally paused server-side and clients lose EXECUTE. Future enabling requires a reviewed event-first, membership/ban/lifecycle-aware implementation; flipping the UI flag alone cannot enable spending.
- One starter award is +15. Historical rows receive a ledger-only +15 only when no starter row exists and balance minus ledger sum is exactly 15. Other differences are quarantined in `repair_points_reconciliation`; balances are never reset. Existing hosted read-only finding: 85 profiles had precisely +15 differences; the SQL re-evaluates under locks rather than trusting that observation.
- Removal stays soft, reverses existing request earnings/refunds old boost spend, and retains cooldown history. DJ removal is now soft too, preserving votes/audit evidence rather than deleting it.
- DJ pending requests remain playable (no invented approval-only rule). Stale attempts to replay a request another transaction completed fail closed. Same-track pause/resume preserves the request association/start time. A different broadcast retires the prior playing request. Bridge matching still marks matched pending/approved requests played, with bridge attribution.
- No changes to tip prices/caps, email reservations, payments, or reconnect behavior.

## Pairing network limitation

The first `x-forwarded-for` entry is not established as trusted gateway evidence. Source therefore **ignores it** and uses one shared `unverified-gateway` bridge-failure bucket. Ten failed attempts in ten minutes may temporarily deny all staging Bridge pairing; successful prepared codes do not consume failures. This is a conservative fail-closed backstop, not a claim that trusted per-IP enforcement is verified. Before wider release, independently establish a gateway-overwritten canonical client address and retain a global backstop; do not restore spoofable leftmost-header identity. Join admission has no such shared network bucket.

## Source callers and types

- `src/lib/stagedRepairs.ts` — typed source-only RPC contracts; generated `src/integrations/supabase/types.ts` remains the actual hosted schema, unchanged until execution.
- `src/lib/nowPlaying.ts` — manual broadcast through atomic RPC.
- `src/pages/DJEventManage.tsx` — all dashboard/focus/next/approval/skip/remove callers share atomic transition; queue uses owner RPC; no false success on mirror failure.
- `src/pages/EventPage.tsx` — desired-state vote RPC instead of direct table upsert/delete; optimistic state rolls back on errors.
- `supabase/functions/join-event/{index.ts,handler.ts}` — verified session, DB limiter, generic fail-closed errors; flat 30/IP removed only for deployment with replacement SQL.
- `supabase/functions/bridge-pair/{index.ts,handler.ts}` — one service-only claim RPC; no split lookup/update.
- `supabase/functions/now-playing-ingest/index.ts` — metadata lookup/matching remains outside transaction; request+mirror+heartbeat write now one token-revalidating event-first transaction.
- `AGENTS.md` — lock and staged-contract rules.

**Compatibility gate:** new source RPCs intentionally do not exist in hosted staging yet. Vote/playback callers will fail closed until reviewed SQL is installed. Do not publish/deploy this source alone. Apply SQL in maintenance, regenerate hosted types, deploy matching Edge source explicitly, then verify authenticated UI flows.

## Evidence and actual tests

- `evidence/catalog.sql`: read-only live application columns/defaults/indexes/functions/policies/triggers snapshot, no user rows or tokens.
- `evidence/acl.sql`: pre-repair EXECUTE ACL restoration statements for audit only; **not safe rollback**.
- `evidence/function-dependencies.txt`: live function signatures/body hashes/owners/catalog dependencies.
- `evidence/test-results.txt`: test commands/results and gaps.
- `fixture/{00_fixture.sql,matrix.ts,locks.ts,run.sh,rollback_verify.sql}`: disposable PostgreSQL instance; actual captured application bodies/RLS, minimal local auth stand-ins, relevant FKs and dangerous defaults reconstructed. No remote connection strings consumed.
- `src/lib/stagedRepairs.test.ts`: adapter/error/retry contracts.
- `supabase/functions/join-event/handler_test.ts` and `supabase/functions/bridge-pair/handler_test.ts`: session/input/failure/spoofing tests.

Run locally under a non-root account with PostgreSQL and bun:

```sh
setpriv --reuid=1000 --regid=1000 --clear-groups bash supabase/repair-staged/fixture/run.sh
bunx vitest run src/lib/stagedRepairs.test.ts src/lib/eventEntry.test.ts src/lib/requestSong.test.ts src/lib/publicProfiles.test.ts
 deno test supabase/functions/join-event/handler_test.ts supabase/functions/bridge-pair/handler_test.ts
```

82 database assertions passed, including parallel voting/request support, 100 prepared identities plus retries, exact 300-event and 10-guest caps, double claim, mirror failure rollback, historical ledger/cache evidence, token rotation and both creator defaults. Deterministic separate-connection fixture observed vote waiting on event lock and rejecting the ended state after acquisition; containment rollback passed.

Focused frontend tests: 58 passed. New Edge tests: 10 passed.

Full `bunx vitest run` was also actually run: 76 tests passed, 2 BoostDialog tests failed because their old selectors expect dollar-priced packs while the component shows points, and prodBundle suite failed collection because `dist/assets` is absent. **No tests were skipped or disabled by this repair.** Existing `describe.skipIf` was not changed. No manual app build/typecheck was run. These failures are reported, not hidden or modified outside core scope.

## Rollback

`supabase/repair-staged/rollback/01_contain.sql` is a tested **containment rollback**: disables repaired mutation boundaries and affected legacy mutation RPCs without restoring broad guest writes, internal EXECUTE, stale counters, or missing-ledger offsets. Keep affected UI in maintenance. It retains bootstrap, evidence/backfilled ledger, private logs/settings, retention and all hardened invariants.

For a full behavioral reversal, independently review the fresh pre-apply snapshot and restore selected function bodies/policies/ACLs only with deliberate authorization. `evidence/acl.sql` documents unsafe original grants, not a script to execute blindly. Do not subtract starter ledger backfills or overwrite corrected counters; doing so destroys audit/reconciliation evidence. Retention job may remain during containment; if explicitly required, unschedule only `decks-core-limiter-retention`, never email jobs.

## Remaining release gaps

- Hosted migrations, daily cron job, actual managed signup trigger execution, generated types, Edge deployment and authenticated UI end-to-end remain **unexecuted/unverified by design**.
- pg_cron scheduling is staged and supported by read-only hosted extension discovery; local fixture does not emulate managed pg_cron privileges.
- Bridge gateway address provenance unresolved; common failure bucket documented above.
- No exhaustive proof for arbitrary service-role bulk SQL or privileged clients: those can bypass RLS and must obey event-first ordering. Current browser request/vote/integration writes are closed, and known source writers were enumerated.
- Failed configuration casts deny admission and roll back that attempt transaction; they never admit on invalid config. Administrators must correct malformed `guest_join_limits` before release.
- Pre-existing non-core full-suite failures remain; email/payment reservations/reconnect/lint reserved for later repair group.
