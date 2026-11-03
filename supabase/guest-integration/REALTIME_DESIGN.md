# Receive-only Edge WebSocket feed — NEXT BOUNDED PHASE, NOT IMPLEMENTED

Chosen design: guest authenticates to an Edge WebSocket server with a verified
event token. Only the server polls private event revisions using service-role credentials,
with one shared poller per event per worker, every two seconds. No anonymous `realtime.messages` policy, guest backend channel,
synthetic Auth JWT, Presence or guest broadcast privileges will be authored.

Root temporarily proved anonymous private capability feasibility on staging:
guessed topic denied, spoofed guest broadcast not delivered, operator broadcast
received, no Auth signup; temporary policy/helper/table removed and Auth count 118.
That is feasibility evidence, not permission to bypass managed policy guidance.

## Source requirements for the next phase

- Authenticate through fixed service-only token validation, never UUID alone.
  Token sent in a bounded initial socket frame, never URL/query/log/subprotocol.
- Receive-only after authentication: reject client mutation/broadcast frames;
  bounded frame sizes, connection/session budgets, heartbeat and idle cleanup.
- Next phase adds service-only revision and batch-session-validation RPCs. DB
  triggers bump private revisions for relevant app changes, preserving core lock
  order; no raw-vote broadcasts. No Realtime subscriptions or quota dependence.
- Per-event monotonically increasing revisions, coalesced to at most one emission
  every two seconds with a guaranteed trailing flush; revision-only messages.
  Never relay rows, user IDs, provider data or tokens from service-role feeds.
- Revalidate before emission and periodically; ban, claim, expiry, revocation,
  disabled marker or contract mismatch closes the socket. Cached credentials do
  not authorize continuing delivery. Fail closed if validation is unavailable.
- Queue snapshots remain authoritative and always validate the event token.
  Socket revisions only trigger coalesced snapshot refresh; reconnect obtains a
  fresh validated snapshot, protecting against missing notifications.
- Multiple Edge instances need reviewed revision semantics, bounded worker-shared
  polling, reliable teardown and observable reconnect/backpressure failure.
  Do not advertise a durable global counter unless its storage/coordination exists.
- Stop event poller/timers when last socket leaves. No cron job or idle polling.
  Multiple guests share one poll result; every send uses batch-validated sessions.

## Independent platform/source acceptance (open)

Root reviews WebSocket source and platform runtime/upgrades separately: upgrade
support, lifetime/resource limits, cross-instance behavior, reconnect/trailing
flush, revoked connections, no token exposure, no guest-send delivery, and no Auth
signup. Venue Wi-Fi, sustained 100+ sockets and browser persistence remain untested.
This lifecycle pass does not implement or deploy the feed or frontend.
