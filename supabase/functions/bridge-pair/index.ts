import { createClient } from 'npm:@supabase/supabase-js@2';
import { createBridgePairHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('Missing backend configuration');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createBridgePairHandler(async (code, ip) => {
  const { data, error } = await admin.rpc('repair_claim_bridge_code', { _code: code, _ip: ip });
  if (error) throw error;
  return data;
}, url));
