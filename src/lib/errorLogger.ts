import { supabase } from "@/integrations/supabase/client";

export type ErrorSeverity = "critical" | "warning" | "info";

interface LogErrorInput {
  severity: ErrorSeverity;
  source: string;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

/**
 * Single definition of sensitive names, shared by the free-text and structured scrubbers.
 * A key is sensitive when it CONTAINS one of these (access_token, token_hash, x-api-key, authCode, ...).
 */
const SENSITIVE_NAMES = "token|secret|password|passwd|authorization|cookie|api[-_]?key|signature|bootstrap|otp|verifier|challenge|credential|code";
const SENSITIVE_KEY = new RegExp(`(?:${SENSITIVE_NAMES})`, "i");
/**
 * Non-secret database/PostgREST error codes this application actually handles
 * (monitoringPolicy, guest-event diagnostics, request/profile RPC raises). Only these
 * survive, and only under the exact structured key `code`; everything else is redacted.
 */
const DATABASE_CODES: ReadonlySet<string> = new Set([
  "22023", "23503", "23505", "23514", "28000", "40001", "40P01", "42501", "53300", "55P03", "57014", "57P01",
  "P0001", "P0002", "P0004", "PGRST000", "PGRST001", "PGRST003", "PGRST301",
]);
const REDACTED = "[redacted]";

// After a key: optional closing quote, then `=` or `:`. The value is the REST OF THE LINE.
const ASSIGNMENT = /["']?[ \t]*[=:][ \t]*/y;
// A source position after a file name (ResetPassword.tsx:57:11) is not an assignment.
const STACK_POSITION = /^\d+(?::\d+)?\)?\s*$/;
const MAX_DECODE_PASSES = 16;

/**
 * For every `key=value` / `key: value` whose key contains a sensitive name, redacts the
 * remainder of that line. One linear scan per line (no nested quantifiers), so cost stays
 * proportional to input size even for adversarial input.
 */
function redactAssignments(line: string): string {
  const words = /[\w.-]+/g;
  for (let m = words.exec(line); m; m = words.exec(line)) {
    if (!SENSITIVE_KEY.test(m[0])) continue;
    const end = m.index + m[0].length;
    ASSIGNMENT.lastIndex = end;
    const sep = ASSIGNMENT.exec(line);
    if (!sep) continue;
    const head = line.slice(0, end + sep[0].length);
    if (/\.[cm]?[jt]sx?$/i.test(m[0]) && sep[0] === ":" && STACK_POSITION.test(line.slice(head.length))) return line;
    return `${head}${REDACTED}`;
  }
  return line;
}

/**
 * Tolerant, bounded percent-decoding of printable ASCII (0x21-0x7E). Nested encodings
 * (%2577 -> %77 -> w) collapse in a single linear pass; a few extra passes reach a fixpoint
 * for sequences assembled from separate pieces. Never throws: malformed sequences (%, %ZZ)
 * and non-ASCII/invalid UTF-8 bytes are left as-is. Encoded whitespace is NOT decoded here,
 * so URL values stay contiguous for query stripping.
 */
function decodePrintable(input: string): string {
  let text = input;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    const next = text.replace(/%(?:25)*([2-7][0-9a-f])/gi, (match, hex: string) => {
      const byte = parseInt(hex, 16);
      return byte >= 0x21 && byte <= 0x7e ? String.fromCharCode(byte) : `%${hex}`;
    });
    if (next === text) return text;
    text = next;
  }
  // Pathological input still decoding after the bound: drop every `%` so nothing remains to
  // decode. Keeps the work bounded and the output a fixpoint (idempotent).
  return text.replace(/%/g, "");
}

/**
 * Removes credentials from free text before it is stored. Deliberately conservative:
 * - standard percent-encoding (any nesting depth) is decoded first, so encoded key names,
 *   separators and quotes such as pass%77ord%3D..., api%2Dkey%3D... are seen;
 * - URL query strings and fragments carrying assignments are removed;
 * - JWTs and any unquoted or quoted value after `Bearer` / `Basic` are redacted;
 * - for every `key=value` / `key: value` whose key contains a sensitive name, the remainder
 *   of that line is redacted, so no part of a multi-word value survives.
 * Idempotent: scrubText(scrubText(x)) === scrubText(x). Never throws on malformed input.
 * Every step is a single linear pass (decoding is capped at a fixed number of passes).
 */
export function scrubText(value: string): string {
  return decodePrintable(value)
    // Query strings and fragments that carry an assignment are removed (single linear pass).
    .replace(/[?#][^\s"'<>()]*/g, (run) => (run.includes("=") ? "" : run))
    // Encoded spaces/tabs are decoded only after query stripping; encoded newlines stay encoded
    // so they can never end a redacted line early.
    .replace(/%20/g, " ")
    .replace(/%09/g, "\t")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, REDACTED)
    .split(/(\r\n|\r|\n)/)
    .map((part, i) => (i % 2 ? part : redactAssignments(part)))
    .join("")
    .replace(/\b(bearer|basic)([ \t]+)(?:"[^"\r\n]*"?|'[^'\r\n]*'?|[^\s"']+)/gi, `$1$2${REDACTED}`);
}

/** Deep-scrubs context with the same sensitive-name definition; strings are scrubbed, depth/size bounded. */
export function scrubContext(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value).slice(0, 2000);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object" || depth >= 4) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubContext(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    if (!SENSITIVE_KEY.test(k)) out[k] = scrubContext(v, depth + 1);
    // Exact key `code` only: an allowlisted database code, or an absent code, is kept.
    else if (k === "code" && (v == null || (typeof v === "string" && DATABASE_CODES.has(v)))) out[k] = v ?? null;
    else out[k] = REDACTED;
  }
  return out;
}

const recent = new Map<string, number>();
const DEDUP_MS = 5000;

export async function logError({ severity, source, message, context, stack }: LogErrorInput) {
  try {
    // Dedupe identical errors within 5s
    const key = `${severity}|${source}|${message}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUP_MS) return;
    recent.set(key, now);

    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    // Anonymous users cannot insert error logs (RLS), drop silently.
    if (!user) return;

    await supabase.from("error_logs").insert({
      severity,
      source: scrubText(source).slice(0, 200),
      message: scrubText(message).slice(0, 2000),
      context: context ? (scrubContext(context) as never) : null,
      stack: stack ? scrubText(stack).slice(0, 5000) : null,
      user_id: user?.id ?? null,
      // Pathname only: query strings and fragments can carry auth codes and tokens.
      route: typeof window !== "undefined" ? window.location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    });
  } catch {
    // Never let logging crash the app
  }
}

/** Log a non-critical issue silently (failed API, RLS denial, validation, etc.). */
export const logWarning = (source: string, message: string, context?: Record<string, unknown>) =>
  logError({ severity: "warning", source, message, context });

/** Log a critical DJ-flow breaking error — surfaced as alert in admin view. */
export const logCritical = (source: string, message: string, context?: Record<string, unknown>, stack?: string) =>
  logError({ severity: "critical", source, message, context, stack });

export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    logError({
      severity: "critical",
      source: "window.error",
      message: e.message || "Uncaught error",
      stack: e.error?.stack,
      context: { filename: e.filename, lineno: e.lineno, colno: e.colno },
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    logError({
      severity: "critical",
      source: "unhandledrejection",
      message: typeof reason === "string" ? reason : reason?.message || "Unhandled promise rejection",
      stack: reason?.stack,
    });
  });
}
