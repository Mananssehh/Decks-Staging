import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
export type ClaimResult = { ok: boolean; reason?: string; event_id?: string; ingest_token?: string };
export function createBridgePairHandler(claim: (code: string, ip: string) => Promise<ClaimResult>, url: string) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    try {
      const body = await req.json().catch(() => null);
      const code = typeof body?.code === 'string' && /^\d{6}$/.test(body.code.trim()) ? body.code.trim() : '';
      const result = await claim(code, ip);
      if (!result.ok) return json({ error: 'Pairing unavailable' }, result.reason === 'rate_limited' ? 429 : 404);
      if (!result.event_id || !result.ingest_token) return json({ error: 'Pairing unavailable' }, 500);
      return json({ event_id: result.event_id, ingest_token: result.ingest_token, edge_function_url: `${url}/functions/v1/now-playing-ingest` });
    } catch {
      return json({ error: 'Pairing unavailable' }, 500);
    }
  };
}
