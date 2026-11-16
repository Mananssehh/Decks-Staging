// Runner-neutral cases for Bridge Pairing Protocol v2. Web-standard APIs only, so the same
// cases register under Deno (`*_test.ts`) and Vitest (`src/test/bridgePairingV2.test.ts`).
import {
  ALLOWED_ORIGINS, CODE_ALPHABET, allowedOrigin, boundedJsonObject, diagnose, groupPairingCode, normalizePairingCode,
  carriesBody, hasQuery, jsonMediaType, responseHeaders, stagingBackend, validClientNonce, validIssuedToken, validRevocableToken,
} from './bridge-protocol.ts';

export type Case = readonly [name: string, run: () => Promise<void>];

export function equal(actual: unknown, expected: unknown, label = 'value'): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}
export function ok(value: unknown, label: string): void {
  if (!value) throw new Error(`${label}: expected truthy`);
}
/** Runs fn while recording everything written through console.*; restores the console afterwards. */
export async function capturingConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const names = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const saved = names.map((name) => target[name]);
  const lines: string[] = [];
  names.forEach((name) => {
    target[name] = (...args: unknown[]) => {
      lines.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    };
  });
  try {
    return { result: await fn(), output: lines.join('\n') };
  } finally {
    names.forEach((name, i) => { target[name] = saved[i]; });
  }
}
export function assertNoSecret(haystack: string, secrets: readonly string[], label: string): void {
  const lower = haystack.toLowerCase();
  for (const secret of secrets) {
    if (secret && lower.includes(secret.toLowerCase())) throw new Error(`${label}: secret material present`);
  }
}

export const STAGING_URL = 'https://ldxgejbzmpvsvozqmpfe.supabase.co';
/** Desktop test vectors: [typed input, canonical form, grouped display form]. */
export const CODE_VECTORS: readonly (readonly [string, string, string])[] = [
  ['0123456789ABCDEF', '0123456789ABCDEF', '0123-4567-89AB-CDEF'],
  ['0123-4567-89AB-CDEF', '0123456789ABCDEF', '0123-4567-89AB-CDEF'],
  ['GHJK-MNPQ-RSTV-WXYZ', 'GHJKMNPQRSTVWXYZ', 'GHJK-MNPQ-RSTV-WXYZ'],
  ['ghjk-mnpq-rstv-wxyz', 'GHJKMNPQRSTVWXYZ', 'GHJK-MNPQ-RSTV-WXYZ'],
  [' ghjk mnpq  rstv wxyz ', 'GHJKMNPQRSTVWXYZ', 'GHJK-MNPQ-RSTV-WXYZ'],
  ['g-h-j-k-m-n-p-q-r-s-t-v-w-x-y-z', 'GHJKMNPQRSTVWXYZ', 'GHJK-MNPQ-RSTV-WXYZ'],
  ['OIL0-oil1-ABCD-EFGH', '01100111ABCDEFGH', '0110-0111-ABCD-EFGH'],
  ['OOOO-IIII-LLLL-oilo', '0000111111110110', '0000-1111-1111-0110'],
];
export const REJECTED_CODES: readonly unknown[] = [
  '', ' ', '-', '123456', '123-456', '000000',
  '0123456789ABCDE', '0123456789ABCDEF0', '0123-4567-89AB-CDE', '0123-4567-89AB-CDEF-0',
  '0123456789ABCDEU', 'UUUU-UUUU-UUUU-UUUU', '0123456789ABCDE!', '0123_4567_89AB_CDEF', '0123\t4567\t89AB\tCDEF',
  '0123-4567-89AB-CDEF\n', '0123456789ABCDEı', '０123456789ABCDEF', '0123456789ABCDEſ',
  `0123-4567-89AB-CDEF${' '.repeat(60)}`, '0'.repeat(65), 'A'.repeat(10_000),
  1234567890123456, null, undefined, true, {}, [], ['0123456789ABCDEF'],
];

