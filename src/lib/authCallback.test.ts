import { describe, it, expect, vi } from "vitest";
import { completeCallback, localNext } from "./authCallback";
describe("OAuth callback boundary", () => {
  it("exchanges only the decoded PKCE code, not the callback URL", async () => {
    const exchange = vi.fn().mockResolvedValue({ error: null });
    expect(await completeCallback("https://app.invalid/auth/callback?code=abc%2B123&next=%2Fevent%2FROOM", exchange, async () => true)).toBe("/event/ROOM");
    expect(exchange).toHaveBeenCalledWith("abc+123");
  });
  it.each(["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/\nevil", "javascript:alert(1)"])("rejects non-local redirect %s", raw => expect(localNext(raw)).toBe("/"));
  it("keeps local query and hash", () => expect(localNext("/dj?tab=queue#next")).toBe("/dj?tab=queue#next"));
  it("does not finish without a verified account", async () => expect(completeCallback("https://app.invalid/auth/callback", vi.fn(), async () => false)).rejects.toThrow('No verified account'));
  it("propagates exchange errors", async () => expect(completeCallback("https://app.invalid/?code=bad", async () => ({error:{message:"Invalid code"}}), async () => true)).rejects.toThrow("Invalid code"));
  it.each(['?error=access_denied','#error=access_denied&error_description=private'])('rejects confirmation errors before exchange or verification %s',async(suffix)=>{
    const exchange=vi.fn(),verify=vi.fn();await expect(completeCallback('https://app.invalid/auth/callback'+suffix,exchange,verify)).rejects.toThrow('invalid or expired');expect(exchange).not.toHaveBeenCalled();expect(verify).not.toHaveBeenCalled();
  });
});