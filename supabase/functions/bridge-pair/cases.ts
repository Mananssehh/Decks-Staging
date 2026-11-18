// Runner-neutral cases for the bridge-pair handler (registered by handler_test.ts under Deno
// and by src/test/bridgePairingV2.test.ts under Vitest). The claim RPC is a local stub.
import { ALLOW_HEADERS, createBridgePairHandler, UNIFORM_FAILURE, type ClaimRpc, type Dependencies } from './handler.ts';
import { ALLOWED_ORIGINS, type LogEntry } from '../_shared/bridge-protocol.ts';
import {
  CODE_VECTORS, REJECTED_CODES, REJECTED_ORIGINS, REJECTED_TOKENS, STAGING_URL, assertNoSecret, capturingConsole, equal, ok, type Case,
} from '../_shared/bridge-protocol_cases.ts';
import { createPendingCallLimit, type PendingCallLimit } from '../_shared/bridge-admission.ts';
import { deferred, settle, type Deferred } from '../_shared/bridge-admission_cases.ts';
import { createBridgeRevokeHandler } from '../bridge-revoke/handler.ts';

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
const SHED = { status: 503, body: JSON.stringify({ error: 'service_unavailable' }), type: 'application/json', cache: 'no-store' };
type Reply = { data: unknown; error: unknown };

// Pending-claim limit fixtures. Every claim call made through `gated` stays pending until the
// test settles its gate by hand, so "full", "pending" and "released" are exact states, not timing.
// `gatedDeps()` with no argument builds dependencies with no `admission` key at all, so the
// handler's own default limit applies; `gated(limit)` always passes an explicit limit.
function gatedDeps(admission?: PendingCallLimit) {
  const calls: string[][] = [];
  const gates: Deferred<Reply>[] = [];
  const logs: LogEntry[] = [];
  const claim: ClaimRpc = (code, clientNonce) => {
    calls.push([code, clientNonce]);
    const gate = deferred<Reply>();
    gates.push(gate);
    return gate.promise;
  };
  const deps: Dependencies = { url: STAGING_URL, claim, log: (entry) => logs.push(entry), id: () => 'cid-fixture', ...(admission ? { admission } : {}) };
  ok(admission !== undefined || !('admission' in deps), 'admission omitted from the dependencies');
  return { handler: createBridgePairHandler(deps), calls, gates, logs };
}
function gated(limit = 4) {
  const admission = createPendingCallLimit(limit);
  return { ...gatedDeps(admission), admission };
}
/** Waits, a macrotask at a time, until the handler has reached the claim call. */
async function until(condition: () => boolean, label: string) {
  for (let i = 0; i < 50 && !condition(); i++) await settle();
  ok(condition(), label);
}
const otherNonce = (i: number) => `fixture-other-nonce-${String(i).padStart(4, '0')}`;
const OTHER_CODE = '0123-4567-89AB-CDEF';
type RequestFactory = (url: string, init: RequestInit) => Request;
const nativeRequest: RequestFactory = (url, init) => new Request(url, init);
// Stands in for a Request constructor that refuses an AbortSignal from another realm, as Node 24's
// undici Request does with the jsdom AbortController that Vitest's jsdom environment installs.
const strictRealmRequest: RequestFactory = (url, init) => {
  if (init.signal) throw new TypeError("Failed to construct 'Request': member signal is not of type AbortSignal.");
  return new Request(url, init);
};
/**
 * A genuine Request whose `signal` is aborted by a controller the test owns. The controller's
 * signal goes through RequestInit when the constructor accepts it. When the constructor refuses
 * it as coming from another realm, the Request is built without one and that same signal is
 * installed as its `signal`: an aborted `req.signal` is all a handler can observe of a disconnect.
 */
