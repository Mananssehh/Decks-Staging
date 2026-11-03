import { assert, assertEquals } from "jsr:@std/assert@1";
import { createHandler, isStagingBackend, type ProbeRpc } from "./handler.ts";

const STAGING = "https://ldxgejbzmpvsvozqmpfe.supabase.co";
const EV = "11111111-1111-4111-8111-111111111111";
const TOK = "a".repeat(64);

function setup(reply: unknown = { ok: true }, url = STAGING) {
  const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const rpc: ProbeRpc = (action, payload) => {
    calls.push({ action, payload });
    return Promise.resolve({ data: reply, error: null });
  };
  return { calls, h: createHandler({ supabaseUrl: url, rpc }) };
}
const post = (body: unknown) =>
  new Request("http://x/", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

Deno.test("staging host check is exact", () => {
  assert(isStagingBackend(STAGING));
  for (const u of [undefined, "", "http://ldxgejbzmpvsvozqmpfe.supabase.co", "https://ldxgejbzmpvsvozqmpfe.supabase.co.evil.com",
    "https://other.supabase.co", "https://ldxgejbzmpvsvozqmpfe.supabase.co:444", "nonsense"]) {
    assert(!isStagingBackend(u), String(u));
  }
});

Deno.test("fails closed on non-staging backend without calling rpc", async () => {
  const { calls, h } = setup({ ok: true }, "https://prod.supabase.co");
  const r = await h(post({ action: "contract" }));
  assertEquals(r.status, 503);
  assertEquals((await r.json()).error, "probe_unavailable");
  assertEquals(calls.length, 0);
});

Deno.test("OPTIONS ok, GET rejected", async () => {
  const { h } = setup();
  assertEquals((await h(new Request("http://x/", { method: "OPTIONS" }))).status, 200);
  const g = await h(new Request("http://x/"));
  assertEquals(g.status, 405); await g.body?.cancel();
});

Deno.test("rejects unknown action, bad json, oversize", async () => {
  const { calls, h } = setup();
  for (const [b, s] of [[{ action: "drop" }, 400], ["{", 400], [[1], 400], ["x".repeat(9000), 413]] as const) {
    const r = await h(post(b)); assertEquals(r.status, s); await r.body?.cancel();
  }
  assertEquals(calls.length, 0);
});

Deno.test("missing/malformed token -> 401 before rpc", async () => {
  const { calls, h } = setup();
  for (const p of [{ event_id: EV }, { event_id: EV, token: "zz" }, { event_id: EV, token: 5 }]) {
    const r = await h(post({ action: "read", payload: p })); assertEquals(r.status, 401); await r.body?.cancel();
  }
  assertEquals(calls.length, 0);
});

Deno.test("only allowlisted fields are forwarded", async () => {
  const { calls, h } = setup();
  const r = await h(post({ action: "vote", payload: { event_id: EV, token: TOK, request_id: EV, value: 1, user_id: "x", role: "service_role" } }));
  assertEquals(r.status, 200); await r.body?.cancel();
  assertEquals(calls[0].payload, { event_id: EV, token: TOK, request_id: EV, value: 1 });
});

Deno.test("vote value and request bounds validated", async () => {
  const { calls, h } = setup();
  const bad = [
    { action: "vote", payload: { event_id: EV, token: TOK, request_id: EV, value: "1" } },
    { action: "vote", payload: { event_id: EV, token: TOK, request_id: EV, value: 2 } },
    { action: "request", payload: { event_id: EV, token: TOK, idempotency_key: "nope", title: "t" } },
    { action: "request", payload: { event_id: EV, token: TOK, idempotency_key: EV, title: "t".repeat(121) } },
    { action: "join", payload: { event_id: EV, code: "c", nickname: "n".repeat(41) } },
  ];
  for (const b of bad) { const r = await h(post(b)); assertEquals(r.status, 400); await r.body?.cancel(); }
  assertEquals(calls.length, 0);
});

Deno.test("typed DB errors pass through (429), unknown status -> 500", async () => {
  let r = await setup({ ok: false, status: 429, error: "guest_rate_limited" }).h(post({ action: "read", payload: { event_id: EV, token: TOK } }));
  assertEquals(r.status, 429); assertEquals((await r.json()).error, "guest_rate_limited");
  r = await setup({ ok: false, status: 42, error: "x" }).h(post({ action: "read", payload: { event_id: EV, token: TOK } }));
  assertEquals(r.status, 500); await r.body?.cancel();
});

Deno.test("rpc transport error -> 503, no internals leaked", async () => {
  const h = createHandler({ supabaseUrl: STAGING, rpc: () => Promise.resolve({ data: null, error: { message: "secret detail" } }) });
  const r = await h(post({ action: "contract" }));
  assertEquals(r.status, 503);
  assert(!(await r.text()).includes("secret"));
});

Deno.test("handler makes zero network calls (no Auth/signup) across a full flow", async () => {
  const orig = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => { fetches++; return Promise.reject(new Error("blocked")); }) as typeof fetch;
  try {
    const { calls, h } = setup({ ok: true });
    const flow = [
      { action: "join", payload: { event_id: EV, code: "c", nickname: "n" } },
      { action: "join", payload: { event_id: EV, token: TOK } },
      { action: "request", payload: { event_id: EV, token: TOK, idempotency_key: EV, title: "t" } },
      { action: "read", payload: { event_id: EV, token: TOK } },
      { action: "vote", payload: { event_id: EV, token: TOK, request_id: EV, value: 0 } },
    ];
    for (const b of flow) { const r = await h(post(b)); assertEquals(r.status, 200); await r.body?.cancel(); }
    assertEquals(calls.map((c) => c.action), ["join", "join", "request", "read", "vote"]);
    assertEquals(fetches, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("streamed oversized body without Content-Length is cut off and cancelled", async () => {
  const { calls, h } = setup();
  let pulled = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { pulled++; c.enqueue(new Uint8Array(1024).fill(32)); }, // endless
    cancel() { cancelled = true; },
  });
  const req = new Request("http://x/", { method: "POST", body: stream });
  assertEquals(req.headers.get("content-length"), null);
  const r = await h(req);
  assertEquals(r.status, 413); await r.body?.cancel();
  assert(cancelled, "stream cancelled");
  assert(pulled <= 10, `read ${pulled} chunks`);
  assertEquals(calls.length, 0);
});

Deno.test("oversized declared Content-Length rejected fast; invalid UTF-8 -> 400", async () => {
  const { calls, h } = setup();
  let r = await h(new Request("http://x/", { method: "POST", body: "{}", headers: { "content-length": "999999" } }));
  assertEquals(r.status, 413); await r.body?.cancel();
  r = await h(new Request("http://x/", { method: "POST", body: new Uint8Array([0x7b, 0xff, 0x7d]) }));
  assertEquals(r.status, 400); await r.body?.cancel();
  assertEquals(calls.length, 0);
});

Deno.test("8KB total allowed but inner body over 4KB bytes rejected", async () => {
  const { calls, h } = setup();
  const p = { event_id: EV, token: TOK, idempotency_key: EV, title: "t" };
  let r = await h(post({ action: "request", payload: { ...p, body: "é".repeat(2049) } })); // 4098 bytes
  assertEquals(r.status, 400); assertEquals((await r.json()).error, "invalid_body");
  r = await h(post({ action: "request", payload: { ...p, body: "b".repeat(4096) } }));
  assertEquals(r.status, 200); await r.body?.cancel();
  assertEquals(calls.length, 1);
});
