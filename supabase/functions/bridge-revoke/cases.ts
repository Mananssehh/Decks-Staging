// Runner-neutral cases for the bridge-revoke handler (registered by handler_test.ts under Deno
// and by src/test/bridgePairingV2.test.ts under Vitest). The revoke RPC is a local stub.
import { ALLOW_HEADERS as REVOKE_ALLOW_HEADERS, createBridgeRevokeHandler, type Dependencies, type RevokeRpc } from './handler.ts';
import { ALLOWED_ORIGINS, type LogEntry } from '../_shared/bridge-protocol.ts';
import { REJECTED_ORIGINS, REJECTED_TOKENS, STAGING_URL, assertNoSecret, capturingConsole, equal, ok, type Case } from '../_shared/bridge-protocol_cases.ts';

const TOKEN = 'feedfacecafebeef'.repeat(4);
const LEGACY_TOKEN = 'cafe0123beef4567'.repeat(3);

function setup(reply: unknown = true, overrides: Partial<Dependencies> = {}) {
  const calls: unknown[][] = [];
  const logs: LogEntry[] = [];
  const revoke: RevokeRpc = async (...args) => {
    calls.push(args);
    if (reply instanceof Error) throw reply;
    return reply && typeof reply === 'object' && 'error' in reply ? reply as { data: unknown; error: unknown } : { data: reply, error: null };
  };
  const handler = createBridgeRevokeHandler({ url: STAGING_URL, revoke, log: (entry) => logs.push(entry), id: () => 'cid-fixture', ...overrides });
  return { handler, calls, logs };
}
const request = (headers: Record<string, string> = { 'x-ingest-token': TOKEN }, init: { body?: string; path?: string; method?: string } = {}) =>
  new Request(`https://local${init.path ?? '/functions/v1/bridge-revoke'}`, { method: init.method ?? 'POST', headers, body: init.body });
async function shape(res: Response) {
  return { status: res.status, body: await res.text(), type: res.headers.get('content-type'), cid: res.headers.get('x-correlation-id') };
}
const DONE = { status: 204, body: '', type: null, cid: null };

