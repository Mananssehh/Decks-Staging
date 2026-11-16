import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ insert: vi.fn(), getUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: m.getUser }, from: () => ({ insert: m.insert }) },
}));
import { installGlobalErrorHandlers, logError, scrubContext, scrubText } from "./errorLogger";

const SECRET = "SECRET-auth-code-123";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTRUNSRVQifQ.c2lnbmF0dXJlU0VDUkVU";
const stored = () => JSON.stringify(m.insert.mock.calls);
// logError dedupes identical severity|source|message for 5s; keep table rows distinct.
let unique = 0;

beforeEach(() => {
  m.insert.mockReset().mockResolvedValue({ error: null });
  m.getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
  window.history.replaceState({}, "", "/");
});

describe("errorLogger scrubbing", () => {
  it("stores only the pathname for /auth/callback?code=SECRET", async () => {
    window.history.replaceState({}, "", `/auth/callback?code=${SECRET}&next=%2Fdj#access_token=${SECRET}`);
    await logError({ severity: "critical", source: "t1", message: "callback failed" });
    expect(m.insert).toHaveBeenCalledTimes(1);
    expect(m.insert.mock.calls[0][0].route).toBe("/auth/callback");
    expect(stored()).not.toContain("SECRET");
    expect(stored()).not.toContain("next=");
  });

  it("never stores codes or tokens passed through message, stack or context", async () => {
    window.history.replaceState({}, "", `/auth/callback?code=${SECRET}`);
    await logError({
      severity: "critical",
      source: "t2",
      message: `Failed to fetch https://x.supabase.co/auth/v1/verify?token_hash=${SECRET}&type=signup code=${SECRET} Bearer ${SECRET} ${JWT}`,
      stack: `Error: boom\n    at run (https://app.example/auth/callback?code=${SECRET}#access_token=${SECRET}:1:2)\n    refresh_token: "${SECRET}"`,
      context: {
        filename: `https://app.example/auth/callback?code=${SECRET}`,
        code: SECRET,
        access_token: SECRET,
        nested: { href: `/auth/callback#access_token=${SECRET}&refresh_token=${SECRET}`, password: SECRET, list: [`token=${SECRET}`] },
        lineno: 12,
      },
    });
    const row = m.insert.mock.calls[0][0];
    expect(stored()).not.toContain("SECRET");
    expect(stored()).not.toContain("eyJ");
    expect(row.route).toBe("/auth/callback");
    expect(row.context.lineno).toBe(12);
    expect(row.context.filename).toBe("https://app.example/auth/callback");
    expect(row.message).toContain("Failed to fetch https://x.supabase.co/auth/v1/verify");
    expect(row.stack).toContain("Error: boom");
  });

  it("keeps database error codes and ordinary diagnostics", () => {
    expect(scrubContext({ code: "42501", count: 1, djId: "abc" })).toEqual({ code: "42501", count: 1, djId: "abc" });
    expect(scrubContext({ code: "PGRST301" })).toEqual({ code: "PGRST301" });
    expect(scrubContext({ code: null })).toEqual({ code: null });
    expect(scrubText("Is this broken? Yes #1")).toBe("Is this broken? Yes #1");
    expect(scrubText("update_my_profile failed")).toBe("update_my_profile failed");
  });

  it("global handlers scrub window errors and rejections from a callback URL", async () => {
    window.history.replaceState({}, "", `/auth/callback?code=${SECRET}`);
    installGlobalErrorHandlers();
    window.dispatchEvent(new ErrorEvent("error", { message: `bad code=${SECRET}`, filename: `${window.location.href}`, lineno: 1, colno: 2 }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error(`exchange failed for ?code=${SECRET}`);
    window.dispatchEvent(rejection);
    await vi.waitFor(() => expect(m.insert).toHaveBeenCalledTimes(2));
    expect(stored()).not.toContain("SECRET");
    for (const [row] of m.insert.mock.calls) expect(row.route).toBe("/auth/callback");
  });

  const BASIC = "QWxhZGRpbjpvcGVuIHNlc2FtZQ==";
  // [input, secret values that must not survive]
  const LEAKS: [string, string[]][] = [
    ["otp=123456", ["123456"]],
    ["otp: 123456", ["123456"]],
    ["bootstrap: abcdef", ["abcdef"]],
    [`authorization: Basic ${BASIC}`, [BASIC, "QWxh"]],
    ["cookie=session=abc", ["abc", "session=abc"]],
    ["code: SECRET", ["SECRET"]],
    ["verifier=abc", ["abc"]],
    ["challenge: abc", ["abc"]],
    ["credential=abc", ["abc"]],
    ["https://x.test/callback?code%3DSECRET", ["SECRET"]],
    ["https://x.test/callback?code%253DSECRET%26state%3DSTATEVAL", ["SECRET", "STATEVAL"]],
    ["https://x.test/cb#access_token=SECRET&refresh_token=OTHER", ["SECRET", "OTHER"]],
    ["token=SECRET", ["SECRET"]],
    ["secret: SECRET", ["SECRET"]],
    ["password=hunter2", ["hunter2"]],
    ["passwd: hunter2", ["hunter2"]],
    ["apikey=SECRET", ["SECRET"]],
    ["api_key: SECRET", ["SECRET"]],
    ["signature=SECRET", ["SECRET"]],
    ["access_token=SECRET", ["SECRET"]],
    ["refresh_token: SECRET", ["SECRET"]],
    ["token_hash=SECRET", ["SECRET"]],
    ["code_verifier=SECRET", ["SECRET"]],
    ["OTP=123456", ["123456"]],
    ["Otp: 123456", ["123456"]],
    ["PASSWORD: hunter2", ["hunter2"]],
    ["Access_Token=SECRET", ["SECRET"]],
    ["refreshToken: SECRET", ["SECRET"]],
    ["CODE=SECRET", ["SECRET"]],
    ["Authorization: Bearer SECRETVALUE123", ["SECRETVALUE123"]],
    [`AUTHORIZATION: Basic ${BASIC}`, [BASIC]],
    ["Cookie: sb-access=SECRET; other=VALUE2", ["SECRET", "VALUE2"]],
    ['password="hunter2 with spaces"', ["hunter2", "with spaces"]],
    ["token: 'SECRET value'", ["SECRET", "value"]],
    ['{"access_token":"SECRET","code":"OTHERSECRET"}', ["SECRET", "OTHERSECRET"]],
    ['{"authorization":"Bearer SECRETVALUE123"}', ["SECRETVALUE123"]],
    ["sent Bearer SECRETVALUE123 upstream", ["SECRETVALUE123"]],
    [`sent Basic ${BASIC} upstream`, [BASIC]],
    [`jwt ${JWT} rejected`, ["eyJ", "c2lnbmF0dXJlU0VDUkVU"]],
    // Revision 3: multi-word values, encoded spaces, short bearer/basic values and api-key.
    ["password: two words", ["two", "words"]],
    ["access_token=first second", ["first", "second"]],
    ["code%3DSECRET%2520SECOND", ["SECRET", "SECOND"]],
    ["https://x.test/callback?code%3DSECRET%2520SECOND", ["SECRET", "SECOND"]],
    ["https://x.test/callback%3Fcode%3DSECRET%20SECOND", ["SECRET", "SECOND"]],
    ["code%25252525253DSECRET", ["SECRET"]],
    ["sent Bearer abc upstream", ["abc"]],
    ["sent Basic xyz upstream", ["xyz"]],
    ["api-key=SECRET", ["SECRET"]],
    ["API-Key: SECRET", ["SECRET"]],
    ["x-api-key: SECRET", ["SECRET"]],
    ["otp: 12 34 56", ["12", "34", "56"]],
    ["cookie: a=ONE; b=TWO three", ["ONE", "TWO", "three"]],
    ["secret = spaced value here", ["spaced", "value here"]],
    ["token:\tTABBED VALUE", ["TABBED", "VALUE"]],
    // Revision 4: quoted Bearer/Basic values and percent-encoded sensitive key names.
    ['sent Bearer "abc" upstream', ["abc"]],
    ["sent Bearer 'abc' upstream", ["abc"]],
    ['sent Basic "xyz" upstream', ["xyz"]],
    ["sent Basic 'xyz' upstream", ["xyz"]],
    ['sent Bearer "abc def" upstream', ["abc", "def"]],
    ["sent Basic 'xyz value' upstream", ["xyz", "value"]],
    ['BEARER "abc def', ["abc", "def"]],
    ["api%2Dkey%3DSECRET", ["SECRET"]],
    ["api%5Fkey%3DSECRET", ["SECRET"]],
    ["pass%77ord%3DSECRET", ["SECRET"]],
    ["api%2dkey%3dSECRET", ["SECRET"]],
    ["api%252Dkey%253DSECRET", ["SECRET"]],
    ["pass%2577ord%253DSECRET%2520SECOND", ["SECRET", "SECOND"]],
    ["%70%61%73%73%77%6F%72%64%3DSECRET", ["SECRET"]],
    ["%61ccess%5Ftoken%3Dfirst%20second", ["first", "second"]],
    ["https://x.test/cb%3F%63ode%3DSECRET%20SECOND", ["SECRET", "SECOND"]],
    ["%42earer%20%22abc%20def%22", ["abc", "def"]],
    ["c%6Fde%3A%20SECRET", ["SECRET"]],
  ];

  it.each(LEAKS)("free text redacts %s", (input, secrets) => {
    const out = scrubText(input);
    for (const secret of secrets) expect(out).not.toContain(secret);
    // Query strings and fragments are removed outright; every other form leaves a marker.
    if (!/[?#]|%3f|%23/i.test(input)) expect(out).toContain("[redacted]");
  });

  it.each(LEAKS)("stored payload never contains the secret for %s", async (input, secrets) => {
    await logError({
      severity: "critical",
      source: `leak:${input}`,
      message: `failed: ${input}`,
      stack: `Error: ${input}\n    at run (app.js:1:2)`,
      context: { detail: input, nested: { deep: [input, { again: input }] } },
    });
    expect(m.insert).toHaveBeenCalledTimes(1);
    for (const secret of secrets) expect(stored()).not.toContain(secret);
    expect(m.insert.mock.calls[0][0].stack).toContain("at run (app.js:1:2)");
  });

  it("structured context uses the same sensitive names, nested and in arrays", () => {
    const names = ["token", "secret", "password", "passwd", "authorization", "cookie", "apikey", "api_key", "signature", "bootstrap", "otp", "verifier", "challenge", "credential", "code",
      "access_token", "refresh_token", "token_hash", "OTP", "Authorization", "refreshToken", "CODE", "auth_code"];
    const flat = Object.fromEntries(names.map((n) => [n, "SECRET"]));
    const out = scrubContext({ ...flat, nested: { ...flat, list: [{ ...flat }, "otp: SECRET", `Bearer SECRETVALUE123`] }, eventId: "evt-1", count: 3 }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("SECRET");
    for (const n of names) expect(out[n]).toBe("[redacted]");
    expect(out.eventId).toBe("evt-1");
    expect(out.count).toBe(3);
  });

  const KEPT_CODES = ["42501", "23505", "PGRST301", "22023", "57014", "P0001"];
  it.each(KEPT_CODES)("structured { code: %s } is preserved (allowlisted database code)", async (code) => {
    expect(scrubContext({ code })).toEqual({ code });
    expect(scrubContext({ nested: [{ code }] })).toEqual({ nested: [{ code }] });
    await logError({ severity: "warning", source: `kept-${++unique}`, message: "rpc failed", context: { code, nested: { code } } });
    expect(m.insert.mock.calls[0][0].context).toEqual({ code, nested: { code } });
  });

  // [context, values that must not survive]
  const STRUCTURED_REDACTED: [Record<string, unknown>, string[]][] = [
    [{ code: "12345" }, ["12345"]],
    [{ code: "ABCDE" }, ["ABCDE"]],
    [{ auth_code: "ABCDE" }, ["ABCDE"]],
    [{ auth_code: "42501" }, ["42501"]],
    [{ authCode: "23505" }, ["23505"]],
    [{ Code: "42501" }, ["42501"]],
    [{ CODE: "PGRST301" }, ["PGRST301"]],
    [{ error_code: "42501" }, ["42501"]],
    [{ token_code: "42501" }, ["42501"]],
    [{ otp: "42501" }, ["42501"]],
    [{ code: 12345 }, ["12345"]],
    [{ code: "SECRET-auth-code" }, ["SECRET"]],
    [{ code: "42501 extra" }, ["extra"]],
    [{ code: ["42501x"] }, ["42501x"]],
    [{ "api-key": "SECRET" }, ["SECRET"]],
    [{ "X-Api-Key": "SECRET" }, ["SECRET"]],
  ];
  it.each(STRUCTURED_REDACTED)("structured %j is redacted", async (context, secrets) => {
    const key = Object.keys(context)[0];
    expect(scrubContext(context)).toEqual({ [key]: "[redacted]" });
    expect(scrubContext({ nested: [context] })).toEqual({ nested: [{ [key]: "[redacted]" }] });
    await logError({ severity: "warning", source: `structured-${++unique}`, message: "rpc failed", context: { ...context, nested: { list: [context] } } });
    expect(m.insert).toHaveBeenCalledTimes(1);
    const row = JSON.stringify(m.insert.mock.calls[0][0].context);
    for (const secret of secrets) expect(row).not.toContain(secret);
  });

  const MALFORMED = ["%", "100% done", "%ZZ", "%G1%1", "%E0%A4%A", "%FF%FE%80", "%C3%28", "tail %", "%2", "%%%", "%25%", "%2525ZZ", "ok %E2%82%AC ok", "x".repeat(30000) + "%", "%25".repeat(5000) + "3DSECRET"];
  it.each(MALFORMED)("malformed or non-UTF-8 percent sequences never throw: %s", async (input) => {
    expect(() => scrubText(input)).not.toThrow();
    const once = scrubText(input);
    expect(typeof once).toBe("string");
    expect(scrubText(once)).toBe(once);
    expect(() => scrubContext({ detail: input, list: [input] })).not.toThrow();
    await logError({ severity: "warning", source: `malformed-${++unique}`, message: input, stack: input, context: { detail: input } });
    expect(m.insert).toHaveBeenCalledTimes(1);
  });

  it("malformed sequences next to a real secret still redact the secret", () => {
    for (const input of ["%ZZ pass%77ord%3DSECRET", "% api%2Dkey%3DSECRET %", "%FF%FE token%3DSECRET%", 'Bearer "SECRET %ZZ"']) {
      expect(scrubText(input)).not.toContain("SECRET");
    }
  });

  const PATHOLOGICAL: [string, string][] = [
    ["long word run", "x".repeat(30000)],
    ["question marks", "?".repeat(20000)],
    ["hashes then assignment", "#".repeat(19990) + "code=SECRET"],
    ["deeply nested percent", "code%" + "25".repeat(9000) + "3DSECRET"],
    ["deeply nested key letter", "pass%" + "25".repeat(9000) + "77ord=SECRET"],
    ["staggered percent chain", "%".repeat(6000) + "32".repeat(6000)],
    ["many sensitive words", "code token secret ".repeat(1100)],
    ["many keys one line", "password ".repeat(2000) + "password=SECRET"],
    ["bearer run", "Bearer ".repeat(2800)],
    ["jwt prefix run", "eyJ".repeat(6600)],
  ];
  it.each(PATHOLOGICAL)("bounded work on adversarial input: %s", (_name, input) => {
    const started = performance.now();
    const once = scrubText(input);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(once).not.toContain("SECRET");
    expect(scrubText(once)).toBe(once);
  });

  it("deterministic fuzz: never throws, always idempotent, no doubled markers", () => {
    const pieces = ["password", "pass%77ord", "api%2Dkey", "api-key", "code", "token", "Bearer", "Basic", "%", "%25", "%2", "%3D", "%3A", "%20", "%22", "%27", "%0A", "%ZZ", "%FF",
      "=", ":", " ", "\t", "\n", '"', "'", "?", "#", "&", "abc", "two words", "x.tsx:1:2)", "eyJhbGciOi.eyJzdWIi.c2ln", "https://x.test/cb", "(", ")", "32", "5", "7"];
    let seed = 20261116;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 4000; i++) {
      let input = "";
      for (let n = 1 + Math.floor(next() * 12); n > 0; n--) input += pieces[Math.floor(next() * pieces.length)];
      let once = "";
      expect(() => { once = scrubText(input); }).not.toThrow();
      expect(scrubText(once), `input: ${JSON.stringify(input)}`).toBe(once);
      expect(once, `input: ${JSON.stringify(input)}`).not.toMatch(/\[redacted\]\]|\[\[redacted\]|\[redacted\]\[redacted\]/);
    }
  });

  it("scrubbing is idempotent and never doubles markers", () => {
    const stack = "TypeError: x\n    at ResetPassword (https://app.example/src/pages/ResetPassword.tsx:57:11)\n    password: two words\n    at run (app.js:1:2)";
    for (const input of [...LEAKS.map(([text]) => text), stack, "Is this broken? Yes #1", `failed: password: two words and ${JWT}`]) {
      const once = scrubText(input);
      expect(scrubText(once)).toBe(once);
      expect(scrubText(scrubText(once))).toBe(once);
      expect(once).not.toMatch(/\[redacted\]\]|\[\[redacted\]|\[redacted\]\[redacted\]/);
    }
    const context = { detail: "access_token=first second", nested: { code: "42501", auth_code: "42501", list: ["sent Bearer abc upstream"] } };
    const once = scrubContext(context);
    expect(scrubContext(once)).toEqual(once);
  });

  it("stack locations survive next to redacted multi-word values, in the stored row too", async () => {
    const stack = "Error: password: two words\n    at ResetPassword (https://app.example/src/pages/ResetPassword.tsx:57:11)\n    at tokenize (https://app.example/assets/token-abc.js:1:2345)\n    at authCallback.ts:12:3";
    const out = scrubText(stack);
    for (const kept of ["ResetPassword.tsx:57:11)", "token-abc.js:1:2345)", "at authCallback.ts:12:3"]) expect(out).toContain(kept);
    expect(out).not.toContain("words");
    await logError({ severity: "critical", source: "stack-structure", message: "boom", stack });
    const row = m.insert.mock.calls[0][0];
    expect(row.stack).toContain("ResetPassword.tsx:57:11)");
    expect(row.stack).not.toContain("two");
    expect(row.stack).not.toContain("words");
  });

  it("ordinary text and stack structure stay readable", () => {
    for (const text of ["Is this broken? Yes #1", "update_my_profile failed", "Cannot read properties of undefined (reading 'map')", "Request took 1200ms: retrying 2 of 3", "Event not found"]) {
      expect(scrubText(text)).toBe(text);
    }
    const stack = "TypeError: x is not a function\n    at ResetPassword (https://app.example/src/pages/ResetPassword.tsx:57:11)\n    at tokenize (https://app.example/assets/index-abc.js:1:2345)\n    at authCallback.ts:12:3";
    expect(scrubText(stack)).toBe(stack);
  });

  it("existing size and depth limits still apply", () => {
    const deep = scrubContext({ a: { b: { c: { d: { e: "too deep" } } } } }) as { a: { b: { c: { d: unknown } } } };
    expect(deep.a.b.c.d).toBeNull();
    expect((scrubContext(Array.from({ length: 50 }, (_, i) => i)) as unknown[]).length).toBe(20);
    expect(Object.keys(scrubContext(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]))) as object).length).toBe(40);
    expect((scrubContext("x".repeat(5000)) as string).length).toBe(2000);
  });

  it("signed-out visitors store nothing", async () => {
    m.getUser.mockResolvedValue({ data: { user: null } });
    await logError({ severity: "warning", source: "t5", message: `x?code=${SECRET}` });
    expect(m.insert).not.toHaveBeenCalled();
  });
});