/** Browser origins that must be refused by bridge-pair and bridge-revoke. */
export const REJECTED_ORIGINS: readonly string[] = [
  'https://encore-request-rally.lovable.app',
  'https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app',
  'https://linku99.com', 'https://www.linku99.com',
  'http://localhost', 'http://localhost:1420', 'http://localhost:3000', 'https://localhost', 'http://127.0.0.1:1420', 'http://[::1]:1420',
  // suffix, prefix and subdomain variants
  'tauri://localhost.evil.example', 'http://tauri.localhost.evil.example', 'http://evil.tauri.localhost', 'http://xtauri.localhost', 'tauri://localhost/', 'http://tauri.localhost/',
  // scheme variants
  'https://tauri.localhost', 'tauri://tauri.localhost', 'http://localhost.tauri', 'https://tauri://localhost',
  // port variants
  'tauri://localhost:1420', 'http://tauri.localhost:80', 'http://tauri.localhost:1420',
  // case and whitespace variants
  'TAURI://LOCALHOST', 'Tauri://localhost', 'http://Tauri.localhost', 'HTTP://TAURI.LOCALHOST', ' tauri://localhost', 'tauri://localhost ',
  'https://evil.example', 'null', '',
];

/** Token-shaped strings that neither pairing nor revocation may accept. */
export const REJECTED_TOKENS: readonly unknown[] = [
  '', 'short', 'A'.repeat(64), 'A'.repeat(48), `${'a'.repeat(63)}A`, `${'a'.repeat(47)}F`,
  'a'.repeat(47), 'a'.repeat(49), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(16), 'a'.repeat(32), 'a'.repeat(56), 'a'.repeat(96), 'a'.repeat(128), 'a'.repeat(129),
  `${'a'.repeat(63)}_`, `${'a'.repeat(63)}-`, `${'a'.repeat(47)}_`, `${'a'.repeat(47)}-`, `${'a'.repeat(63)}g`, `${'a'.repeat(47)}z`,
  'AbCdEfGh-_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR', 'fixture-url-safe-token_0123456789abcdefghijklmnop',
  ` ${'a'.repeat(63)}`, `${'a'.repeat(63)} `, `${'a'.repeat(64)}\n`, `0x${'a'.repeat(62)}`, `${'a'.repeat(32)} ${'a'.repeat(31)}`,
  null, undefined, 0, 64, true, {}, ['a'.repeat(64)],
];

