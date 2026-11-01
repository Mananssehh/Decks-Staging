# Architecture rules
- Core audit repairs are reviewed as ordered source-only SQL under `supabase/repair-staged`, not mixed with historical draft migrations; this preserves independent execution and rollback review.
- Event mutation RPCs acquire the event row before request/vote/profile writes; browser vote and playback table mutations are revoked to avoid tuple-lock inversion with request_song.
- Staged RPC contracts live in a typed adapter separate from generated hosted types until reviewed SQL is applied; generated types must always describe the actual hosted schema.
- Admission uses a per-identity advisory mutex then an event row mutex and rolling logs; shared network addresses do not determine guest admission quotas.
- Follow-up SQL and dependent Edge candidates live under `supabase/repair-followup`, outside automatic function deployment, until independently installed; this prevents code/schema mismatch.
- Tip reservations and settlement use a per-user advisory mutex before tip locks and immutable provider parameters; ambiguous provider calls retain quota until evidence-backed reconciliation.
- Shared React hooks/context and visual variants live outside component files; this preserves fast-refresh boundaries without disabling lint rules.
- Managed app-email sending remains a fail-closed no-network adapter until official sender-domain scaffolding; never create project email queues or fabricate provider APIs.
