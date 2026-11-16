import { describe, expect, it } from "vitest";
import { groupedPairingCode } from "./bridgePairingCode";
import { CODE_ALPHABET, groupPairingCode, normalizePairingCode } from "../../supabase/functions/_shared/bridge-protocol";

describe("Bridge pairing v2 display form", () => {
  it("groups canonical and already grouped codes as XXXX-XXXX-XXXX-XXXX", () => {
    expect(groupedPairingCode("0123456789ABCDEF")).toBe("0123-4567-89AB-CDEF");
    expect(groupedPairingCode("GHJK-MNPQ-RSTV-WXYZ")).toBe("GHJK-MNPQ-RSTV-WXYZ");
  });
  it("accepts every symbol of the 32-character alphabet and agrees with the server grouping", () => {
    for (const symbol of CODE_ALPHABET) {
      const canonical = symbol.repeat(16);
      expect(groupedPairingCode(canonical)).toBe(groupPairingCode(canonical));
      expect(normalizePairingCode(groupedPairingCode(canonical))).toBe(canonical);
    }
  });
  it.each(["123456", "", "0123456789ABCDE", "0123456789ABCDEF0", "0123456789ABCDEU", "0123456789abcdef", "O123456789ABCDEF",
    "0123 4567 89AB CDEF", "0".repeat(64), null, undefined, 123456, {}])("rejects backend value %j instead of displaying it", value => {
    expect(groupedPairingCode(value)).toBeNull();
  });
});
