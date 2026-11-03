// STAGING-ONLY guest-token probe handler. No network here: the RPC is injected.
// Authorization is the custom event-scoped guest token checked inside the DB;
// this handler never calls Supabase Auth and never logs tokens/codes/keys.

export const PROBE_CONTRACT = "guest-token-probe-v1";
export const STAGING_HOST = "ldxgejbzmpvsvozqmpfe.supabase.co";
const ACTIONS = ["contract", "join", "request", "read", "vote"] as const;
type Action = typeof ACTIONS[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 8192;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type ProbeRpc = (action: Action, payload: Record<string, unknown>) =>
  Promise<{ data: unknown; error: unknown }>;

export interface ProbeDeps {
  supabaseUrl: string | undefined;
  rpc: ProbeRpc | null;
}

export function isStagingBackend(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === STAGING_HOST && u.port === "";
  } catch {
    return false;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const fail = (status: number, error: string) => json(status, { ok: false, status, error });

const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max ? v : null;

/** Returns sanitized payload or an error code. Only allowlisted fields pass through. */
export function validate(action: Action, b: Record<string, unknown>): Record<string, unknown> | string {
  if (action === "contract") return {};
  const event_id = str(b.event_id, 36);
  if (!event_id || !UUID.test(event_id)) return "invalid_event_id";
  const out: Record<string, unknown> = { event_id };
  if (b.token !== undefined) {
    const t = str(b.token, 64);
    if (!t || !TOKEN.test(t)) return "invalid_session";
    out.token = t;
  } else if (action !== "join") {
    return "invalid_session";
  }
  if (action === "join" && out.token === undefined) {
    const code = str(b.code, 64), nickname = str(b.nickname, 40);
    if (!code) return "invalid_event_or_code";
    if (!nickname || !nickname.trim()) return "invalid_nickname";
    out.code = code;
    out.nickname = nickname;
  }
  if (action === "request") {
    const k = str(b.idempotency_key, 36), title = str(b.title, 120);
    if (!k || !UUID.test(k)) return "invalid_idempotency_key";
    if (!title || !title.trim()) return "invalid_title";
    const body = b.body === undefined ? "" : str(b.body, 4096);
    if (body === null || new TextEncoder().encode(body).length > 4096) return "invalid_body";
    Object.assign(out, { idempotency_key: k, title, body });
  }
  if (action === "vote") {
    const r = str(b.request_id, 36);
    if (!r || !UUID.test(r)) return "invalid_request_id";
    if (b.value !== -1 && b.value !== 0 && b.value !== 1) return "invalid_vote_value";
    Object.assign(out, { request_id: r, value: b.value });
  }
  return out;
}

/** Streams at most `limit` bytes (Content-Length is not trusted); cancels the stream on overflow. */
export async function readBounded(req: Request, limit: number): Promise<string | "too_large" | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function createHandler(deps: ProbeDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!isStagingBackend(deps.supabaseUrl) || !deps.rpc) return fail(503, "probe_unavailable");
    if (req.method !== "POST") return fail(405, "method_not_allowed");
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      await req.body?.cancel().catch(() => {});
      return fail(413, "payload_too_large");
    }
    const read = await readBounded(req, MAX_BODY_BYTES);
    if (read === "too_large") return fail(413, "payload_too_large");
    if (read === null) return fail(400, "invalid_json");
    let body: unknown;
    try { body = JSON.parse(read); } catch { return fail(400, "invalid_json"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "invalid_json");
    const b = body as Record<string, unknown>;
    const action = b.action;
    if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
      return fail(400, "invalid_action");
    }
    const payload = validate(action as Action, (b.payload ?? {}) as Record<string, unknown>);
    if (typeof payload === "string") {
      return fail(payload === "invalid_session" ? 401 : 400, payload);
    }
    let res: { data: unknown; error: unknown };
    try {
      res = await deps.rpc(action as Action, payload);
    } catch {
      return fail(503, "upstream_unavailable");
    }
    if (res.error || !res.data || typeof res.data !== "object") return fail(503, "upstream_unavailable");
    const d = res.data as Record<string, unknown>;
    if (d.ok === true) return json(200, d);
    const status = typeof d.status === "number" && d.status >= 400 && d.status <= 599 ? d.status : 500;
    const error = typeof d.error === "string" ? d.error : "internal";
    return fail(status, error);
  };
}
