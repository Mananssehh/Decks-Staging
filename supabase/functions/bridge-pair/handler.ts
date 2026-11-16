// DECKS Bridge Pairing Protocol v2 only. Staging endpoint. No network here: the claim RPC is injected.
// The pairing code, client nonce, ingest token and response body never reach logs, URLs or errors.
import {
  PROTOCOL_VERSION, allowedOrigin, boundedJsonObject, defaultLog, diagnose, hasQuery, jsonMediaType, normalizePairingCode,
  responseHeaders, stagingBackend, validClientNonce, validIssuedToken, validUuid, type Log,
} from '../_shared/bridge-protocol.ts';

export type ClaimRpc = (code: string, clientNonce: string) => Promise<{ data: unknown; error: unknown }>;
export interface Dependencies { url?: string; claim?: ClaimRpc; log?: Log; id?: () => string }

/** The only request header a browser-context caller may send to this endpoint. */
export const ALLOW_HEADERS = 'content-type';
/** One body and status for every refused attempt: malformed, unknown, expired or claimed. */
export const UNIFORM_FAILURE = { status: 404, body: { error: 'pairing_unavailable' } } as const;

export function createBridgePairHandler(deps: Dependencies) {
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
    if (!stagingBackend(deps.url) || !deps.claim) return json(503, { error: 'service_unavailable' });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const refuse = () => json(UNIFORM_FAILURE.status, UNIFORM_FAILURE.body);

    // Nothing may travel in the URL, and only JSON is parsed. Both are checked before the body is read.
    if (hasQuery(req)) return refuse();
    if (!jsonMediaType(req)) return refuse();
    const body = await boundedJsonObject(req);
    if (!body || body.protocol_version !== PROTOCOL_VERSION) return refuse();
    // The 80-bit code is the credential. The nonce only makes a retry of the same attempt idempotent.
    const code = normalizePairingCode(body.code);
    const clientNonce = body.client_nonce;
    if (!code || !validClientNonce(clientNonce)) return refuse();

    const started = Date.now();
    const unavailable = (d: { sqlstate: string; category: string }) => {
      const cid = (deps.id ?? (() => crypto.randomUUID()))();
      try {
        (deps.log ?? defaultLog)({ evt: 'bridge_pair_upstream', cid, ...d, ms: Date.now() - started });
      } catch { /* logging never changes the response */ }
      return json(503, { error: 'service_unavailable' }, { 'x-correlation-id': cid });
    };
    try {
      const result = await deps.claim(code, clientNonce);
      if (result.error) return unavailable(diagnose(result.error));
      const data = result.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return unavailable({ sqlstate: 'none', category: 'invalid_response' });
      const row = data as Record<string, unknown>;
      if (row.ok !== true) return refuse();
      // A success without every required field, or with a token that is not exactly 64 lowercase
      // hex characters, is never forwarded.
      if (!validUuid(row.event_id) || !validIssuedToken(row.ingest_token)) return unavailable({ sqlstate: 'none', category: 'invalid_response' });
      const eventName = typeof row.event_name === 'string' && row.event_name.length > 0 && row.event_name.length <= 200 ? row.event_name : undefined;
      return json(200, {
        event_id: row.event_id,
        ...(eventName ? { event_name: eventName } : {}),
        ingest_token: row.ingest_token,
        endpoint_url: `${new URL(deps.url as string).origin}/functions/v1/now-playing-ingest`,
      });
    } catch {
      return unavailable({ sqlstate: 'none', category: 'transport' });
    }
  };
}
