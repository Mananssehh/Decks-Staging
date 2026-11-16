// DECKS Bridge token revoke. Staging endpoint. No network here: the revoke RPC is injected.
// The caller proves possession of the current ingest token in the X-Ingest-Token header; that
// token can retire only its own integration. No event, user or database access is exposed, the
// request body is never read, and the token never reaches logs, URLs, errors or the response.
import {
  allowedOrigin, carriesBody, defaultLog, diagnose, hasQuery, responseHeaders, stagingBackend, validRevocableToken, type Log,
} from '../_shared/bridge-protocol.ts';

export type RevokeRpc = (token: string) => Promise<{ data: unknown; error: unknown }>;
export interface Dependencies { url?: string; revoke?: RevokeRpc; log?: Log; id?: () => string }

/** The only request header a browser-context caller may send to this endpoint. */
export const ALLOW_HEADERS = 'x-ingest-token';

export function createBridgeRevokeHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const origin = allowedOrigin(req);
    if (origin === false) {
      return new Response(req.method === 'OPTIONS' ? null : JSON.stringify({ error: 'origin_not_allowed' }),
        { status: 403, headers: { ...responseHeaders(ALLOW_HEADERS, null), 'Content-Type': 'application/json' } });
    }
    const cors = responseHeaders(ALLOW_HEADERS, origin);
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!stagingBackend(deps.url) || !deps.revoke) return json(503, { error: 'service_unavailable' });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    // Body-free and identical for a live token, an unknown token, an already revoked token and
    // a missing or malformed one: the response is not an oracle for token validity.
    const done = () => new Response(null, { status: 204, headers: cors });

    // The request is the X-Ingest-Token header and nothing else. A query string, a body or an
    // Authorization header makes the request a no-op, so a secret duplicated there can never work.
    if (hasQuery(req) || carriesBody(req) || req.headers.has('authorization')) return done();
    const token = req.headers.get('x-ingest-token');
    if (!validRevocableToken(token)) return done();
    const started = Date.now();
    const unavailable = (d: { sqlstate: string; category: string }) => {
      const cid = (deps.id ?? (() => crypto.randomUUID()))();
      try {
        (deps.log ?? defaultLog)({ evt: 'bridge_revoke_upstream', cid, ...d, ms: Date.now() - started });
      } catch { /* logging never changes the response */ }
      return json(503, { error: 'service_unavailable' }, { 'x-correlation-id': cid });
    };
    try {
      const result = await deps.revoke(token);
      if (result.error) return unavailable(diagnose(result.error));
      if (typeof result.data !== 'boolean') return unavailable({ sqlstate: 'none', category: 'invalid_response' });
      return done();
    } catch {
      return unavailable({ sqlstate: 'none', category: 'transport' });
    }
  };
}
