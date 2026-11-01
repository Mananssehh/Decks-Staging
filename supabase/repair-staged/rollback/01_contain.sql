-- SAFE CONTAINMENT ROLLBACK, not restoration of exploitable behavior.
-- Transactional; put affected UI flows into maintenance before executing.
SET LOCAL lock_timeout='5s';
REVOKE ALL ON FUNCTION public.set_song_vote(uuid,integer),public.dj_transition_request(uuid,uuid,text),
public.dj_set_queue_position(uuid,uuid,double precision),public.repair_write_broadcast(uuid,jsonb,uuid,uuid,text),
public.repair_claim_bridge_code(text,text),public.request_song(uuid,text,text,text,text,text,text,integer,text,boolean,text),
public.remove_my_song_request(uuid),public.generate_bridge_pairing_code(uuid),public.regenerate_ingest_token(uuid)
FROM PUBLIC,anon,authenticated,service_role;
-- Keep patched event-first functions, bootstrap, corrected counters, reconciled ledger,
-- immutable identity triggers, paused boost, private evidence, retention and hardened ACLs intact.
-- Never automatically re-open original guest writes or internal RPC EXECUTE.
