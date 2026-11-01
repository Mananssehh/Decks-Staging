import { equal, throws } from "node:assert/strict";
import { parseStripeKey, requireStripeKey } from "./stripe-key.ts";

for (const [prefix, mode] of [["sk_test_", "test"], ["sk_live_", "live"], ["rk_test_", "test"], ["rk_live_", "live"]] as const) {
  Deno.test(`Stripe key validates ${prefix} and trims surrounding whitespace`, () => {
    const fake = `${prefix}Fixture123`;
    equal(parseStripeKey(fake)?.mode, mode);
    equal(requireStripeKey(` \t${fake}\r\n`).key, fake);
    equal(requireStripeKey(` \t${fake}\r\n`).mode, mode);
  });
}

Deno.test("Stripe key rejects missing and non-string values", () => {
  for (const input of [undefined, null, "", " \t\r\n", 123, {}, ["rk_test_Fixture123"]]) {
    equal(parseStripeKey(input), null);
    throws(() => requireStripeKey(input));
  }
});

Deno.test("Stripe key rejects unknown, empty suffix and malformed forms", () => {
  for (const input of ["pk_test_Fixture123", "sk_test_", "rk_live_", "rk_dev_Fixture123", "SK_test_Fixture123", "sk_live_Fixture 123", "rk_test_Fixture\n123", "rk_live_Fixture-123", "rk_live_Fixture_123", "sk_test_Fixture123/", "prefixrk_test_Fixture123", "Bearer rk_test_Fixture123"]) {
    equal(parseStripeKey(input), null);
    throws(() => requireStripeKey(input));
  }
});

Deno.test("Stripe key validation errors do not disclose rejected input", () => {
  const malformed = "rk_test_PRIVATE-FIXTURE";
  throws(() => requireStripeKey(malformed), (error: unknown) => {
    equal(error instanceof Error, true);
    if (!(error instanceof Error)) return false;
    equal(error.message.includes(malformed), false);
    return true;
  });
});