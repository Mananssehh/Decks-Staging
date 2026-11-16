// DECKS Bridge Pairing Protocol v2 — shared, SDK-free helpers for bridge-pair and bridge-revoke.
// Contract: docs/BRIDGE_PAIRING_PROTOCOL_V2.md. Nothing here logs, and nothing here may ever be
// given a pairing code, client nonce, ingest token or authorization value to log.
export const PROTOCOL_VERSION = 2;
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const ASCII_CODE_INPUT = /^[0-9A-Za-z -]+$/;
const MAX_CODE_INPUT = 64;
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
// Pairing issues exactly 64 lowercase hex characters. Revocation also accepts the legacy 48.
// The revocation rule is duplicated, character for character, in public.bridge_revoke_v2.
const ISSUED_TOKEN = /^[0-9a-f]{64}$/;
const REVOCABLE_TOKEN = /^(?:[0-9a-f]{48}|[0-9a-f]{64})$/;
const JSON_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGING_HOST = 'ldxgejbzmpvsvozqmpfe.supabase.co';
export const MAX_BODY_BYTES = 1024;

/**
 * Canonical form: uppercase, spaces and hyphens removed, O→0 and I/L→1, exactly 16 symbols of
 * the Crockford alphabet. Input must be ASCII before case-folding, so no Unicode character can
 * fold or alias into a valid symbol. Returns null for anything else.
 */
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_CODE_INPUT) return null;
  if (!ASCII_CODE_INPUT.test(input)) return null;
  const canonical = input.replace(/[ -]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  return CANONICAL_CODE.test(canonical) ? canonical : null;
}

/** Display form XXXX-XXXX-XXXX-XXXX for an already canonical code. */
export function groupPairingCode(canonical: string): string {
  return `${canonical.slice(0, 4)}-${canonical.slice(4, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}`;
}

/** 128-bit random value as base64url (22 chars) or hex (32 chars); up to 64 URL-safe characters. */
export function validClientNonce(input: unknown): input is string {
  return typeof input === 'string' && NONCE.test(input);
}

/** A token in a pairing success: exactly 64 lowercase hexadecimal characters. */
export function validIssuedToken(input: unknown): input is string {
  return typeof input === 'string' && ISSUED_TOKEN.test(input);
}

/** A token presented for revocation: exactly 48 (legacy) or 64 (v2) lowercase hexadecimal characters. */
export function validRevocableToken(input: unknown): input is string {
  return typeof input === 'string' && REVOCABLE_TOKEN.test(input);
}

/** `application/json`, optionally with a UTF-8 charset parameter. Nothing else. */
export function jsonMediaType(req: Request): boolean {
  const value = req.headers.get('content-type');
  return value !== null && JSON_MEDIA_TYPE.test(value.trim());
}

/** True when the request URL carries any query component, even an empty one. */
export function hasQuery(req: Request): boolean {
  return req.url.includes('?');
}

/**
 * True when the request declares or carries a body. Real HTTP requests signal a body with
 * Content-Length or Transfer-Encoding; a constructed Request with a body has neither header
 * but a non-null stream. The stream is never read.
 */
export function carriesBody(req: Request): boolean {
  const length = req.headers.get('content-length');
  if (req.headers.has('transfer-encoding')) return true;
  if (length !== null) return length.trim() !== '0';
  return req.body !== null;
}

export function validUuid(input: unknown): input is string {
  return typeof input === 'string' && UUID.test(input);
}

/** Exact staging backend only: these functions refuse to run against any other project. */
export function stagingBackend(url?: string): boolean {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'https:' && u.hostname === STAGING_HOST && !u.port && !u.username && !u.password && u.pathname === '/';
  } catch {
    return false;
  }
}

// Exact, case-sensitive origins only: no wildcard, suffix, subdomain, scheme, port or substring
// matching. Only the desktop claims and revokes, so only the two fixed origins of a packaged
// Tauri webview are listed; a native (non-webview) desktop client sends no Origin header and is
// accepted too. No website origin is listed: the web app generates codes but never calls these
// endpoints. CORS is not the authorization boundary — the pairing secret or ingest token is.
export const ALLOWED_ORIGINS: readonly string[] = [
  'tauri://localhost',
  'http://tauri.localhost',
];

/** null = no Origin header (non-browser caller, no CORS grant); false = origin outside the allowlist. */
export function allowedOrigin(req: Request): string | null | false {
  const origin = req.headers.get('origin');
  if (origin === null) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : false;
}

export type HeaderMap = Record<string, string>;
/**
 * Response headers for one endpoint. `allowHeaders` is that endpoint's exact request-header
 * allowance: bridge-pair allows only `content-type`, bridge-revoke only `x-ingest-token`.
 */
export function responseHeaders(allowHeaders: string, origin: string | null): HeaderMap {
  const headers: HeaderMap = {
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Expose-Headers': 'x-correlation-id',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Bounded JSON object body. Null for oversized, malformed, non-UTF-8 or non-object input. */
export async function boundedJsonObject(req: Request, limit = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(part.value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Allowlisted diagnostics: a SQLSTATE/PostgREST code and a coarse category. Never a message,
// detail, hint, payload or response body — upstream error text can echo arguments.
export type LogEntry = Record<string, string | number>;
export type Log = (entry: LogEntry) => void;
const SQLSTATE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;
export function diagnose(error: unknown): { sqlstate: string; category: string } {
  const raw = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const sqlstate = typeof raw === 'string' && SQLSTATE.test(raw) ? raw : 'none';
  const category = sqlstate === 'none' ? 'transport'
    : sqlstate === '57014' ? 'statement_timeout'
    : sqlstate === '55P03' ? 'lock_timeout'
    : sqlstate === '42501' ? 'permission'
    : sqlstate.startsWith('08') ? 'connection'
    : 'sql_error';
  return { sqlstate, category };
}
export const defaultLog: Log = (entry) => console.error(JSON.stringify(entry));