function disconnectableRequest(body: unknown, make: RequestFactory) {
  const controller = new AbortController();
  const url = 'https://local/functions/v1/bridge-pair';
  const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  let request: Request;
  let signalViaInit = true;
  try {
    request = make(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    signalViaInit = false;
    request = make(url, init);
    Object.defineProperty(request, 'signal', { value: controller.signal, configurable: true });
  }
  return { request, signalViaInit, abort: () => controller.abort() };
}
const revokeRequest = () => new Request('https://local/functions/v1/bridge-revoke', { method: 'POST', headers: { 'x-ingest-token': TOKEN } });

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
    for (const client_nonce of [undefined, null, '', 'short', 'A'.repeat(65), `${'A'.repeat(21)}+`, 1.2345678901234567e19, { a: 1 }]) {
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
  ['a well-formed request gets the existing 503 while the worker is full, whatever its code’s state: no correlation id, no log, no claim call', async () => {
    const w = gated(4);
    const inflight = [0, 1, 2, 3].map((i) => w.handler(pair(valid({ client_nonce: otherNonce(i) }))));
    await until(() => w.calls.length === 4, 'four claims pending');
    equal(w.admission.pending(), 4);
    const res = await w.handler(pair(valid()));
    equal(await shape(res), SHED);
    equal(res.headers.get('x-correlation-id'), null, 'database not reached: no correlation id');
    // A well-formed code the database would refuse is not reported as 404 while full: it is never looked up.
    equal(await shape(await w.handler(pair(valid({ code: OTHER_CODE, client_nonce: otherNonce(9) })))), SHED, 'unknown well-formed code');
    equal(w.calls.length, 4, 'zero claim calls for the shed requests');
    equal(w.logs.length, 0, 'shedding logs nothing');
    for (const gate of w.gates) gate.resolve({ data: SUCCESS, error: null });
    for (const done of await Promise.all(inflight)) equal(done.status, 200);
    equal(w.admission.pending(), 0);
  }],
  ['malformed input gets the uniform 404 before admission: even while the worker is full it takes no slot and makes no claim call', async () => {
    const w = gated(4);
    const inflight = [0, 1, 2, 3].map((i) => w.handler(pair(valid({ client_nonce: otherNonce(i) }))));
    await until(() => w.calls.length === 4, 'four claims pending');
    const malformed: Request[] = [
      pair('{'), pair('[]'), pair(valid({ code: '123456' })), pair(valid({ code: 'GHJK-MNPQ-RSTV-WXYU' })), pair(valid({ protocol_version: 1 })),
      pair(valid({ client_nonce: 'short' })), pair(valid(), {}, '/functions/v1/bridge-pair?x=1'), pair(valid(), { 'content-type': 'text/plain' }),
      pair(valid({ pad: 'x'.repeat(4096) })),
    ];
    for (const req of malformed) equal(await shape(await w.handler(req)), REFUSAL);
    equal(w.calls.length, 4, 'no claim call');
    equal(w.admission.pending(), 4, 'no slot taken or freed');
    for (const gate of w.gates) gate.resolve({ data: SUCCESS, error: null });
    await Promise.all(inflight);
  }],
  ['an admitted claim that the database refuses gets the uniform 404 and frees its slot', async () => {
    const w = gated(1);
    const admitted = w.handler(pair(valid({ code: OTHER_CODE })));
    await until(() => w.calls.length === 1, 'claim admitted and pending');
    equal(await shape(await w.handler(pair(valid({ code: OTHER_CODE })))), SHED, 'the same request is shed while the slot is held');
    w.gates[0].resolve({ data: { ok: false }, error: null });
    const res = await admitted;
    equal(await shape(res), REFUSAL);
    equal(res.headers.get('x-correlation-id'), null);
    equal(w.admission.pending(), 0, 'slot freed');
    equal(w.calls.length, 1);
  }],
  ['a slot is freed when its claim succeeds, and not before', async () => {
    const w = gated(1);
    const first = w.handler(pair(valid({ client_nonce: otherNonce(1) })));
    await until(() => w.calls.length === 1, 'first claim pending');
    equal(await shape(await w.handler(pair(valid()))), SHED);
    w.gates[0].resolve({ data: SUCCESS, error: null });
    equal((await first).status, 200);
    equal(w.admission.pending(), 0);
    const next = w.handler(pair(valid()));
    await until(() => w.calls.length === 2, 'next request admitted');
    w.gates[1].resolve({ data: SUCCESS, error: null });
    equal((await next).status, 200);
  }],
  ['a slot is freed when its claim fails: refusal, database error, invalid response or thrown error', async () => {
    const outcomes: [string, (gate: Deferred<Reply>) => void, number, string | null][] = [
      ['refusal', (g) => g.resolve({ data: { ok: false }, error: null }), 404, null],
      ['database error', (g) => g.resolve({ data: null, error: { code: '57014' } }), 503, 'cid-fixture'],
      ['invalid response', (g) => g.resolve({ data: 'not an object', error: null }), 503, 'cid-fixture'],
      ['thrown error', (g) => g.reject(new Error('transport')), 503, 'cid-fixture'],
    ];
    for (const [label, fail, status, cid] of outcomes) {
      const w = gated(1);
      const first = w.handler(pair(valid()));
      await until(() => w.calls.length === 1, `${label}: pending`);
      equal(await shape(await w.handler(pair(valid()))), SHED, `${label}: full while pending`);
      fail(w.gates[0]);
      const res = await first;
      equal(res.status, status, label);
      equal(res.headers.get('x-correlation-id'), cid, `${label}: correlation id only when the database was reached`);
      equal(w.admission.pending(), 0, `${label}: slot freed`);
      const next = w.handler(pair(valid()));
      await until(() => w.calls.length === 2, `${label}: next request admitted`);
      w.gates[1].resolve({ data: SUCCESS, error: null });
      equal((await next).status, 200, `${label}: next succeeds`);
    }
  }],
  ['a caller disconnect or elapsed time does not free a slot while its claim is still pending', async () => {
    for (const [label, make] of [['runtime Request', nativeRequest], ['cross-realm signal refused', strictRealmRequest]] as const) {
      const w = gated(1);
      const { request, signalViaInit, abort } = disconnectableRequest(valid(), make);
      if (make === strictRealmRequest) equal(signalViaInit, false, `${label}: fallback path taken`);
      equal(request.signal.aborted, false, `${label}: not yet aborted`);
      const first = w.handler(request);
      await until(() => w.calls.length === 1, `${label}: claim pending`);
      abort();
      equal(request.signal.aborted, true, `${label}: the request's signal is aborted while the claim is pending`);
      for (let i = 0; i < 10; i++) await settle();
      equal(w.admission.pending(), 1, `${label}: still held after disconnect and elapsed turns`);
      equal(await shape(await w.handler(pair(valid({ client_nonce: otherNonce(2) })))), SHED, `${label}: worker still full`);
      equal(w.calls.length, 1);
      w.gates[0].resolve({ data: SUCCESS, error: null });
      equal((await first).status, 200, `${label}: the pending claim still completes`);
      equal(w.admission.pending(), 0, `${label}: freed only when the claim settled`);
    }
  }],
  ['same-nonce recovery after a slot frees: a shed first claim, and a lost successful response', async () => {
    // Local model of the database contract: first claim wins, same nonce replays the same token,
    // a different nonce is refused. Other traffic hangs on gates until the test frees it.
    const claimed = new Map<string, { nonce: string; token: string }>();
    const djCalls: string[] = [];
    const gates: Deferred<Reply>[] = [];
    const admission = createPendingCallLimit(4);
    const claim: ClaimRpc = (code, clientNonce) => {
      if (code !== CANONICAL) { const gate = deferred<Reply>(); gates.push(gate); return gate.promise; }
      djCalls.push(clientNonce);
      const prior = claimed.get(code);
      if (!prior) { claimed.set(code, { nonce: clientNonce, token: TOKEN }); return Promise.resolve({ data: SUCCESS, error: null }); }
      return Promise.resolve({ data: prior.nonce === clientNonce ? SUCCESS : { ok: false }, error: null });
    };
    const handler = createBridgePairHandler({ url: STAGING_URL, claim, admission });
    const fill = async (from: number) => {
      const pending = [0, 1, 2, 3].map((i) => handler(pair(valid({ code: OTHER_CODE, client_nonce: otherNonce(from + i) }))));
      await until(() => admission.pending() === 4, 'worker full');
      return pending;
    };
    // 1. The worker is full when the DJ first submits: nothing is claimed, the code stays usable.
    let others = await fill(0);
    equal(await shape(await handler(pair(valid()))), SHED, 'shed first attempt');
    equal(djCalls.length, 0);
    gates.shift()!.resolve({ data: { ok: false }, error: null });
    await until(() => admission.pending() === 3, 'one slot freed');
    const recovered = await handler(pair(valid()));
    equal(recovered.status, 200, 'same code, same nonce succeeds once a slot frees');
    equal(((await recovered.json()) as Record<string, unknown>).ingest_token, TOKEN);
    for (const gate of gates.splice(0)) gate.resolve({ data: { ok: false }, error: null });
    await Promise.all(others);
    // 2. The success response above is "lost". The worker fills again before the retry.
    others = await fill(10);
    equal(await shape(await handler(pair(valid()))), SHED, 'retry shed while full');
    gates.shift()!.resolve({ data: { ok: false }, error: null });
    await until(() => admission.pending() === 3, 'one slot freed');
    const retry = await handler(pair(valid()));
    equal(retry.status, 200, 'same-nonce retry recovers the lost response');
    equal(((await retry.json()) as Record<string, unknown>).ingest_token, TOKEN, 'same token');
    equal(await shape(await handler(pair(valid({ client_nonce: otherNonce(99) })))), REFUSAL, 'a different nonce never reclaims');
    equal(djCalls, [NONCE, NONCE, otherNonce(99)], 'shed attempts never reached the database');
    for (const gate of gates.splice(0)) gate.resolve({ data: { ok: false }, error: null });
    await Promise.all(others);
  }],
  ['with admission omitted, the handler’s default limit is exactly four pending claims per instance, and instances share nothing', async () => {
    const a = gatedDeps(), b = gatedDeps();
    const inflight = [0, 1, 2, 3].map((i) => a.handler(pair(valid({ client_nonce: otherNonce(i) }))));
    await until(() => a.calls.length === 4, 'four pending on worker a');
    equal(await shape(await a.handler(pair(valid()))), SHED, 'fifth refused on worker a');
    const other = b.handler(pair(valid()));
    await until(() => b.calls.length === 1, 'worker b unaffected');
    b.gates[0].resolve({ data: SUCCESS, error: null });
    equal((await other).status, 200);
    for (const gate of a.gates) gate.resolve({ data: SUCCESS, error: null });
    await Promise.all(inflight);
  }],
  ['the revoke handler is independent of the pairing cap', async () => {
    const w = gated(4);
    const inflight = [0, 1, 2, 3].map((i) => w.handler(pair(valid({ client_nonce: otherNonce(i) }))));
    await until(() => w.calls.length === 4, 'pairing worker full');
    equal(await shape(await w.handler(pair(valid()))), SHED);
    const revoked: string[] = [];
    const revoke = createBridgeRevokeHandler({ url: STAGING_URL, revoke: async (token) => { revoked.push(token); return { data: true, error: null }; } });
    for (let i = 0; i < 8; i++) equal((await revoke(revokeRequest())).status, 204, `revoke ${i}`);
    equal(revoked.length, 8, 'every revoke reached its RPC while pairing was saturated');
    equal(w.admission.pending(), 4, 'revokes took no pairing slot');
    for (const gate of w.gates) gate.resolve({ data: SUCCESS, error: null });
    await Promise.all(inflight);
  }],
];
