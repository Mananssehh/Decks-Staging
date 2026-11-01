import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
export type JoinDependencies = {
  authenticate(token: string): Promise<string | null>;
  join(token: string, code: string, nickname: string | null): Promise<unknown>;
};
const denied = { ok: false, reason: 'unavailable' };
export function createJoinHandler(deps: JoinDependencies) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json(denied, 405);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(denied, 401);
    try {
      if (!await deps.authenticate(token)) return json(denied, 401);
      const raw = await req.json().catch(() => null);
      // Invalid input still reaches DB as an invalid code and spends guest attempt quota.
      const valid = raw && typeof raw === 'object' && !Array.isArray(raw)
        && Object.keys(raw).every(k => ['code', 'nickname'].includes(k))
        && typeof raw.code === 'string' && raw.code.length <= 20
        && (raw.nickname === undefined || (typeof raw.nickname === 'string' && raw.nickname.length <= 24));
      return json(await deps.join(token, valid ? raw.code : '', valid ? raw.nickname ?? null : null) ?? denied);
    } catch {
      return json(denied, 500);
    }
  };
}