export const bridgeRevokeCases: readonly Case[] = [
  ['current token revokes its own integration and gets a body-free success', async () => {
    const { handler, calls } = setup(true);
    const res = await handler(request());
    equal(res.headers.get('cache-control'), 'no-store');
    equal(await shape(res), DONE);
    equal(calls, [[TOKEN]], 'only the presented token reaches the database');
  }],
  ['live, unknown, previously revoked, missing and malformed tokens all get the same body-free 204', async () => {
    const headersOf = (res: Response) => JSON.stringify([...res.headers.entries()].sort());
    const responses = [
      await setup(true).handler(request()),
      await setup(false).handler(request({ 'x-ingest-token': 'a'.repeat(48) })),
      await setup(false).handler(request()),
      await setup(true).handler(request({})),
      await setup(true).handler(request({ 'x-ingest-token': 'short' })),
    ];
    const reference = headersOf(responses[0]);
    for (const res of responses) {
      equal(headersOf(res), reference, 'identical headers');
      equal(await shape(res), DONE);
    }
  }],
  ['the token never appears in the response, on any path', async () => {
    for (const reply of [true, false, { data: null, error: { code: 'XX000', message: TOKEN } }, new Error(TOKEN)]) {
      const res = await setup(reply).handler(request());
      assertNoSecret(JSON.stringify([...res.headers.entries()]) + await res.text(), [TOKEN], 'revoke response');
    }
  }],
  ['missing and malformed tokens get the same response without a database call', async () => {
    const candidates: Record<string, string>[] = [{}, { 'x-ingest-token': '' }, { 'x-ingest-token': 'a b c d e f g h i j k l' }];
    for (const bad of REJECTED_TOKENS) if (typeof bad === 'string') candidates.push({ 'x-ingest-token': bad });
    for (const headers of candidates) {
      const { handler, calls } = setup(true);
      let req: Request;
      try { req = request(headers); } catch { continue; } // a value the Fetch API itself refuses to send
      const sent = req.headers.get('x-ingest-token');
      if (sent !== null && /^(?:[0-9a-f]{48}|[0-9a-f]{64})$/.test(sent)) continue; // header trimming turned padding into a valid token
      equal(await shape(await handler(req)), DONE, JSON.stringify(headers).slice(0, 40));
      equal(calls.length, 0, JSON.stringify(headers).slice(0, 40));
    }
  }],
  ['uppercase, underscore, hyphen, URL-safe and every wrong-length token is rejected before the database', async () => {
    for (const bad of ['A'.repeat(64), 'A'.repeat(48), 'FEEDFACECAFEBEEF'.repeat(4), `${'a'.repeat(63)}_`, `${'a'.repeat(63)}-`, `${'a'.repeat(47)}_`, `${'a'.repeat(47)}-`,
      'fixture-url-safe-token_0123456789abcdefghijklmnop', 'AbCdEfGh-_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR']) {
      const { handler, calls } = setup(true);
      equal(await shape(await handler(request({ 'x-ingest-token': bad }))), DONE, bad.slice(0, 20));
      equal(calls.length, 0, bad.slice(0, 20));
    }
    for (let length = 1; length <= 130; length++) {
      const { handler, calls } = setup(true);
      equal(await shape(await handler(request({ 'x-ingest-token': 'b'.repeat(length) }))), DONE, `length ${length}`);
      equal(calls.length, length === 48 || length === 64 ? 1 : 0, `length ${length}`);
    }
  }],
  ['a legacy 48-character and a v2 64-character lowercase hex token both reach the database unchanged', async () => {
    for (const token of [LEGACY_TOKEN, TOKEN]) {
      const { handler, calls } = setup(true);
      equal(await shape(await handler(request({ 'x-ingest-token': token }))), DONE);
      equal(calls, [[token]]);
    }
  }],
  ['an otherwise valid request with a query string, a body or an Authorization header is a 204 no-op with no database call', async () => {
    const variants: [string, () => Request][] = [
      ['empty query', () => request({ 'x-ingest-token': TOKEN }, { path: '/functions/v1/bridge-revoke?' })],
      ['query', () => request({ 'x-ingest-token': TOKEN }, { path: '/functions/v1/bridge-revoke?x=1' })],
      ['token duplicated in query', () => request({ 'x-ingest-token': TOKEN }, { path: `/functions/v1/bridge-revoke?token=${TOKEN}` })],
      ['body', () => request({ 'x-ingest-token': TOKEN }, { body: '{}' })],
      ['token duplicated in body', () => request({ 'x-ingest-token': TOKEN, 'content-type': 'application/json' }, { body: JSON.stringify({ ingest_token: TOKEN }) })],
      ['single-byte body', () => request({ 'x-ingest-token': TOKEN }, { body: ' ' })],
      ['declared body length', () => request({ 'x-ingest-token': TOKEN, 'content-length': '2' })],
      ['authorization bearer', () => request({ 'x-ingest-token': TOKEN, authorization: 'Bearer anon-key' })],
      ['token duplicated in authorization', () => request({ 'x-ingest-token': TOKEN, authorization: `Bearer ${TOKEN}` })],
      ['empty authorization', () => request({ 'x-ingest-token': TOKEN, authorization: '' })],
      ['all three', () => request({ 'x-ingest-token': TOKEN, authorization: `Bearer ${TOKEN}` }, { body: TOKEN, path: `/functions/v1/bridge-revoke?token=${TOKEN}` })],
    ];
    for (const [label, build] of variants) {
      const { handler, calls } = setup(true);
      const req = build();
      const res = await handler(req);
      equal(await shape(res), DONE, label);
      equal(req.bodyUsed, false, `body never read: ${label}`);
      equal(calls.length, 0, label);
    }
    const control = setup(true);
    equal(await shape(await control.handler(request({ 'x-ingest-token': TOKEN }))), DONE, 'control');
    equal(control.calls, [[TOKEN]], 'the same request without the extras does revoke');
    const zero = setup(true);
    await zero.handler(request({ 'x-ingest-token': TOKEN, 'content-length': '0' }));
    equal(zero.calls, [[TOKEN]], 'an explicit zero-length body is still body-free');
  }],
  ['the token is taken from the X-Ingest-Token header only: never the URL, body or Authorization', async () => {
    const { handler, calls } = setup(true);
    const req = request({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      { body: JSON.stringify({ ingest_token: TOKEN, event_id: '11111111-2222-4333-8444-555555555555' }), path: `/functions/v1/bridge-revoke?token=${TOKEN}&event_id=x` });
    equal(await shape(await handler(req)), DONE);
    equal(req.bodyUsed, false, 'body never read');
    equal(calls.length, 0);
  }],
  ['caller cannot choose a target: nothing but the token is passed on', async () => {
    const { handler, calls } = setup(true);
    await handler(request({ 'x-ingest-token': TOKEN, 'x-event-id': 'other', 'x-user-id': 'other', 'x-forwarded-for': '1.2.3.4' }));
    equal(calls, [[TOKEN]]);
  }],
  ['database errors fail closed with allowlisted diagnostics; the token never reaches logs, console or response', async () => {
    for (const reply of [{ data: null, error: { code: '55P03', message: `lock ${TOKEN}`, details: TOKEN } }, new Error(`boom ${TOKEN}`), 'yes', null, { revoked: true }]) {
      const { handler, logs } = setup(reply);
      const { result: res, output } = await capturingConsole(() => handler(request()));
      equal(res.status, 503, JSON.stringify(reply)?.slice(0, 30));
      equal(res.headers.get('x-correlation-id'), 'cid-fixture');
      const text = await res.text();
      equal(text, JSON.stringify({ error: 'service_unavailable' }));
      equal(Object.keys(logs[0]).sort(), ['category', 'cid', 'evt', 'ms', 'sqlstate']);
      assertNoSecret(text + JSON.stringify(logs) + output, [TOKEN], 'revoke error path');
    }
  }],
  ['nothing is written to the console on success or no-op paths', async () => {
    for (const reply of [true, false]) {
      const { output } = await capturingConsole(() => createBridgeRevokeHandler({ url: STAGING_URL, revoke: async () => ({ data: reply, error: null }) })(request()));
      equal(output, '');
    }
    const failing = await capturingConsole(() => createBridgeRevokeHandler({ url: STAGING_URL, revoke: async () => ({ data: null, error: { code: 'XX000', message: TOKEN } }) })(request()));
    assertNoSecret(failing.output, [TOKEN], 'default logger');
  }],
  ['desktop request with no Origin header is accepted; the two desktop-webview origins are echoed and preflight allows exactly X-Ingest-Token', async () => {
    const native = await setup().handler(request());
    equal(native.headers.get('access-control-allow-origin'), null);
    equal(native.headers.get('vary'), 'Origin');
    equal(ALLOWED_ORIGINS, ['tauri://localhost', 'http://tauri.localhost']);
    for (const origin of ALLOWED_ORIGINS) {
      const { handler, calls } = setup();
      const res = await handler(request({ 'x-ingest-token': TOKEN, origin }));
      equal(res.status, 204, origin);
      equal(res.headers.get('access-control-allow-origin'), origin);
      equal(res.headers.get('vary'), 'Origin');
      const preflight = await handler(new Request('https://local/x', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-ingest-token' } }));
      equal(preflight.status, 204);
      equal(await preflight.text(), '');
      // Exact header set: this endpoint allows x-ingest-token and nothing else.
      equal([...preflight.headers.entries()].sort(), [
        ['access-control-allow-headers', 'x-ingest-token'], ['access-control-allow-methods', 'POST,OPTIONS'], ['access-control-allow-origin', origin],
        ['access-control-expose-headers', 'x-correlation-id'], ['cache-control', 'no-store'], ['vary', 'Origin'],
      ], `preflight headers for ${origin}`);
      equal(REVOKE_ALLOW_HEADERS, 'x-ingest-token');
      equal([...res.headers.entries()].sort(), [
        ['access-control-allow-headers', 'x-ingest-token'], ['access-control-allow-methods', 'POST,OPTIONS'], ['access-control-allow-origin', origin],
        ['access-control-expose-headers', 'x-correlation-id'], ['cache-control', 'no-store'], ['vary', 'Origin'],
      ], `response headers for ${origin}`);
      for (const forbidden of ['content-type', 'authorization', 'apikey', 'x-client-info', '*']) {
        ok(!String(preflight.headers.get('access-control-allow-headers')).split(',').includes(forbidden), `${forbidden} not allowed`);
      }
      equal(calls.length, 1, 'preflight never reaches the database');
    }
  }],
  ['website, preview, linku99, localhost and every suffix, scheme, port and case variant are refused with 403 before database access', async () => {
    for (const origin of REJECTED_ORIGINS) {
      const { handler, calls } = setup();
      const req = request({ 'x-ingest-token': TOKEN, origin });
      const sent = req.headers.get('origin');
      const res = await handler(req);
      if (sent !== null && ALLOWED_ORIGINS.includes(sent)) continue;
      equal(res.status, 403, JSON.stringify(origin));
      equal(res.headers.get('access-control-allow-origin'), null);
      equal(res.headers.get('vary'), 'Origin');
      equal(calls.length, 0);
      equal((await handler(new Request('https://local/x', { method: 'OPTIONS', headers: { origin } }))).status, 403);
    }
  }],
  ['an allowed origin is not authorization: without a well-formed token nothing is revoked', async () => {
    for (const origin of ALLOWED_ORIGINS) {
      const { handler, calls } = setup(true);
      equal(await shape(await handler(request({ origin }))), DONE, origin);
      equal(await shape(await handler(request({ origin, 'x-ingest-token': 'bad token' }))), DONE, origin);
      equal(calls.length, 0);
    }
  }],
  ['staging-backend enforcement and method allowlist', async () => {
    for (const url of [undefined, 'https://rwdgnapajxcxktmewlxb.supabase.co']) {
      const { handler, calls } = setup(true, { url });
      equal((await handler(request())).status, 503, String(url));
      equal(calls.length, 0);
    }
    equal((await createBridgeRevokeHandler({ url: STAGING_URL })(request())).status, 503, 'no revoke routine');
    const { handler, calls } = setup();
    for (const method of ['GET', 'DELETE', 'PUT']) equal((await handler(request({ 'x-ingest-token': TOKEN }, { method }))).status, 405, method);
    equal(calls.length, 0);
  }],
];
