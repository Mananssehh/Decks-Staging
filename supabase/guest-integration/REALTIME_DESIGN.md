# Receive-only Edge WebSocket feed — NEXT BOUNDED PHASE, NOT IMPLEMENTED

Chosen design: guest authenticates to an Edge WebSocket server with a verified
event token. Only the server subscribes to backend change feeds using service-role
credentials. No anonymous `realtime.messages` policy, guest backend channel,
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
- Server-only subscriptions use actual published tables (`events`, `song_requests`,
  `now_playing`); never unpublished `votes`. Vote counter updates invalidate songs.
- Per-event monotonically increasing revisions, coalesced to at most one emission
  every two seconds with a guaranteed trailing flush; revision-only messages.
  Never relay rows, user IDs, provider data or tokens from service-role feeds.
- Revalidate before emission and periodically; ban, claim, expiry, revocation,
  disabled marker or contract mismatch closes the socket. Cached credentials do
  not authorize continuing delivery. Fail closed if validation is unavailable.
- Queue snapshots remain authoritative and always validate the event token.
  Socket revisions only trigger coalesced snapshot refresh; reconnect obtains a
  fresh validated snapshot, protecting against missing notifications.
- Multiple Edge instances need reviewed revision semantics, bounded service
  subscriptions, reliable teardown and observable reconnect/backpressure failure.
  Do not advertise a durable global counter unless its storage/coordination exists.
- Stop subscriptions/timers when last receiver leaves. No permanent idle cron.

## Independent platform/source acceptance (open)

Root reviews WebSocket source and platform runtime/upgrades separately: upgrade
support, lifetime/resource limits, cross-instance behavior, reconnect/trailing
flush, revoked connections, no token exposure, no guest-send delivery, and no Auth
signup. Venue Wi-Fi, sustained 100+ sockets and browser persistence remain untested.
This lifecycle pass does not implement or deploy the feed or frontend.
