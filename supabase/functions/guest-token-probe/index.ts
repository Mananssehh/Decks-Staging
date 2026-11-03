// Thin entrypoint. STAGING ONLY; fails closed on any other backend.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler, isStagingBackend, type ProbeRpc } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

let rpc: ProbeRpc | null = null;
if (isStagingBackend(url) && key) {
  const admin = createClient(url!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // Fixed RPC name; the action is allowlisted by the handler and re-checked in the DB.
  rpc = async (action, payload) => {
    const { data, error } = await admin.rpc("repair_guest_probe_rpc", { _action: action, _payload: payload });
    return { data, error };
  };
}

Deno.serve(createHandler({ supabaseUrl: url, rpc }));
