// Runner-neutral cases for the bridge-pair handler (registered by handler_test.ts under Deno
// and by src/test/bridgePairingV2.test.ts under Vitest). The claim RPC is a local stub.
import { ALLOW_HEADERS, createBridgePairHandler, UNIFORM_FAILURE, type ClaimRpc, type Dependencies } from './handler.ts';
import { ALLOWED_ORIGINS, type LogEntry } from '../_shared/bridge-protocol.ts';
import {
  CODE_VECTORS, REJECTED_CODES, REJECTED_ORIGINS, REJECTED_TOKENS, STAGING_URL, assertNoSecret, capturingConsole, equal, ok, type Case,
} from '../_shared/bridge-protocol_cases.ts';

const EVENT = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'feedfacecafebeef'.repeat(4);
const NONCE = 'fixture-nonce-AbCdEfGh-0123';
const GROUPED = 'GHJK-MNPQ-RSTV-WXYZ';
const CANONICAL = 'GHJKMNPQRSTVWXYZ';
const SECRETS = [GROUPED, CANONICAL, NONCE, TOKEN] as const;
const SUCCESS = { ok: true, event_id: EVENT, event_name: 'Fixture Night', ingest_token: TOKEN };

function setup(reply: unknown = SUCCESS, overrides: Partial<Dependencies> = {}) {
  const calls: unknown[][] = [];
  const logs: LogEntry[] = [];
  const claim: ClaimRpc = async (...args) => {
    calls.push(args);
    if (reply instanceof Error) throw reply;
    return reply && typeof reply === 'object' && 'error' in reply ? reply as { data: unknown; error: unknown } : { data: reply, error: null };
  };
  const handler = createBridgePairHandler({ url: STAGING_URL, claim, log: (entry) => logs.push(entry), id: () => 'cid-fixture', ...overrides });
  return { handler, calls, logs };
}
const pair = (body: unknown, headers: Record<string, string> = {}, path = '/functions/v1/bridge-pair') =>
  new Request(`https://local${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const valid = (overrides: Record<string, unknown> = {}) => ({ protocol_version: 2, code: GROUPED, client_nonce: NONCE, ...overrides });
async function shape(res: Response) {
  return { status: res.status, body: await res.text(), type: res.headers.get('content-type'), cache: res.headers.get('cache-control') };
}
const REFUSAL = { status: UNIFORM_FAILURE.status, body: JSON.stringify(UNIFORM_FAILURE.body), type: 'application/json', cache: 'no-store' };

export const bridgePairCases: readonly Case[] = [
  ['success returns exactly event_id, event_name, ingest_token and endpoint_url', async () => {
    const { handler, calls } = setup();
    const res = await handler(pair(valid()));
    equal(res.status, 200);
    equal(res.headers.get('cache-control'), 'no-store');
    equal(await res.json(), { event_id: EVENT, event_name: 'Fixture Night', ingest_token: TOKEN, endpoint_url: `${STAGING_URL}/functions/v1/now-playing-ingest` });
    equal(calls, [[CANONICAL, NONCE]], 'claim receives canonical code and nonce only');
  }],
  ['event_name is optional; the other three fields are not', async () => {
    for (const name of [null, undefined, '', 42]) {
      const res = await setup({ ...SUCCESS, event_name: name }).handler(pair(valid()));
      equal(Object.keys(await res.json()), ['event_id', 'ingest_token', 'endpoint_url'], `event_name ${String(name)}`);
    }
  }],
  ['grouped, spaced, lowercase and aliased input reaches the database in canonical form', async () => {
    for (const [typed, canonical] of CODE_VECTORS) {
      const { handler, calls } = setup();
      equal((await handler(pair(valid({ code: typed })))).status, 200, typed);
      equal(calls, [[canonical, NONCE]], typed);
    }
  }],
  ['malformed, short, long, oversized and six-digit codes get the uniform refusal without a database call', async () => {
    for (const code of REJECTED_CODES) {
      const { handler, calls } = setup();
      equal(await shape(await handler(pair(valid({ code })))), REFUSAL, `code ${JSON.stringify(code)?.slice(0, 30)}`);
      equal(calls.length, 0, 'no claim');
    }
  }],
  ['Protocol v1 requests are refused: missing, wrong or string protocol_version, with or without a six-digit code', async () => {
    const bodies: unknown[] = [{ code: '123456' }, { protocol_version: 1, code: '123456' }, { protocol_version: 1, code: GROUPED, client_nonce: NONCE },
      { protocol_version: '2', code: GROUPED, client_nonce: NONCE }, { protocol_version: 3, code: GROUPED, client_nonce: NONCE }, { code: GROUPED, client_nonce: NONCE },
      { protocol_version: 2, code: '123456', client_nonce: NONCE }];
    for (const body of bodies) {
      const { handler, calls } = setup();
      equal(await shape(await handler(pair(body))), REFUSAL, JSON.stringify(body).slice(0, 40));
      equal(calls.length, 0);
    }
  }],
  ['missing or invalid client_nonce gets the uniform refusal', async () => {
    for (const client_nonce of [undefined, null, '', 'short', 'A'.repeat(65), `${'A'.repeat(21)}+`, 12345678901234567890, { a: 1 }]) {
      const { handler, calls } = setup();
      equal(await shape(await handler(pair(valid({ client_nonce })))), REFUSAL, JSON.stringify(client_nonce));
      equal(calls.length, 0);
    }
  }],
  ['invalid JSON, non-object and oversized bodies get the uniform refusal', async () => {
    for (const raw of ['', '{', '[]', 'null', '"0123-4567-89AB-CDEF"', JSON.stringify(valid({ pad: 'x'.repeat(4096) }))]) {
      const { handler, calls } = setup();
      equal(await shape(await handler(pair(raw))), REFUSAL, raw.slice(0, 20));
      equal(calls.length, 0);
    }
  }],
  ['unknown, expired, claimed and throttled database refusals are indistinguishable from malformed input', async () => {
    for (const reply of [{ ok: false }, { ok: false, reason: 'rate_limited' }, { ok: false, reason: 'expired' }, { ok: false, reason: 'claimed', event_id: EVENT, ingest_token: TOKEN }, { ok: 'true', event_id: EVENT, ingest_token: TOKEN }]) {
      const res = await setup(reply).handler(pair(valid()));
      equal(await shape(res), REFUSAL, JSON.stringify(reply).slice(0, 40));
      equal(res.headers.get('x-correlation-id'), null);
    }
  }],
  ['a success missing any required field is never forwarded', async () => {
    const broken: unknown[] = [{ ok: true }, { ok: true, event_id: EVENT }, { ok: true, ingest_token: TOKEN }, { ok: true, event_id: 'not-a-uuid', ingest_token: TOKEN },
      { ok: true, event_id: EVENT, ingest_token: 'short' }, { ok: true, event_id: EVENT, ingest_token: null }, [SUCCESS], 'ok', null,
      // The legacy 48-character shape is valid for revocation but is never a pairing result.
      { ok: true, event_id: EVENT, ingest_token: 'a'.repeat(48) },
      ...REJECTED_TOKENS.map((ingest_token) => ({ ok: true, event_id: EVENT, ingest_token }))];
    for (const reply of broken) {
      const { handler, logs } = setup(reply);
      const res = await handler(pair(valid()));
      equal(res.status, 503, JSON.stringify(reply)?.slice(0, 40));
      const text = await res.text();
      equal(text, JSON.stringify({ error: 'service_unavailable' }));
      assertNoSecret(text + JSON.stringify(logs), SECRETS, 'broken success');
    }
  }],
  ['database errors fail closed with a correlation id and allowlisted diagnostics only', async () => {
    const hostile = { code: '57014', message: `timeout for ${CANONICAL} ${NONCE} ${TOKEN}`, details: GROUPED, hint: TOKEN };
    for (const reply of [{ data: null, error: hostile }, new Error(`boom ${CANONICAL} ${NONCE} ${TOKEN}`)]) {
      const { handler, logs } = setup(reply);
      const { result: res, output } = await capturingConsole(() => handler(pair(valid())));
      equal(res.status, 503);
      equal(res.headers.get('x-correlation-id'), 'cid-fixture');
      const text = await res.text();
      equal(text, JSON.stringify({ error: 'service_unavailable' }));
      equal(logs.length, 1);
      equal(Object.keys(logs[0]).sort(), ['category', 'cid', 'evt', 'ms', 'sqlstate']);
      assertNoSecret(text + JSON.stringify(logs) + output, SECRETS, 'error path');
    }
  }],
  ['no code, nonce, token or response body is written to the console on any path', async () => {
    const paths: (() => Promise<Response>)[] = [
      () => setup().handler(pair(valid())),
      () => setup({ ok: false }).handler(pair(valid())),
      () => setup().handler(pair(valid({ code: '123456' }))),
      () => createBridgePairHandler({ url: STAGING_URL, claim: async () => ({ data: null, error: { code: 'XX000', message: `${CANONICAL} ${NONCE} ${TOKEN}` } }) })(pair(valid())),
      () => createBridgePairHandler({ url: STAGING_URL, claim: async () => { throw new Error(`${GROUPED} ${NONCE} ${TOKEN}`); } })(pair(valid())),
    ];
    for (const run of paths) {
      const { output } = await capturingConsole(run);
      assertNoSecret(output, SECRETS, 'console');
    }
    const quiet = await capturingConsole(() => setup().handler(pair(valid())));
    equal(quiet.output, '', 'success path logs nothing');
  }],
  ['a logger that throws never changes the response', async () => {
    const res = await setup({ data: null, error: { code: '57014' } }, { log: () => { throw new Error('log sink down'); } }).handler(pair(valid()));
    equal(res.status, 503);
  }],
  ['codes are read from the JSON body only, never the URL or headers', async () => {
    const { handler, calls } = setup();
    const res = await handler(pair({ protocol_version: 2, client_nonce: NONCE }, { 'x-pairing-code': GROUPED }));
    equal(await shape(res), REFUSAL);
    equal(calls.length, 0);
  }],
  ['an otherwise valid request with any query string is refused before the body is parsed or the database is called', async () => {
    for (const query of ['?', '?x=1', `?code=${GROUPED}`, `?code=${GROUPED}&client_nonce=${NONCE}&protocol_version=2`, '?protocol_version=2', `?ingest_token=${TOKEN}`]) {
      const { handler, calls } = setup();
      const req = pair(valid(), {}, `/functions/v1/bridge-pair${query}`);
      equal(await shape(await handler(req)), REFUSAL, query);
      equal(req.bodyUsed, false, `body untouched for ${query}`);
      equal(calls.length, 0, query);
    }
    const control = setup();
    equal((await control.handler(pair(valid()))).status, 200, 'same request without a query succeeds');
    equal(control.calls.length, 1);
  }],
  ['an otherwise valid request with a non-JSON media type is refused before the body is parsed or the database is called', async () => {
    for (const type of ['text/plain', 'text/plain;charset=UTF-8', 'text/json', 'application/jsonx', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x',
      'application/json; charset=latin1', 'application/json; charset=utf-16', 'application/json, text/plain', 'application/octet-stream', '']) {
      const { handler, calls } = setup();
      const req = pair(valid(), { 'content-type': type });
      equal(await shape(await handler(req)), REFUSAL, type);
      equal(req.bodyUsed, false, `body untouched for ${type}`);
      equal(calls.length, 0, type);
    }
    // No Content-Type header at all (a byte body sets none).
    const { handler, calls } = setup();
    const bare = new Request('https://local/functions/v1/bridge-pair', { method: 'POST', body: new TextEncoder().encode(JSON.stringify(valid())) });
    equal(bare.headers.get('content-type'), null);
    equal(await shape(await handler(bare)), REFUSAL, 'missing content-type');
    equal(bare.bodyUsed, false);
    equal(calls.length, 0);
    for (const type of ['application/json', 'application/json; charset=utf-8', 'application/json;charset=UTF-8', 'Application/JSON']) {
      const accepted = setup();
      equal((await accepted.handler(pair(valid(), { 'content-type': type }))).status, 200, type);
      equal(accepted.calls, [[CANONICAL, NONCE]], type);
    }
  }],
  ['a pairing success is forwarded only with a token of exactly 64 lowercase hexadecimal characters', async () => {
    for (const ingest_token of ['f'.repeat(64), '0123456789abcdef'.repeat(4)]) {
      const body = await (await setup({ ...SUCCESS, ingest_token }).handler(pair(valid()))).json() as Record<string, unknown>;
      equal(body.ingest_token, ingest_token);
    }
    for (const ingest_token of ['a'.repeat(48), ...REJECTED_TOKENS]) {
      const res = await setup({ ...SUCCESS, ingest_token }).handler(pair(valid()));
      equal(res.status, 503, JSON.stringify(ingest_token)?.slice(0, 24));
      equal(await res.text(), JSON.stringify({ error: 'service_unavailable' }));
    }
  }],
  ['forwarded address headers are ignored: no address reaches the database', async () => {
    const { handler, calls } = setup();
    for (const address of ['1.2.3.4', '5.6.7.8, 9.9.9.9', 'x'.repeat(500)]) {
      await handler(pair(valid(), { 'x-forwarded-for': address, 'x-real-ip': address, 'cf-connecting-ip': address, forwarded: `for=${address}` }));
    }
    equal(calls, [[CANONICAL, NONCE], [CANONICAL, NONCE], [CANONICAL, NONCE]]);
  }],
  ['desktop request with no Origin header is accepted and gets no CORS grant', async () => {
    const res = await setup().handler(pair(valid()));
    equal(res.status, 200);
    equal(res.headers.get('access-control-allow-origin'), null);
  }],
  ['the two desktop-webview origins are echoed exactly; their preflight returns 204 with Vary: Origin', async () => {
    equal(ALLOWED_ORIGINS, ['tauri://localhost', 'http://tauri.localhost']);
    for (const origin of ALLOWED_ORIGINS) {
      const { handler, calls } = setup();
      const res = await handler(pair(valid(), { origin }));
      equal(res.status, 200, origin);
      equal(res.headers.get('access-control-allow-origin'), origin);
      equal(res.headers.get('vary'), 'Origin');
      const preflight = await handler(new Request('https://local/x', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }));
      equal(preflight.status, 204);
      equal(await preflight.text(), '');
      equal(preflight.headers.get('access-control-allow-origin'), origin);
      equal(preflight.headers.get('vary'), 'Origin');
      // Exact header set: this endpoint allows content-type and nothing else.
      equal([...preflight.headers.entries()].sort(), [
        ['access-control-allow-headers', 'content-type'], ['access-control-allow-methods', 'POST,OPTIONS'], ['access-control-allow-origin', origin],
        ['access-control-expose-headers', 'x-correlation-id'], ['cache-control', 'no-store'], ['vary', 'Origin'],
      ], `preflight headers for ${origin}`);
      equal(ALLOW_HEADERS, 'content-type');
      equal(res.headers.get('access-control-allow-headers'), 'content-type');
      equal(res.headers.get('access-control-allow-methods'), 'POST,OPTIONS');
      equal(res.headers.get('access-control-expose-headers'), 'x-correlation-id');
      equal(res.headers.get('cache-control'), 'no-store');
      for (const forbidden of ['authorization', 'apikey', 'x-client-info', 'x-ingest-token', '*']) {
        ok(!String(preflight.headers.get('access-control-allow-headers')).split(',').includes(forbidden), `${forbidden} not allowed`);
      }
      equal(calls.length, 1, 'preflight never reaches the database');
    }
  }],
  ['website, preview, linku99, localhost and every suffix, scheme, port and case variant are refused with 403 before body parsing or database access', async () => {
    for (const origin of REJECTED_ORIGINS) {
      const { handler, calls } = setup();
      const req = pair(valid(), { origin });
      const sent = req.headers.get('origin');
      const res = await handler(req);
      // A padded value is trimmed by the Fetch API into an allowed one; the exact-match rule itself is covered in the protocol cases.
      if (sent !== null && ALLOWED_ORIGINS.includes(sent)) continue;
      equal(res.status, 403, JSON.stringify(origin));
      equal(await res.text(), JSON.stringify({ error: 'origin_not_allowed' }));
      equal(res.headers.get('access-control-allow-origin'), null);
      equal(res.headers.get('vary'), 'Origin');
      equal(req.bodyUsed, false, 'body untouched');
      equal(calls.length, 0);
      const preflight = await handler(new Request('https://local/x', { method: 'OPTIONS', headers: { origin } }));
      equal(preflight.status, 403, `preflight ${JSON.stringify(origin)}`);
      equal(preflight.headers.get('access-control-allow-origin'), null);
    }
  }],
  ['an allowed origin is not authorization: a wrong code from the desktop origin is still refused', async () => {
    for (const origin of ALLOWED_ORIGINS) {
      equal(await shape(await setup({ ok: false }).handler(pair(valid(), { origin }))), REFUSAL, origin);
      const { handler, calls } = setup();
      equal(await shape(await handler(pair(valid({ code: '123456' }), { origin }))), REFUSAL, origin);
      equal(calls.length, 0);
    }
  }],
  ['endpoint_url is the HTTPS staging ingest endpoint; the obsolete edge_function_url is never emitted', async () => {
    const body = await (await setup().handler(pair(valid()))).json() as Record<string, unknown>;
    equal(body.endpoint_url, 'https://ldxgejbzmpvsvozqmpfe.supabase.co/functions/v1/now-playing-ingest');
    equal('edge_function_url' in body, false);
    const u = new URL(String(body.endpoint_url));
    equal([u.protocol, u.hostname, u.port, u.search, u.hash, u.username], ['https:', 'ldxgejbzmpvsvozqmpfe.supabase.co', '', '', '', '']);
    // A database reply cannot redirect the client: any endpoint it supplies is ignored.
    const spoofed = await (await setup({ ...SUCCESS, endpoint_url: 'https://evil.example/ingest', edge_function_url: 'https://evil.example/ingest' }).handler(pair(valid()))).json() as Record<string, unknown>;
    equal(spoofed.endpoint_url, body.endpoint_url);
    equal('edge_function_url' in spoofed, false);
  }],
  ['staging-backend enforcement: any other backend fails closed without a database call', async () => {
    for (const url of [undefined, '', 'https://rwdgnapajxcxktmewlxb.supabase.co', 'http://ldxgejbzmpvsvozqmpfe.supabase.co', 'https://ldxgejbzmpvsvozqmpfe.supabase.co.evil.example']) {
      const { handler, calls } = setup(SUCCESS, { url });
      const res = await handler(pair(valid()));
      equal(res.status, 503, String(url));
      assertNoSecret(await res.text(), SECRETS, 'non-staging');
      equal(calls.length, 0);
    }
    equal((await createBridgePairHandler({ url: STAGING_URL })(pair(valid()))).status, 503, 'no claim routine');
  }],
  ['only POST and OPTIONS are served', async () => {
    const { handler, calls } = setup();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) equal((await handler(new Request(`https://local/x?code=${GROUPED}`, { method }))).status, 405, method);
    equal(calls.length, 0);
  }],
  ['refusal body carries no hint of the reason', async () => {
    ok(!/expired|claimed|rate|limit|invalid|unknown/i.test(JSON.stringify(UNIFORM_FAILURE.body)), 'no reason words');
  }],
];
