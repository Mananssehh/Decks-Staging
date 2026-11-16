// SOURCE ONLY. Deploy only after supabase/repair-staged/10_bridge_pairing_security.sql is
// independently installed and verified. Thin entrypoint; fails closed off the staging backend.
// Exact version already used by the deployed staging Bridge functions (now-playing-ingest, bridge-event-snapshot).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { createBridgeRevokeHandler, type RevokeRpc } from './handler.ts';
import { stagingBackend } from '../_shared/bridge-protocol.ts';
const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let revoke: RevokeRpc | undefined;
if (url && key && stagingBackend(url)) {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  revoke = async (token) => {
    const { data, error } = await admin.rpc('bridge_revoke_v2', { _token: token });
    return { data, error };
  };
}
Deno.serve(createBridgeRevokeHandler({ url, revoke }));
