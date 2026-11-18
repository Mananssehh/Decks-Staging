// Bridge Pairing Protocol v2: the Edge Function cases (shared with the Deno tests) plus static
// assertions over the SQL candidate and the touched sources. No network, no database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { protocolCases } from "../../supabase/functions/_shared/bridge-protocol_cases";
import { admissionCases } from "../../supabase/functions/_shared/bridge-admission_cases";
import { bridgePairCases } from "../../supabase/functions/bridge-pair/cases";
import { bridgeRevokeCases } from "../../supabase/functions/bridge-revoke/cases";

const read = (path: string) => readFileSync(path, "utf8");
const code = (sql: string) => sql.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

describe("bridge protocol v2 helpers", () => { for (const [name, run] of protocolCases) it(name, run); });
describe("bridge-pair pending-claim limit", () => { for (const [name, run] of admissionCases) it(name, run); });
describe("bridge-pair handler", () => { for (const [name, run] of bridgePairCases) it(name, run); });
describe("bridge-revoke handler", () => { for (const [name, run] of bridgeRevokeCases) it(name, run); });

describe("10_bridge_pairing_security.sql (static)", () => {
  const sql = code(read("supabase/repair-staged/10_bridge_pairing_security.sql"));
  it("takes pairing entropy only from extensions.gen_random_bytes(10)", () => {
    expect(sql).toContain("extensions.gen_random_bytes(10)");
    expect(sql).not.toMatch(/(?<![a-z_])random\s*\(/i);
    expect(sql).not.toMatch(/setseed/i);
    expect(sql.match(/gen_random_bytes\((\d+)\)/g)?.sort()).toEqual(["gen_random_bytes(10)", "gen_random_bytes(32)", "gen_random_bytes(32)", "gen_random_bytes(32)"]);
  });
  it("stores SHA-256 hashes and an explicit protocol version, never a plaintext code column", () => {
    const table = sql.slice(sql.indexOf("CREATE TABLE public.bridge_pairing_v2"), sql.indexOf("CREATE INDEX bridge_pairing_v2_event"));
    expect(table).toMatch(/protocol_version smallint NOT NULL DEFAULT 2 .*CHECK\(protocol_version=2\)/);
    expect(table).toMatch(/code_hash bytea NOT NULL .*UNIQUE .*octet_length\(code_hash\)=32/);
    expect(table).not.toMatch(/\bcode text\b|\bingest_token\b|\bclient_nonce text\b|\bip\b/);
    expect(sql).toContain("extensions.digest(convert_to(canonical,'UTF8'),'sha256')");
  });
  it("pins search_path on every SECURITY DEFINER routine and schema-qualifies application objects", () => {
    const definers = sql.match(/SECURITY DEFINER[^\n]*/g) ?? [];
    expect(definers.length).toBe(4);
    for (const line of definers) expect(line).toMatch(/^SECURITY DEFINER SET search_path='' AS \$\$$/);
    expect(sql).not.toMatch(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE|ON)\s+(?:events|event_integrations|bridge_[a-z0-9_]+)\b/i);
    expect(sql).not.toMatch(/(?<![a-z_.])(?:gen_random_bytes|digest)\(/);
    expect(sql).not.toMatch(/(?<![a-z_.])uid\(\)/);
  });
  it("strips every API role from all five routines, then grants only the intended end state", () => {
    const revoke = "REVOKE ALL ON FUNCTION public.bridge_pair_claim_v2(text,text),public.bridge_revoke_v2(text),\n public.generate_bridge_pairing_code(uuid),public.regenerate_ingest_token(uuid),public.repair_claim_bridge_code(text,text)\nFROM PUBLIC,anon,authenticated,service_role;";
    expect(sql).toContain(revoke);
    expect(sql).toContain("REVOKE ALL ON TABLE public.bridge_pairing_v2 FROM PUBLIC,anon,authenticated,service_role;");
    const grants = sql.match(/^GRANT [^;]+;/gm) ?? [];
    expect(grants).toEqual([
      "GRANT EXECUTE ON FUNCTION public.bridge_pair_claim_v2(text,text),public.bridge_revoke_v2(text) TO service_role;",
      "GRANT EXECUTE ON FUNCTION public.generate_bridge_pairing_code(uuid),public.regenerate_ingest_token(uuid) TO authenticated;",
    ]);
    for (const grant of grants) expect(sql.indexOf(grant)).toBeGreaterThan(sql.indexOf(revoke));
    expect(sql.match(/^REVOKE [^;]+;/gm)?.length).toBe(2);
  });
  it("post-apply gate checks exact grantees with aclexplode and a trusted owner", () => {
    const gate = sql.slice(sql.indexOf("DO $verify$"));
    expect(gate).toContain("pg_catalog.aclexplode(p.proacl)");
    expect(gate).toContain("pg_catalog.aclexplode(c.relacl)");
    expect(gate).toContain("IF f.proacl IS NULL THEN RAISE EXCEPTION");
    expect(gate).toContain("IF f.grantees IS DISTINCT FROM f.intended THEN RAISE EXCEPTION");
    expect(gate).toContain("THEN ARRAY['service_role']");
    expect(gate).toContain("THEN ARRAY['authenticated']");
    expect(gate).toContain("IF f.owner<>trusted THEN RAISE EXCEPTION");
    expect(gate).toContain("IF current_user<>trusted THEN RAISE EXCEPTION");
    const guard = sql.slice(sql.indexOf("DO $guard$"), sql.indexOf("END $guard$"));
    expect(guard).toContain("trusted constant text := 'postgres'");
    expect(guard).toContain("IF current_user<>trusted THEN RAISE EXCEPTION");
    expect(guard).toContain("'Prior Bridge routine owner drift'");
    expect(guard).toContain("'Bridge table owner drift'");
  });
  it("enforces one integration per token: guard, unique partial index and matching revoke rule", () => {
    const guard = sql.slice(sql.indexOf("DO $guard$"), sql.indexOf("END $guard$"));
    expect(guard).toContain("FROM public.event_integrations WHERE ingest_token IS NOT NULL GROUP BY ingest_token HAVING count(*)>1");
    expect(guard).toContain("'Duplicate ingest tokens: preserve evidence and resolve independently'");
    expect(sql).toContain("CREATE UNIQUE INDEX bridge_ingest_token_unique ON public.event_integrations(ingest_token) WHERE ingest_token IS NOT NULL;");
    expect(sql).toContain("IF _token IS NULL OR _token !~ '^([0-9a-f]{48}|[0-9a-f]{64})$' THEN RETURN false; END IF;");
    expect(sql).not.toMatch(/A-Za-z0-9_-\]\{16,128\}/);
    const shared = read("supabase/functions/_shared/bridge-protocol.ts");
    expect(shared).toContain("const ISSUED_TOKEN = /^[0-9a-f]{64}$/;");
    expect(shared).toContain("const REVOCABLE_TOKEN = /^(?:[0-9a-f]{48}|[0-9a-f]{64})$/;");
    expect(shared).not.toMatch(/\{16,128\}/);
  });
  it("refuses to run statement by statement and carries no blind BEGIN/COMMIT", () => {
    const contain = code(read("supabase/repair-staged/rollback/10_bridge_pairing_contain.sql"));
    for (const [file, marker] of [[sql, "10_bridge_pairing_security"], [contain, "10_bridge_pairing_contain"]]) {
      expect(file).toContain(`SET LOCAL bridge_pairing_v2.single_transaction='${marker}';`);
      expect(file).toContain(`pg_catalog.current_setting('bridge_pairing_v2.single_transaction',true) IS DISTINCT FROM '${marker}'`);
      expect(file).not.toMatch(/^\s*(?:BEGIN|COMMIT|START TRANSACTION|ROLLBACK)\s*;/im);
    }
    expect(sql.match(/single_transaction',true\) IS DISTINCT FROM/g)?.length).toBe(2);
  });
  it("retires six-digit pairing and trusts no network address", () => {
    expect(sql).toContain("DELETE FROM public.bridge_pairing_codes;");
    expect(sql).toContain("ADD CONSTRAINT bridge_pairing_codes_v1_retired CHECK(false)");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION [^;]*public\.repair_claim_bridge_code\(text,text\)\nFROM PUBLIC,anon,authenticated,service_role;/);
    expect(sql).not.toMatch(/\{6\}|lpad\(/);
    expect(sql).toContain("CREATE FUNCTION public.bridge_pair_claim_v2(_code text,_client_nonce text)");
    expect(sql).not.toMatch(/unverified-gateway|forwarded|inet|claimed_ip/i);
  });
  it("keeps no invalid-attempt evidence: nothing is written, counted or consulted on refusal", () => {
    expect(sql).not.toContain("bridge_pair_attempts");
    const claim = sql.slice(sql.indexOf("CREATE FUNCTION public.bridge_pair_claim_v2"), sql.indexOf("CREATE FUNCTION public.bridge_revoke_v2"));
    expect(claim.match(/\bINSERT INTO\b/g)).toEqual(["INSERT INTO"]);
    expect(claim).toContain("INSERT INTO public.event_integrations(event_id,source_type,ingest_token)");
    expect(claim).not.toMatch(/count\(\*\)|interval '10 minutes'|rate|budget/i);
  });
  it("guards against drift before changing anything and verifies after", () => {
    expect(sql.indexOf("DO $guard$")).toBeLessThan(sql.indexOf("CREATE TABLE"));
    expect(sql.match(/drift/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(sql.indexOf("DO $verify$")).toBeGreaterThan(sql.lastIndexOf("GRANT EXECUTE"));
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE)\b[^;]*\bON (?:TABLE )?public\.(?:bridge_pairing_codes|bridge_pair_attempts|event_integrations)\b/);
  });
  it("containment disables new pairing and cannot restore six-digit pairing", () => {
    const contain = code(read("supabase/repair-staged/rollback/10_bridge_pairing_contain.sql"));
    expect(contain).toContain("REVOKE ALL ON FUNCTION public.generate_bridge_pairing_code(uuid),public.bridge_pair_claim_v2(text,text)");
    expect(contain).not.toMatch(/\bGRANT\b|DROP CONSTRAINT|repair_claim_bridge_code|CREATE\b/i);
  });
});

describe("10_bridge_pairing_preflight.sql (static, never executed against a hosted database)", () => {
  const raw = read("supabase/repair-staged/10_bridge_pairing_preflight.sql");
  const sql = code(raw);
  const migration = read("supabase/repair-staged/10_bridge_pairing_security.sql");
  it("is SELECT-only", () => {
    const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
    expect(statements.length).toBe(5);
    for (const statement of statements) expect(statement).toMatch(/^SELECT/);
    // Uppercase keyword only: the type name "timestamp with time zone" appears inside string literals.
    expect(sql).not.toMatch(/\bWITH\b/);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|COPY|SET|EXECUTE|LOCK|NOTIFY|REFRESH|VACUUM)\s/);
    expect(sql).not.toMatch(/\bFOR (?:UPDATE|SHARE)\b|nextval|setval|pg_advisory|set_config|dblink|pg_sleep/i);
  });
  it("executes no application function and reads no application row", () => {
    const calls = sql.replace(/'[^']*'/g, "''").match(/\b(?:public|auth|extensions)\.[a-z_0-9]+\s*\(/g) ?? [];
    expect(calls).toEqual([]);
    const bare = sql.replace(/'[^']*'/g, "''");
    const tables = bare.match(/\bFROM\s+public\.[a-z_0-9]+/g) ?? [];
    expect([...new Set(tables)].sort()).toEqual(["FROM public.bridge_pairing_codes", "FROM public.event_integrations"]);
    // Every application-table reference is the direct source of a count(*) aggregate.
    expect(bare.match(/SELECT count\(\*\) FROM public\.[a-z_0-9]+/g)?.length).toBe(tables.length);
    expect(bare).not.toMatch(/\bJOIN\s+public\./);
    // No raw token, pairing code, event or user identifier is ever in a select list.
    expect(sql).not.toMatch(/ingest_token\s*(?:,|FROM|AS)|\bcode\s*(?:,|FROM|AS)|SELECT \*|\bdj_id\b(?!')|created_by|claimed_ip|\bemail\b/);
    expect(bare).not.toMatch(/SELECT\s+(?:[a-z_.]+\.)?(?:ingest_token|event_id|code|id)\b/);
  });
  it("reports the size of the destructive cutover as aggregate counts", () => {
    for (const alias of ["legacy_pairing_rows", "live_unclaimed_legacy_codes", "integrations_total", "bridge_integrations", "non_null_tokens",
      "duplicate_token_groups", "tokens_legacy_48_hex", "tokens_v2_64_hex", "tokens_not_revocable_by_device"]) {
      expect(sql).toMatch(new RegExp(`\\(SELECT count\\(\\*\\) FROM [^;]*?\\) AS ${alias}\\b`));
    }
    expect(sql).toContain("(13,'duplicate_token_groups','0',");
    expect(sql).toContain("(SELECT count(*)::text FROM (SELECT count(*) FROM public.event_integrations WHERE ingest_token IS NOT NULL GROUP BY ingest_token HAVING count(*)>1) duplicate_token_groups)");
  });
  it("checks trusted owners and the session identity, and flags what still needs hosted evidence", () => {
    expect(sql).toContain("(15,'prior_routine_owners','postgres',");
    expect(sql).toContain("(16,'bridge_table_owners','postgres',");
    expect(sql).toContain("SELECT current_user AS preflight_current_user, session_user AS preflight_session_user,");
    expect(raw).toContain("STILL REQUIRES HOSTED EVIDENCE");
    expect(raw).toContain("The table owners are NOT in the captured evidence");
  });
  it("lists exactly the values the migration's drift guards require", () => {
    const hashes = migration.match(/IS DISTINCT FROM '([0-9a-f]{32})'/g)?.map(m => m.slice(-33, -1)) ?? [];
    expect(hashes.length).toBe(3);
    for (const hash of hashes) {
      expect(sql).toContain(`'${hash}'`);
      expect(raw.split("\n").some(line => line.startsWith("--") && line.includes(hash))).toBe(true);
    }
    expect(migration).toContain("IF expected_columns<>13 THEN");
    expect(sql).toContain("(11,'expected_columns','13',");
    expect(raw).toContain("every row has result = 'MATCH'");
    expect(sql.match(/^ \(\d+,'/gm)?.length).toBe(16);
    expect(raw).toContain("statement 1 returns exactly 16 rows");
  });
});

describe("gateway configuration and endpoint contract (static)", () => {
  const config = read("supabase/config.toml");
  it("declares verify_jwt = false for bridge-pair and bridge-revoke, and changes no other function", () => {
    const sections = [...config.matchAll(/^\[functions\.([a-z-]+)\]\n(verify_jwt = (?:true|false))$/gm)].map(m => `${m[1]}:${m[2]}`);
    expect(sections).toEqual([
      "guest-token-probe:verify_jwt = false", "guest-event:verify_jwt = false", "guest-event-stream:verify_jwt = false",
      "music-search:verify_jwt = false", "tip-create-checkout:verify_jwt = false",
      "bridge-pair:verify_jwt = false", "bridge-revoke:verify_jwt = false",
    ]);
    expect(config.match(/^\[/gm)?.length).toBe(7);
    expect(config).toContain('project_id = "ldxgejbzmpvsvozqmpfe"');
  });
  it("handlers authenticate before the protected call: validation precedes the RPC in source order", () => {
    const pair = read("supabase/functions/bridge-pair/handler.ts");
    const order = ["allowedOrigin(req)", "stagingBackend(deps.url)", "hasQuery(req)", "jsonMediaType(req)", "boundedJsonObject(req)", "normalizePairingCode(body.code)", "validClientNonce(clientNonce)", "admission.tryRun(() => claim(code, clientNonce))", "if (!pending) return json(503, { error: 'service_unavailable' });", "await pending"].map(n => pair.indexOf(n));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(pair.match(/claim\(code, clientNonce\)/g)?.length).toBe(1);
    expect(pair).not.toContain("deps.claim(");
    expect(pair.match(/tryRun\(/g)?.length).toBe(1);
    const revoke = read("supabase/functions/bridge-revoke/handler.ts");
    const revokeOrder = ["allowedOrigin(req)", "stagingBackend(deps.url)", "if (hasQuery(req) || carriesBody(req) || req.headers.has('authorization')) return done();", "validRevocableToken(token)", "deps.revoke(token)"].map(n => revoke.indexOf(n));
    expect(revokeOrder.every(i => i >= 0)).toBe(true);
    expect([...revokeOrder].sort((a, b) => a - b)).toEqual(revokeOrder);
    expect(revoke.match(/deps\.revoke\(/g)?.length).toBe(1);
    expect(revoke).not.toMatch(/req\.(?:json|text|formData|arrayBuffer|blob)\(|getReader|searchParams|headers\.get\('authorization'\)/i);
    expect(pair).toContain("validIssuedToken(row.ingest_token)");
    expect(pair).not.toContain("validRevocableToken");
  });
  it("CORS request-header allowance is endpoint-specific", () => {
    expect(read("supabase/functions/bridge-pair/handler.ts")).toContain("export const ALLOW_HEADERS = 'content-type';");
    expect(read("supabase/functions/bridge-revoke/handler.ts")).toContain("export const ALLOW_HEADERS = 'x-ingest-token';");
    const shared = read("supabase/functions/_shared/bridge-protocol.ts");
    expect(shared).not.toMatch(/apikey|x-client-info|content-type,authorization/);
    for (const fixed of ["'Access-Control-Allow-Methods': 'POST,OPTIONS'", "'Access-Control-Expose-Headers': 'x-correlation-id'", "'Cache-Control': 'no-store'", "'Vary': 'Origin'"]) expect(shared).toContain(fixed);
  });
  it("both new entrypoints pin the exact Supabase JS version the staging Bridge functions already use", () => {
    const pinned = "https://esm.sh/@supabase/supabase-js@2.95.0";
    for (const path of ["supabase/functions/bridge-pair/index.ts", "supabase/functions/bridge-revoke/index.ts"]) {
      const source = read(path);
      expect(source.match(/supabase-js@[^'"]+/g)).toEqual(["supabase-js@2.95.0"]);
      expect(source).toContain(`import { createClient } from '${pinned}';`);
    }
    for (const path of ["supabase/functions/now-playing-ingest/index.ts", "supabase/functions/bridge-event-snapshot/index.ts"]) expect(read(path)).toContain(pinned);
  });
  it("the pairing UI never renders backend error text", () => {
    const ui = read("src/components/BridgePairing.tsx");
    expect(ui).not.toMatch(/\.message\b|catch \(e\)|String\(e\)/);
    expect(ui.match(/toast\.error\(([^)]*)\)/g)).toEqual(["toast.error(GENERATE_FAILED)", "toast.error(ROTATE_FAILED)", 'toast.error("Copy failed. Type the code into Decks Bridge instead.")']);
  });
  it("the contract states what the code and the nonce are, how cleanup works and what still gates deployment", () => {
    const contract = read("docs/BRIDGE_PAIRING_PROTOCOL_V2.md");
    for (const sentence of [
      "The 80-bit pairing code is the credential.",
      "The client nonce is not authentication.",
      "Cleanup of claimed rows is lazy",
      "independently confirmed to execute the complete file in one transaction",
      "Unresolved deployment gate",
      "independently verified trusted gateway or platform request limiting",
      "## Pending-claim limit",
      "This is database backpressure, not request-volume limiting",
      "can exhaust the five-minute first-claim window",
      "or the two-minute same-nonce recovery window",
      "If a claim call never settles",
      "gets the `404` before admission",
      "a well-formed request, whatever the state of its code, is answered at once with `503",
      "An admitted claim that the database refuses (unknown, expired or already claimed) gets the `404`",
      "A claim call that throws before returning a promise frees its slot immediately.",
      "`^[0-9a-f]{64}$`",
      "`^(?:[0-9a-f]{48}|[0-9a-f]{64})$`",
    ]) expect(contract).toContain(sentence);
    expect(contract).not.toMatch(/code plus nonce|secret plus nonce/i);
    expect(contract).not.toMatch(/held by nobody|nobody holds/i);
  });
  it("only the two desktop-webview origins are allowlisted", () => {
    const shared = read("supabase/functions/_shared/bridge-protocol.ts");
    const list = shared.slice(shared.indexOf("export const ALLOWED_ORIGINS"), shared.indexOf("];", shared.indexOf("export const ALLOWED_ORIGINS")));
    expect(list.match(/'[^']+'/g)).toEqual(["'tauri://localhost'", "'http://tauri.localhost'"]);
    expect(shared).not.toMatch(/lovable\.app|linku99|localhost:\d|Allow-Origin': '\*'/);
    expect(shared).toContain("'Vary': 'Origin'");
  });
  it("endpoint_url is the only endpoint field anywhere in the pairing sources and contract", () => {
    for (const path of ["supabase/functions/bridge-pair/handler.ts", "supabase/functions/bridge-pair/index.ts", "supabase/functions/_shared/bridge-protocol.ts"]) {
      expect(read(path)).not.toContain("edge_function_url");
    }
    expect(read("supabase/functions/bridge-pair/handler.ts")).toContain("endpoint_url: `${new URL(deps.url as string).origin}/functions/v1/now-playing-ingest`");
    const contract = read("docs/BRIDGE_PAIRING_PROTOCOL_V2.md");
    expect(contract).toContain('"endpoint_url": "https://<backend>/functions/v1/now-playing-ingest"');
    expect(contract).toContain("The obsolete `edge_function_url` field is not emitted.");
    expect(read("docs/UI_PREVIEW_HANDOFF.md")).not.toMatch(/6-digit|IP-rate-limited|per IP/);
  });
});

describe("no secret logging or secret-bearing URLs in touched sources (static)", () => {
  const pair = read("supabase/functions/bridge-pair/handler.ts");
  const revoke = read("supabase/functions/bridge-revoke/handler.ts");
  const shared = read("supabase/functions/_shared/bridge-protocol.ts");
  const entrypoints = read("supabase/functions/bridge-pair/index.ts") + read("supabase/functions/bridge-revoke/index.ts");
  const admission = read("supabase/functions/_shared/bridge-admission.ts");
  it("handlers and entrypoints never call console directly; the shared logger prints one allowlisted object", () => {
    for (const source of [pair, revoke, entrypoints, admission]) expect(source).not.toMatch(/console\./);
    expect(shared.match(/console\.[a-z]+\(/g)).toEqual(["console.error("]);
    expect(shared).toContain("console.error(JSON.stringify(entry))");
  });
  it("handlers read no forwarded-address header and accept no six-digit pattern", () => {
    for (const source of [pair, revoke, shared, entrypoints, admission]) {
      expect(source).not.toMatch(/x-forwarded-for|x-real-ip|cf-connecting-ip/i);
      expect(source).not.toMatch(/\\d\{6\}|\{6\}/);
      expect(source).not.toContain("repair_claim_bridge_code");
    }
    expect(entrypoints).toContain("bridge_pair_claim_v2");
    expect(entrypoints).toContain("bridge_revoke_v2");
  });
  it("the pending-claim limit is per worker, untimed and stateless, and only bridge-pair uses it", () => {
    expect(admission).not.toMatch(/setTimeout|setInterval|Date\.now|performance\.now|AbortSignal|signal|fetch\(|Deno\.|localStorage|indexedDB|import /);
    expect(admission).toContain("export const PROVISIONAL_PENDING_CLAIM_LIMIT = 4;");
    expect(admission).toContain("settled.then(release, release);");
    expect(read("supabase/functions/bridge-pair/index.ts")).toContain("createPendingCallLimit(PROVISIONAL_PENDING_CLAIM_LIMIT)");
    const shed = pair.slice(pair.indexOf("if (!pending)"), pair.indexOf("\n", pair.indexOf("if (!pending)")));
    expect(shed).toBe("if (!pending) return json(503, { error: 'service_unavailable' });");
    for (const path of ["supabase/functions/bridge-revoke/handler.ts", "supabase/functions/bridge-revoke/index.ts"]) {
      expect(read(path)).not.toMatch(/bridge-admission|PendingCallLimit|tryRun/);
    }
  });
  it("web pairing UI has no QR, link or deep link and never touches the hash or token", () => {
    const ui = read("src/components/BridgePairing.tsx");
    for (const needle of ["qrcode", "QRCode", "linku99", "connect?code", "decksbridge:", "6-digit", "code_hash", "get_ingest_token", "bridge_pairing_v2", "console.", "localStorage", "sessionStorage"]) {
      expect(ui).not.toContain(needle);
    }
    expect(ui).not.toMatch(/select\([^)]*ingest_token/);
    const connect = read("src/pages/Connect.tsx");
    for (const needle of ["useSearchParams", "decksbridge:", "location.href", "iframe", "6-digit", "console.", "linku99", "href", "http"]) expect(connect).not.toContain(needle);
  });
});
