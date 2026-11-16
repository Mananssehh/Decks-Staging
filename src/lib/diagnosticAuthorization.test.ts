import { describe, expect, it, vi } from "vitest";
import { authorizeDiagnostic } from "../../supabase/functions/stripe-whoami/authorization";

describe("operator-only provider diagnostic", () => {
  const req = (header?: string) => new Request("https://local?account=acct_other", { headers: header ? { authorization: header } : {} });
  it("does no auth/provider work for unsigned requests", async () => {
    const verify = vi.fn(), role = vi.fn();
    expect(await authorizeDiagnostic(req(), verify, role)).toBe(401);
    expect(verify).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled();
  });
  it("rejects invalid sessions before role lookup", async () => {
    const role = vi.fn();
    expect(await authorizeDiagnostic(req("Bearer invalid"), async () => null, role)).toBe(401);
    expect(role).not.toHaveBeenCalled();
  });
  it("rejects non-admins even with a valid session", async () => {
    expect(await authorizeDiagnostic(req("Bearer test"), async () => "verified-id", async () => false)).toBe(403);
  });
  it("permits only the server-verified admin", async () => {
    const role = vi.fn(async () => true);
    expect(await authorizeDiagnostic(req("Bearer test"), async () => "verified-id", role)).toBeNull();
    expect(role).toHaveBeenCalledWith("verified-id");
  });
  it("fails closed when auth or role lookup fails", async () => {
    expect(await authorizeDiagnostic(req("Bearer test"), async () => { throw Error("private"); }, async () => true)).toBe(503);
    expect(await authorizeDiagnostic(req("Bearer test"), async () => "verified-id", async () => { throw Error("private"); })).toBe(503);
  });
});