export const protocolCases: readonly Case[] = [
  ['alphabet is the 32 Crockford symbols without I, L, O, U', async () => {
    equal(CODE_ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    equal(new Set(CODE_ALPHABET).size, 32);
    for (const excluded of 'ILOU') ok(!CODE_ALPHABET.includes(excluded), `excluded ${excluded}`);
  }],
  ['every one of the 32 symbols is accepted, upper and lower case', async () => {
    for (const symbol of CODE_ALPHABET) {
      equal(normalizePairingCode(symbol.repeat(16)), symbol.repeat(16), `upper ${symbol}`);
      equal(normalizePairingCode(symbol.toLowerCase().repeat(16)), symbol.repeat(16), `lower ${symbol}`);
    }
    equal(normalizePairingCode(CODE_ALPHABET.slice(0, 16)), CODE_ALPHABET.slice(0, 16));
    equal(normalizePairingCode(CODE_ALPHABET.slice(16)), CODE_ALPHABET.slice(16));
  }],
  ['aliases O→0, I→1 and L→1 in either case', async () => {
    equal(normalizePairingCode('O'.repeat(16)), '0'.repeat(16));
    equal(normalizePairingCode('o'.repeat(16)), '0'.repeat(16));
    for (const alias of ['I', 'i', 'L', 'l']) equal(normalizePairingCode(alias.repeat(16)), '1'.repeat(16), alias);
    equal(normalizePairingCode('U'.repeat(16)), null, 'U has no alias');
  }],
  ['desktop vectors: hyphens, spaces and lowercase normalize to canonical and grouped forms', async () => {
    for (const [typed, canonical, grouped] of CODE_VECTORS) {
      equal(normalizePairingCode(typed), canonical, `canonical of ${JSON.stringify(typed)}`);
      equal(groupPairingCode(canonical), grouped, `grouped of ${canonical}`);
      equal(normalizePairingCode(grouped), canonical, `round trip of ${grouped}`);
    }
  }],
  ['malformed, short, long, oversized, non-ASCII and six-digit codes are rejected', async () => {
    for (const bad of REJECTED_CODES) equal(normalizePairingCode(bad), null, `rejects ${JSON.stringify(bad)?.slice(0, 40)}`);
  }],
  ['client nonce: 128-bit base64url or hex, bounded and URL-safe', async () => {
    for (const good of ['A'.repeat(22), 'a1B2-c3D4_e5F6g7H8i9J0k', '0123456789abcdef0123456789abcdef', 'Z'.repeat(64)]) ok(validClientNonce(good), `accepts ${good.length}`);
    for (const bad of ['', 'A'.repeat(21), 'A'.repeat(65), `${'A'.repeat(21)} `, `${'A'.repeat(21)}+`, `${'A'.repeat(21)}/`, `${'A'.repeat(21)}=`, 42, null, undefined, {}]) {
      ok(!validClientNonce(bad), `rejects ${JSON.stringify(bad)}`);
    }
  }],
  ['pairing-issued token: exactly 64 lowercase hexadecimal characters and nothing else', async () => {
    ok(validIssuedToken('f'.repeat(64)), '64 hex');
    ok(validIssuedToken('0123456789abcdef'.repeat(4)), 'all hex digits');
    ok(!validIssuedToken('a'.repeat(48)), 'legacy 48 is not a pairing result');
    for (const bad of REJECTED_TOKENS) ok(!validIssuedToken(bad), `rejects ${JSON.stringify(bad)?.slice(0, 24)}`);
  }],
  ['revocable token: exactly 48 or 64 lowercase hexadecimal characters and nothing else', async () => {
    ok(validRevocableToken('a'.repeat(48)), 'legacy 48 hex');
    ok(validRevocableToken('f'.repeat(64)), 'v2 64 hex');
    ok(validRevocableToken('0123456789abcdef'.repeat(3)), 'all hex digits, 48');
    for (const bad of REJECTED_TOKENS) ok(!validRevocableToken(bad), `rejects ${JSON.stringify(bad)?.slice(0, 24)}`);
    for (let length = 0; length <= 130; length++) {
      equal(validRevocableToken('b'.repeat(length)), length === 48 || length === 64, `length ${length}`);
      equal(validIssuedToken('b'.repeat(length)), length === 64, `issued length ${length}`);
    }
  }],
  ['media type: application/json with an optional UTF-8 charset, nothing else', async () => {
    const at = (value?: string) => jsonMediaType({ headers: { get: (name: string) => name === 'content-type' && value !== undefined ? value : null } } as unknown as Request);
    for (const good of ['application/json', 'application/json; charset=utf-8', 'application/json;charset=UTF-8', 'APPLICATION/JSON', 'application/json ; charset=utf-8', ' application/json ']) ok(at(good), good);
    for (const bad of [undefined, '', 'text/plain', 'text/plain;charset=UTF-8', 'text/json', 'application/jsonx', 'application/json5', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x',
      'application/json; charset=latin1', 'application/json; charset=utf-16', 'application/json; boundary=x', 'application/json, text/plain', 'application/ld+json', 'application/json;', '*/*']) ok(!at(bad), String(bad));
  }],
  ['query detection: any query component, even an empty one', async () => {
    const at = (url: string) => hasQuery({ url } as unknown as Request);
    for (const url of ['https://local/x?code=1', 'https://local/x?', 'https://local/x?a', 'https://local/x/?token=1&b=2']) ok(at(url), url);
    for (const url of ['https://local/x', 'https://local/functions/v1/bridge-pair', 'https://local/x/']) ok(!at(url), url);
  }],
  ['body detection: declared by header or present as a stream, and never read', async () => {
    const stub = (headers: Record<string, string>, body: unknown = null) => ({ headers: { get: (n: string) => headers[n] ?? null, has: (n: string) => n in headers }, body } as unknown as Request);
    ok(!carriesBody(stub({})), 'no headers, no stream');
    ok(!carriesBody(stub({ 'content-length': '0' })), 'explicit zero length');
    ok(!carriesBody(stub({ 'content-length': '0' }, {})), 'zero length with an empty stream object');
    ok(carriesBody(stub({ 'content-length': '5' })), 'declared length');
    ok(carriesBody(stub({ 'content-length': 'abc' })), 'unparseable length is treated as a body');
    ok(carriesBody(stub({ 'transfer-encoding': 'chunked' })), 'chunked');
    ok(carriesBody(stub({ 'transfer-encoding': 'chunked', 'content-length': '0' })), 'chunked wins');
    ok(carriesBody(stub({}, {})), 'stream without headers');
    const real = new Request('https://local/x', { method: 'POST', body: 'x' });
    ok(carriesBody(real), 'constructed request with a body');
    equal(real.bodyUsed, false, 'stream untouched');
    ok(!carriesBody(new Request('https://local/x', { method: 'POST' })), 'constructed request without a body');
  }],
  ['response headers are endpoint-specific and otherwise fixed', async () => {
    equal(responseHeaders('content-type', null), { 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Expose-Headers': 'x-correlation-id', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    equal(responseHeaders('x-ingest-token', 'tauri://localhost'), { 'Access-Control-Allow-Headers': 'x-ingest-token', 'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Expose-Headers': 'x-correlation-id', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Origin': 'tauri://localhost' });
  }],
  ['staging backend check is exact', async () => {
    ok(stagingBackend(STAGING_URL), 'staging');
    for (const other of [undefined, '', 'http://ldxgejbzmpvsvozqmpfe.supabase.co', 'https://ldxgejbzmpvsvozqmpfe.supabase.co.evil.example',
      'https://rwdgnapajxcxktmewlxb.supabase.co', 'https://ldxgejbzmpvsvozqmpfe.supabase.co:444', 'https://user@ldxgejbzmpvsvozqmpfe.supabase.co',
      'https://ldxgejbzmpvsvozqmpfe.supabase.co/x', 'nonsense']) ok(!stagingBackend(other), `refuses ${other}`);
  }],
  ['origin allowlist is exact; absent Origin is a non-browser caller', async () => {
    const at = (origin?: string) => allowedOrigin(new Request('https://local/x', { method: 'POST', headers: origin === undefined ? {} : { origin } }));
    equal(at(), null);
    equal(ALLOWED_ORIGINS, ['tauri://localhost', 'http://tauri.localhost'], 'desktop webview origins only');
    for (const origin of ALLOWED_ORIGINS) equal(at(origin), origin);
    for (const origin of REJECTED_ORIGINS) {
      // The Fetch API trims header values, so the padded variants arrive unpadded; send them raw-equivalent via a stub.
      const req = { headers: { get: (name: string) => name === 'origin' ? origin : null } } as unknown as Request;
      equal(allowedOrigin(req), false, JSON.stringify(origin));
    }
  }],
  ['bounded body: object JSON only, 1 KiB ceiling, strict UTF-8', async () => {
    const body = (b: BodyInit | null) => boundedJsonObject(new Request('https://local/x', { method: 'POST', body: b }));
    equal(await body('{"a":1}'), { a: 1 });
    for (const bad of ['', 'not json', '[]', '"text"', '42', 'null', JSON.stringify({ pad: 'x'.repeat(2048) })]) equal(await body(bad), null, bad.slice(0, 12));
    equal(await body(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])), null, 'invalid UTF-8');
    equal(await boundedJsonObject(new Request('https://local/x', { method: 'POST' })), null, 'no body');
  }],
  ['diagnostics keep a code and category only, never upstream text', async () => {
    const d = diagnose({ code: '57014', message: 'secret 0123456789ABCDEF', details: 'token', hint: 'nonce' });
    equal(d, { sqlstate: '57014', category: 'statement_timeout' });
    equal(diagnose({ code: 'drop table; secret' }), { sqlstate: 'none', category: 'transport' });
    equal(diagnose(new Error('secret')), { sqlstate: 'none', category: 'transport' });
    equal(diagnose(null), { sqlstate: 'none', category: 'transport' });
  }],
];
