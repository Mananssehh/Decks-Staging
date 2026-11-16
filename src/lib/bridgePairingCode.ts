/**
 * DECKS Bridge Pairing Protocol v2 display helper (contract: docs/BRIDGE_PAIRING_PROTOCOL_V2.md).
 * The pairing code is a short-lived secret: keep it in component memory only. Never put it in a
 * URL, QR payload, deep link, log line, analytics event, error report or persistent storage.
 */
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** Returns XXXX-XXXX-XXXX-XXXX for a v2 code from the backend, or null for anything else (including six-digit codes). */
export function groupedPairingCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 19) return null;
  const canonical = value.replace(/-/g, "");
  if (!CANONICAL_CODE.test(canonical)) return null;
  return `${canonical.slice(0, 4)}-${canonical.slice(4, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}`;
}
