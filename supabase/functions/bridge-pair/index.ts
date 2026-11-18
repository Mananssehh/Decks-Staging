// SOURCE ONLY. Deploy only after supabase/repair-staged/10_bridge_pairing_security.sql is
// independently installed and verified. Thin entrypoint; fails closed off the staging backend.
// Exact version already used by the deployed staging Bridge functions (now-playing-ingest, bridge-event-snapshot).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { createBridgePairHandler, type ClaimRpc } from './handler.ts';
import { stagingBackend } from '../_shared/bridge-protocol.ts';
import { PROVISIONAL_PENDING_CLAIM_LIMIT, createPendingCallLimit } from '../_shared/bridge-admission.ts';
const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let claim: ClaimRpc | undefined;
if (url && key && stagingBackend(url)) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  claim = async (code, clientNonce) => {
    const { data, error } = await admin.rpc('bridge_pair_claim_v2', { _code: code, _client_nonce: clientNonce });
    return { data, error };
  };
}
// One pending-claim limit per worker (provisional, uncalibrated). Not shared between workers.
const admission = createPendingCallLimit(PROVISIONAL_PENDING_CLAIM_LIMIT);
Deno.serve(createBridgePairHandler({ url, claim, admission }));
