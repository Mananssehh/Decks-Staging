// Sends the welcome email for the signed-in caller after signup or DJ
// activation. The recipient is always the caller's own email address —
// it is never taken from the request body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";

const TEMPLATE_BY_KIND = {
  guest: "guest-welcome",
  dj: "dj-welcome",
} as const;

type Kind = keyof typeof TEMPLATE_BY_KIND;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Sign in required." }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsErr || !claims?.claims) {
    return json({ error: "Sign in required." }, 401);
  }
  const userId = claims.claims.sub as string;
  const email = claims.claims.email as string | undefined;
  if (!email) {
    return json({ error: "Your account has no email address yet." }, 400);
  }

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind as Kind;
  if (kind !== "guest" && kind !== "dj") {
    return json({ error: "kind must be 'guest' or 'dj'." }, 400);
  }
  const nickname = typeof body?.nickname === "string" && body.nickname.trim()
    ? body.nickname.trim().slice(0, 60)
    : "there";

  const templateName = TEMPLATE_BY_KIND[kind];
  const templateData = kind === "dj" ? { djName: nickname } : { nickname };
  const idempotencyKey = typeof body?.idempotencyKey === "string" && body.idempotencyKey
    ? body.idempotencyKey.slice(0, 200)
    : `${templateName}:${userId}`;

  const result = await sendTemplateEmail(templateName, email, {
    templateData,
    idempotencyKey,
  });

  if (!result.sent && result.reason === "recipient_suppressed") {
    // Expected outcome — the recipient opted out of app emails.
    return json({ sent: false, reason: "recipient_suppressed" });
  }
  return json({ sent: true });
});
