# DECKS Staging follow-up: review-only payment candidates and verified source repairs

## Scope and actual hosted changes

Scope: only DECKS Staging project `3bde3db6-ee77-4460-95f2-891bb19a0278`. Previous core source is `07b6c60eae5496bb0439210015d88c80f6b55261`; follow-up began at observed platform head `20c67b8c968c2fab5d86b6896ab23a07eb0661e8`. No manual Git changes or commits.

The independent reviewer installed core before this turn. Agent confirmed installed RPCs and permissions read-only, regenerated hosted client types, and deployed `join-event`, `bridge-pair`, `now-playing-ingest`, and the disabled `send-welcome-email`. Unauthenticated deployed probes returned expected 401s, not 404s. No new SQL was applied, site published, email sent, Stripe session/payment created, secret changed or Auth quota requested.

Reviewer evidence (not agent-executed): core role-based rollback checks ten passed; balances checksum unchanged; earlier precise starter-ledger backfill for 85 profiles; one daily limiter job. Fresh agent evidence: one `on_auth_user_created`; zero cached vote mismatches; zero quarantined profiles; core function signatures present; boosts not executable by authenticated. Latest reconciliation query has 86 reconciled profiles. Agent SQL cannot inspect cron internals. `supabase_admin` default changes failed for the reviewer and remain a provider-owned gap; postgres/application ACLs are closed. `repair-staged/09_resume.sql` inventories installed state; never replay original core files blindly.

## Completed source repairs

- `src/lib/eventRefresh.ts`, `.test.ts`, `src/pages/EventPage.tsx`: songs + event lifecycle/settings + authenticated user's votes read together on SUBSCRIBED, reconnect, online, visible, own-vote cross-tab key, relevant realtime changes. Burst coalescing, invalidated response rejection, in-flight optimistic mutation deferral, channel generation filtering, identity-scoped cleanup. Initial snapshot finishes before subscribing. Failed fetch preserves last good state; failed vote rollback cannot overwrite another identity's screen.
- `src/lib/authCallback.ts`, `.test.ts`, `src/pages/AuthCallback.tsx`: installed auth-js source explicitly accepts `authCode: string`; exchange receives decoded code only. `next` rejects external/protocol-relative/backslash/control-character targets and preserves local query/hash. Browser public error callback returned `/auth` with real login form. Hosted OAuth login not verified.
- `src/components/BoostDialog.tsx`, `.test.ts`: paused frontend blocks spending; enabled fake tests assert actual points packs and duplicate-tap lock. Server boosts remain paused.
- `src/lib/tipRequestKey.ts`, `.test.ts`, `src/components/TipDialog.tsx`: stored logical UUID keyed by current user/event/song/amount, reused on retries. Existing deployed legacy checkout does not yet enforce this key; reservation-dependent server candidate is not deployed.
- `src/integrations/supabase/types.ts`: regenerated from actual hosted schema only. No invented follow-up fields added to generated types.
- Lint: obsolete schema casts removed; error and provider objects typed; shared React context/hooks/visual variants extracted; email components separated from registry entries. No rules disabled or assertions skipped. `CHANGED_FILES.txt` enumerates exact files, including extracted modules and imports. Root `AGENTS.md` records structural rules.
- Existing `stripe-webhook/index.ts`: legacy generic email invocation removed, disabled fixed-template adapter used, late unpaid/payment failure cannot downgrade financial terminal states, zero-payment completion does not fulfill tips. Tests use local signed fixture events and fake REST only. These existing-schema fixes have no follow-up RPC dependency.

## Email gate — not a working delivery/outbox implementation

Official managed-email documentation requires a real configured sender domain before official scaffolding, and prohibits project SQL email queues/outboxes/cron. Domain check found **none configured**. No sender domain or SDK API was invented; no email-related SQL was written.

`supabase/functions/_shared/transactional-email-templates/send-email.ts` is explicitly a **disabled no-network adapter**, not the official generated sender implementation: fixed allowlist, `sent:false, reason:domain_not_configured`, no delivery marker. `send-welcome-email/handler.ts` verifies the server auth user and confirmed email, rejects anonymous recipients and client-selected templates, enforces DJ role, ignores client recipient/idempotency input. Repeated requests remain no-ops, so rate controls and durable welcome deduplication are **not claimed implemented** while sending is disabled.

**Remaining:** owner-domain configuration, official scaffolded sender, and supported durable per-business-event delivery/retry design. No database email outbox was added. Current payout activation cannot claim email delivered when disabled; a disabled or failed email is not evidence of delivery. Existing account-activation tests still cover the legacy revert-on-thrown-email path; durable activation crash-window closure and retry remain unresolved. Payment event evidence below is financial evidence only, not a substitute email queue or a completed durable notification integration.

## New source-only SQL order and deployment gates

Read `00_preflight.sql`. Review definitions against fresh live catalog. **Do not apply automatically.** Independent reviewer may execute `01_tip_reservations.sql` then `02_tip_lifecycle.sql` within one explicit transaction, then `03_verify.sql`. Files have no transaction wrapper. Do not promote old drafts. If `followup_tip_reservations` already exists, stop and review installed definitions rather than replay CREATE statements.

