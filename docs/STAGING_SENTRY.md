# DECKS staging monitoring — source-only

## Activation and ownership

- Official `@sentry/react` 11.10.0, installed with Bun. Initialization requires **both** exact staging backend and nonempty structurally valid HTTPS public `VITE_SENTRY_DSN`. Nothing has been configured; DSN absence leaves SDK, listeners and sending off. No DSN was invented.
- Root independently connects org `workstation-70`, verifies the staging project/public DSN, then supplies the public build variable. Never put `SENTRY_AUTH_TOKEN` in any `VITE_` variable. No token, source-map upload plugin, account creation, plan change or backend endpoint added.
- Environment is always `staging`. Optional `VITE_SENTRY_RELEASE` accepts only a 7–40 lowercase-hex commit marker, rendered as `decks-staging@<marker>`. No fabricated release; absent/invalid marker omitted.
- Read-only connector catalog inspection: Sentry is available as an OAuth **chat/MCP** connector for issues/project insights; the App connector catalog has no Sentry entry and no connected MCP is exposed in this session. Org/project connection, membership, DSN and ingestion are **not verified**. No connect or credential request made.

## Privacy, cost and delivery contract

- Default SDK integrations are completely disabled; no automatic console, fetch/XHR, DOM, history, HTTP context, sessions, replay or profiling. `maxBreadcrumbs=0`, breadcrumb hook drops all, tracing sample rate 0 and no propagation targets.
- `sendDefaultPii:false` is explicit. SDK v11 no longer exposes that legacy option in its types; actual privacy enforcement does **not** depend on it. Both `beforeSend` and the final transport reconstruct events from the same allowlist. Unknown fields are discarded, not blacklisted. Non-event envelope items (including spans/transactions, attachments, sessions, logs, metrics and profiles) are dropped entirely. No SDK `Error` object is captured.
- Wire payload allows only static action/category, validated numeric HTTP status, bounded integer duration, SDK event ID/timestamp, static environment/platform/fingerprint and optional validated source release. No user identity, nickname/email, guest proof/bootstrap, auth/password/provider credentials, route/query/hash, referrer, request/response body, error message, stack/component stack or arbitrary context survives. Fetch omits credentials and referrer.
- Ten accepted signals per browser tab per minute, ten queued signals and ten in-flight SDK transport entries maximum; action/category deduplicated for 30s. No local storage, offline replay, persistent queue or application retry. Signals are scheduled after operations and never awaited; failures preserve the exact user result/error. Timing thresholds are initial **3s operation delay** and **5s request absence on a relevant post-ack applied snapshot**, not uptime promises.
- Client sampling/dedup means counts are not complete outage rates or reliable unique-user metrics. No session/crash-free-rate or performance span dashboard is claimed.

## Instrumented scope

- Guest `join`, song request, vote and coherent snapshot at `guestInvoke`; Auth request adapter, vote RPC, join-event invocation, coherent own/legacy song snapshot; shared guest/registered music search.
- Typed 5xx/transport/invalid-response failures are reported before existing throws/null/error outcomes. Business moderation, cooldown, invalid input, duplicates, ended/unavailable events and 4xx are excluded from outage reporting. Unknown untyped failures use static `unknown`, never their message. Legacy `P0001` business raises are excluded rather than inspected for message text.
- Shared coalesced refresh reports failures/duration without changing retained-last-good-state, optimistic locks or cancellation. Guest socket abnormal 1006/1011 closures report transport failure; expected authorization close/rollover/ended and silence do not.
- Saved-request acknowledgement IDs stay only in bounded page-local memory (20, 30s retention). Only applied post-ack snapshots containing that exact ID establish `snapshot_observed` (**queue state supplied to React, NOT proof of DOM paint or another client's delivery**). Applied post-ack snapshots missing the ID after 5s produce `snapshot_missing` warning, not a system outage. The actual guest HTTP read start is held in a WeakMap so coalescing cannot relabel an older read as newer evidence. No timer alone emits missing/health signals; event end/unmount/identity change clears tracking.
- Framework capture uses only the static `framework` category from existing React boundary and uncaught-window/unhandled-rejection listeners. No stacks are sent, so grouping/debug detail is intentionally coarse.

## Honest exclusions

No Edge/server instrumentation or server-side timing; no provider internals, payments, Auth delivery/sign-in, admin/DJ/Bridge mutation monitoring, independent uptime, browser paint/cross-client latency, stream revision-gap or ready-handshake/pong-deadline detector. Registered realtime connection statuses are not yet instrumented (their refresh failures are). Join timing covers the shared HTTP call, not the entire form/Web Lock wait. Stream timing covers actual refresh, not quiet periods. Guest UI request error handling is unchanged. Existing database error logger is unchanged and does not feed Sentry. Full SQL tests are unnecessary and were not run; no backend mutations or provider requests occurred.

## Safe synthetic acceptance (root, after DSN verification)

1. Run mocked monitoring tests first; they use a parser fixture DSN only, with SDK mocked, and never ingest externally.
2. In a **local disposable staging preview only**, set the verified public DSN and optional actual commit release. Confirm another backend and missing DSN cause zero Sentry requests. Never publish to production.
3. Root may run this developer-console-only Vite-source procedure (not a permanent route/button):
   ```js
   const { reportMonitoring } = await import('/src/lib/monitoring.ts');
   reportMonitoring('synthetic', 'server', 10, 503);
   ```
   This sends one static synthetic event without a crash, identity, app mutation or provider call. Inspect envelope in developer tools: only the documented allowlist; no request URL/body/referrer/user/stack. Confirm environment/project/org and exact issue in Sentry, then stop the local test. Do not use a random DSN or automatic synthetic loop.
4. For framework acceptance, root may dispatch a synthetic `ErrorEvent` in that disposable local tab; the listener does not read its message/error. Confirm only static `framework` event is sent. Do not add a public crash affordance.
5. Existing root-authorized guest fixtures may then exercise join/request/vote and snapshot observations. Record network acknowledgement separately from queue observation; do not claim ingestion or UI paint based on local unit tests.

## Root-owned monitoring/alert checklist

- [ ] Verify org membership and staging project/public DSN; configure variable only in staging, validate environment and optional release.
- [ ] Confirm one synthetic event and redacted envelope actually arrives; verify blockers/CSP/ad blockers/browser offline behavior.
- [ ] Exclude `synthetic`, `success`, `snapshot_observed`, business outcomes from outage alerts; separate delay/absence warnings from error alerts.
- [ ] Create narrowly grouped alerts for action/category `server`, `transport`, `invalid_response`, `unknown`, `framework`; choose thresholds from real staging evidence, respecting client sampling.
- [ ] Configure alert recipients/routing, retention, usage budget and alert suppression; verify a test alert reaches the intended team. No paid plan assumed.
- [ ] Independently configure authorized uptime checks outside this app; no public arbitrary telemetry collector or monitoring SQL.
- [ ] Root independently runs full tests/build and reviews any uninstrumented areas before expanding scope.

Actual project/DSN, ingestion, alert routing and independent uptime remain root-owned gates, not completed claims.