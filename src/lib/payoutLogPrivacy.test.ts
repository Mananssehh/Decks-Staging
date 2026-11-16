import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("payout onboarding log privacy", () => {
  const source = readFileSync("supabase/functions/stripe-connect-onboard/index.ts", "utf8");
  it("logs only fixed messages and controlled stage/error codes", () => {
    const calls = source.match(/console\.(?:log|warn|error)\([^;]*\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/^console\.(?:log|warn|error)\("[^"\n]*"(?:, (?:step|code))?\);$/);
    }
  });
  it("still supplies the verified email to account creation without logging it", () => {
    expect(source).toContain("claims.claims.email");
    expect(source).toMatch(/accounts\.create\(\{\s*type: "express",\s*email,/);
  });
});