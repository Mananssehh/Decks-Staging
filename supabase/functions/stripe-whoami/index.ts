// Admin-only diagnostic: inspects STRIPE_SECRET_KEY shape and calls Stripe.
// Never prints key material.
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeDiagnostic } from "./authorization.ts";
import { getStripe } from "../_shared/stripe.ts";
import { parseStripeKey } from "../_shared/stripe-key.ts";
import type Stripe from "https://esm.sh/stripe@17.5.0?target=denonext";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return jsonResp({ error: "method_not_allowed" }, 405);

  // Authenticate and authorize before key inspection or any provider call.
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return jsonResp({ error: "service_unavailable" }, 503);
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = await authorizeDiagnostic(req, async token => {
    const { data, error } = await caller.auth.getClaims(token);
    if (error || !data?.claims || data.claims.is_anonymous === true) return null;
    return typeof data.claims.sub === "string" ? data.claims.sub : null;
  }, async userId => {
    const { data, error } = await caller.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (error) throw new Error("role_unavailable");
    return data === true;
  });
  if (denied) return jsonResp({ error: denied === 401 ? "sign_in_required" : denied === 403 ? "forbidden" : "service_unavailable" }, denied);

  const raw = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const trimmed = raw.trim();
  const parsedKey = parseStripeKey(raw);

  const shape = {
    present: trimmed.length > 0,
    starts_with_sk_live: trimmed.startsWith("sk_live_"),
    starts_with_sk_test: trimmed.startsWith("sk_test_"),
    starts_with_rk_live: trimmed.startsWith("rk_live_"),
    starts_with_rk_test: trimmed.startsWith("rk_test_"),
    mode: parsedKey?.mode ?? "unknown",
    length: trimmed.length,
    raw_length: raw.length,
    has_leading_space: raw.length > 0 && raw[0] !== trimmed[0],
    has_trailing_whitespace: raw.length !== trimmed.length && raw.trimEnd().length !== raw.length,
    has_newline: /\r|\n/.test(raw),
    has_internal_whitespace: /\s/.test(trimmed),
    read_at: new Date().toISOString(),
  };

  if (!shape.present) {
    return jsonResp({ shape, error: "STRIPE_SECRET_KEY not set" }, 200);
  }

  if (!parsedKey) {
    return jsonResp({ shape, error: "STRIPE_SECRET_KEY format invalid" }, 200);
  }
  const stripe = getStripe();

  try {
    const acct = await stripe.accounts.retrieve();
    const url = new URL(req.url);
    const probeId = url.searchParams.get("account");
    let probe: Record<string, unknown> | null = null;
    if (probeId) {
      try {
        const a = await stripe.accounts.retrieve(probeId);
        probe = {
          id: a.id,
          livemode: (a as Stripe.Account & {livemode?:boolean}).livemode,
          livemode_typeof: typeof (a as Stripe.Account & {livemode?:boolean}).livemode,
          has_livemode_key: Object.prototype.hasOwnProperty.call(a, "livemode"),
          all_keys: Object.keys(a),
          type: a.type,
          charges_enabled: a.charges_enabled,
          payouts_enabled: a.payouts_enabled,
          details_submitted: a.details_submitted,
          country: a.country,
          email: a.email,
        };
      } catch (caught: unknown) {
      const e = caught as { message?: string; code?: string; raw?: {message?:string;type?:string;code?:string;param?:string;statusCode?:number;request_log_url?:string}; statusCode?:number; requestId?:string; type?:string; decline_code?:string; param?:string; doc_url?:string };
        probe = { error: e?.message, code: e?.code, type: e?.type };
      }
    }
    return jsonResp({
      shape,
      stripe_ok: true,
      account: {
        id: acct.id,
        email: acct.email,
        country: acct.country,
        type: acct.type,
        livemode: (acct as Stripe.Account & {livemode?:boolean}).livemode ?? null,
        details_submitted: acct.details_submitted,
        charges_enabled: acct.charges_enabled,
      },
      probe,
    });
  } catch (caught: unknown) {
      const e = caught as { message?: string; code?: string; raw?: {message?:string;type?:string;code?:string;param?:string;statusCode?:number;request_log_url?:string}; statusCode?:number; requestId?:string; type?:string; decline_code?:string; param?:string; doc_url?:string };
    return jsonResp({
      shape,
      stripe_ok: false,
      stripe_error: {
        http_status: e?.statusCode ?? null,
        type: e?.type ?? null,
        code: e?.code ?? null,
        message: e?.message ?? String(e),
        request_id: e?.requestId ?? null,
      },
    });
  }
});
