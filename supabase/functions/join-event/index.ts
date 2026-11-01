// Deploy only after the reviewed DB admission limiter is installed.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createJoinHandler } from './handler.ts';
const url = Deno.env.get('SUPABASE_URL');
const anon = Deno.env.get('SUPABASE_ANON_KEY');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !anon || !service) throw new Error('Missing backend configuration');
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createJoinHandler({
  authenticate: async token => {
    const { data, error } = await admin.auth.getUser(token);
    if (error) return null;
    return data.user?.id ?? null;
  },
  join: async (token, code, nickname) => {
    const user = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await user.rpc('join_event_by_code', { _code: code, _nickname: nickname });
    if (error) throw error;
    return data;
  },
}));
