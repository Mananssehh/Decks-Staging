// SOURCE ONLY. Move into deployable functions only after follow-up SQL is independently installed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripe, getStripeMode, json, corsHeaders } from "../../../functions/_shared/stripe.ts";
import { createReservedCheckout, type CheckoutInput, type Reservation } from "./checkout.ts";
Deno.serve(async req=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST') return json({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL'); const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const origin=Deno.env.get('APP_ORIGIN');
 if(!url||!key||!origin||!/^https:\/\/[^/]+$/.test(origin)) return json({error_code:'SERVICE_FAILED'},503);
 const admin=createClient(url,key);
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token) return json({error_code:'UNAUTHORIZED'},401);
 const {data,error}=await admin.auth.getUser(token);
 if(error||!data.user) return json({error_code:'UNAUTHORIZED'},401);
 try {
  const input=await req.json() as CheckoutInput;
  const stripe=getStripe();
  const result=await createReservedCheckout(data.user.id,input,{
   reserve:async(user,body)=>{const {data:r,error:e}=await admin.rpc('followup_reserve_tip',{_user_id:user,_request_key:body.request_key,_event_id:body.event_id,_amount_cents:body.amount_cents,_song_request_id:body.song_request_id??null});if(e)throw e;return r as Reservation;},
   create:async(params,options)=>stripe.checkout.sessions.create(params as Parameters<typeof stripe.checkout.sessions.create>[0],options),
   attach:async(id,s)=>{const {error:e}=await admin.rpc('followup_attach_tip_session',{_reservation_id:id,_session_id:s.id,_url:s.url,_expires_at:new Date(s.expires_at*1000).toISOString()});if(e)throw e;},
   origin,live:getStripeMode()==='live',now:Date.now,
  });
  return json(result);
 }catch{return json({error_code:'SERVICE_FAILED',message:'Checkout could not be confirmed. Retry with the same request.'},503);}
});