- `01_tip_reservations.sql`: service-only per-user advisory serialization; exact current consent `v2-tips-2026-06-12`; validated event membership/bans/DJ payouts; amount integer min100/max5000; existing 10000 rolling/day and event caps including live pending plus unresolved reservation-backed pending; fee3000bps unchanged. Immutable checkout parameters captured with the tip row **before provider call**. Unique `(user_id,request_key)`, unique tip/session identity. Same-key payload mismatch rejected. Unknown provider outcome never releases quota by elapsed time.
- `02_tip_lifecycle.sql`: service-only signed payment boundary, per-user mutex before row locks, event id unique, amount/currency/mode/session identity validation. Paid complete/async success fulfills, unpaid does not. Late failure/expiry/unpaid preserves succeeded/refunded/partially-refunded/disputed. Evidence retained once. Signed success may correct failed/expired. Reservation-linked pending remains counted until terminal provider evidence; raw elapsed time is insufficient.
- `rollback.sql`: tested containment disables new reservation/attachment, retains financial/evidence rows and settlement for existing checkout. No deletion/reversal of balances or potentially paid reservations.

`functions/` below this folder is **outside deployable `supabase/functions/`**. Candidate paths:
- `functions/tip-create-checkout/{checkout.ts,index.ts,checkout_test.ts}`: verified `getUser`, service-only reservation, immutable provider parameters, `decks-tip:<reservation UUID>` Stripe key, exact parameters reused after provider timeout or attach failure, refuses retries after 23-hour idempotency safety window. Requires fixed configured `APP_ORIGIN`; never accepts request Origin as checkout redirect authority. No API upgrade.
- `functions/stripe-webhook/{handler.ts,index.ts,handler_test.ts}`: signature verification with the current Stripe SDK, reserved checkout event mapping to atomic DB boundary, retryable unknown reservation/SQL errors.

**Not deploy-ready:** the reserved webhook candidate deliberately handles only reserved checkout events. A reviewed combined routing layer must preserve existing legacy account/refund/dispute events and route reserved checkout/PI events before enabling the new checkout. Existing refund/dispute/reconcile writers are not yet integrated with the new reservation mutex; do not enable reservations alongside those writers without completing that integration. No automated evidence-backed reconciliation for old ambiguous provider sessions is implemented; past retry horizon fails closed. Stable configured origin must not change while ambiguous sessions are being retried, since Stripe idempotency requires identical parameters. Readiness check-only and friendly error-code mapping must be integrated before replacing the live checkout endpoint. This package is a tested foundation, **not a claim that all payment repair work is complete**.

## Tests actually executed

- `bunx eslint . --max-warnings 0`: passed, **zero errors/warnings**.
- `bunx vitest run src/lib src/components`: **92 passed**.
- `bunx vitest run`: **95 passed, 9 failed**, all nine production-bundle assertions fail because `dist/assets` is absent. Skipping was removed; missing build is not a pass. Manual app builds/typechecks are prohibited by the environment instructions, and no production build artifact was supplied. Independent production build remains a verification gate. Preview automatic check latest `build OK` does not establish a production bundle.
- `setpriv --reuid=1000 --regid=1000 --clear-groups bash supabase/repair-staged/fixture/run.sh`: **83 core assertions**, deterministic event-lock barrier and containment rollback passed. Fixture now asserts provider-owned defaults remain open rather than claiming both creators fixed.
- `setpriv --reuid=1000 --regid=1000 --clear-groups bash supabase/repair-followup/fixture/run.sh`: **19 payment assertions**, real parallel local PostgreSQL connections and rollback passed.
- `deno test --allow-env --allow-net supabase/repair-followup/functions/tip-create-checkout/checkout_test.ts supabase/repair-followup/functions/stripe-webhook/handler_test.ts`: **8 passed**, fake Stripe timeout/session-persistence/retry plus signed-handler boundary tests.
- Managed Deno test runner for join-event, bridge-pair, send-welcome-email, stripe-webhook, tip-reconcile: passed, exact output/count copied into `TEST_RESULTS.txt`. All external webhook calls are local mocks, no actual email or money.
- Playwright public callback-error flow: final URL `http://localhost:8080/auth`, login form screenshot verified. Own-account hosted auth session mint failed (no matching account); no other user's session chosen. Authenticated event/cross-tab E2E and hosted OAuth login remain unverified.

## Remaining gates

1. Independent SQL review/install and combined reserved/legacy webhook + refund/reconcile integration; payment dependent deployment forbidden before this.
2. Sender-domain configuration and official managed email/durable business-event retry integration; no secrets requested this turn.
3. Provider-owned supabase_admin defaults and trusted Bridge address provenance; common `unverified-gateway` failure bucket unchanged.
4. Production build artifact before the nine real production assertions can pass.
5. An authorized signed-in staging account for authenticated UI E2E; no recipient email or payment tests will be performed.