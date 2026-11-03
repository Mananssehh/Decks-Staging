# Receive-only invalidation channel: blocked, NOT installed source

Current managed platform guidance allows only a per-Auth-user topic predicate on
realtime.messages, not anonymous capability-topic policies. Root's permission
probe proves SQL permission, not platform authorization. Therefore this package
contains NO realtime policy, cron job, Broadcast trigger or subscription helper.
It must not be enabled for UI integration relying on Broadcast yet.

Required reviewed design if the platform permits this exception:
- Private `guest_runtime.event_revisions` row per app event, monotonically increasing
  revision, dirty flag, last_sent_at, generation, 256-bit random capability topic.
- Topic delivered only by token-authorized snapshot; anon/authenticated may SELECT
  only extension=broadcast rows for a current, unexpired capability. No INSERT or
  Presence grants. Predicate is SECURITY DEFINER, fixed search_path, no row data.
- Event-first write triggers mark dirty after queue/vote/event/now-playing changes.
  Never acquire a principal mutex from these triggers. They must not throw through
  business transactions; dirty failures must leave durable observable evidence.
- Ban/revocation/claim rotates capability at the event lock; dirty flush sends only
  current topic. Already cached old socket can receive no future invalidation.
- Single named `guest-integration-revision-flush` job, 2-second pg_cron interval,
  awakened on enqueue, unscheduled after drain. Trigger/job wake and drain share
  scheduling mutex AFTER event locks; flusher does not hold it while acquiring
  event rows. Each event <=1 broadcast/2 seconds with guaranteed trailing flush.
- Coalesce before sending: revision only, never app rows, user IDs or tokens.
- Retries armed only for pending dirty events; observable exception state and
  explicit containment unschedules job. No permanent idle polling.

A continuously active 2-second job can run 43,200 checks/day and keep the backend
awake; wake/drain avoids idle checks. This is a cost/timing trade-off, not a
capacity claim. Root must independently verify anonymous PRIVATE subscription,
revoked-topic isolation, trailing flush, contention and idle drain on staging.
