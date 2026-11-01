// Sends the welcome email for the signed-in caller after signup or DJ
// activation. The recipient is always the caller's own email address —
// it is never taken from the request body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { handleWelcome } from "./handler.ts";

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

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return json({sent:false,reason:"service_unavailable"},503);
  const client = createClient(url,key,{global:{headers:{Authorization:req.headers.get("authorization") ?? ""}}});
  const result = await handleWelcome(req, {
    user: async token => { const {data,error}=await client.auth.getUser(token); if (error) return null; return data.user; },
    isDJ: async id => { const {data,error}=await client.rpc("has_role",{_user_id:id,_role:"dj"}); if(error) throw error; return data === true; },
  });
  return json(result.body,result.status);
});
