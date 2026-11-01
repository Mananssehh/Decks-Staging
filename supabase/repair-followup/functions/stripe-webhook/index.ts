// SOURCE ONLY: settle reservation-linked checkout events. Legacy refunds/account events
// remain on the existing signed handler until a reviewed combined deployment is prepared.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripe, corsHeaders } from "../../../functions/_shared/stripe.ts";
import { handleReservedPayment, type SignedPaymentEvent } from "./handler.ts";
Deno.serve(async req => {
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const secrets=[Deno.env.get('STRIPE_WEBHOOK_SECRET_PLATFORM'),Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT')].filter((x):x is string=>!!x);
 if(!url||!key||!secrets.length)return Response.json({error:'Service not configured'},{status:503,headers:corsHeaders});
 const admin=createClient(url,key);const stripe=getStripe();
 const response=await handleReservedPayment(req,async(raw,signature)=>{
  for(const secret of secrets){try{return await stripe.webhooks.constructEventAsync(raw,signature,secret) as unknown as SignedPaymentEvent;}catch{/* Try the other configured signature key. */}}
  throw Error('Invalid signature');
 },async args=>{const {error}=await admin.rpc('followup_apply_tip_event',args);if(error)throw error;});
 const body=await response.text();return new Response(body,{status:response.status,headers:{...corsHeaders,'Content-Type':'application/json'}});
});