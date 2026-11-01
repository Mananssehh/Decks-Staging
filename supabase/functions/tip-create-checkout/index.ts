// SOURCE ONLY: independent repair-followup installation + combined webhook/reconcile deployment required.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getStripe,getStripeMode,json,corsHeaders } from '../_shared/stripe.ts';
import { paymentRpc,requirePaymentContract,safeOrigin } from '../_shared/payment-contract.ts';
import { createReservedCheckout,type CheckoutInput,type Reservation } from './checkout.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error_code:'INVALID_REQUEST'},405);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return json({error_code:'SERVICE_FAILED'},503);
 const db=createClient(url,key); const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return json({error_code:'UNAUTHORIZED'},401);
 const {data:user,error:authError}=await db.auth.getUser(token);
 if(authError||!user.user)return json({error_code:'UNAUTHORIZED'},401);
 try {
  const body=await req.json();
  if(!body||typeof body.event_id!=='string'||! /^[0-9a-f-]{36}$/i.test(body.event_id))return json({error_code:'INVALID_REQUEST'},400);
  if(body.check_only===true){
   // Readiness is read-only: no reservation, consent write or Stripe API call.
   const {data:e,error}=await db.from('events').select('*').eq('id',body.event_id).maybeSingle();
   if(error)throw error;
   if(!e||!e.is_active||e.ended_at||e.requests_status==='ended')return json({error_code:'EVENT_NOT_FOUND',ready:false});
   if(e.dj_id===user.user.id)return json({error_code:'SELF_TIP',ready:false});
   const {data:p,error:pe}=await db.from('dj_payout_accounts').select('*').eq('user_id',e.dj_id).maybeSingle();if(pe)throw pe;
   if(getStripeMode()==='unknown')return json({error_code:'STRIPE_CONFIG_ERROR',ready:false});
   if(!p?.charges_enabled||!p.payouts_enabled||p.livemode!==(getStripeMode()==='live'))return json({error_code:'DJ_PAYOUTS_NOT_READY',ready:false});
   return json({ready:true,ok:true});
  }
  await requirePaymentContract(db);
  const origin=safeOrigin(Deno.env.get('APP_ORIGIN'));
  const stripe=getStripe();
  const result=await createReservedCheckout(user.user.id,body as CheckoutInput,{
   reserve:(uid,input)=>paymentRpc<Reservation>(db,'followup_reserve_tip',{_user_id:uid,_request_key:input.request_key,_event_id:input.event_id,_amount_cents:input.amount_cents,_song_request_id:input.song_request_id??null,_origin:origin}),
   create:(params,opts)=>stripe.checkout.sessions.create(params as Parameters<typeof stripe.checkout.sessions.create>[0],opts),
   attach:(id,s)=>paymentRpc<void>(db,'followup_attach_tip_session',{_reservation_id:id,_session_id:s.id,_url:s.url,_expires_at:new Date(s.expires_at*1000).toISOString()}),
   origin,live:getStripeMode()==='live',now:Date.now,
  });return json(result);
 }catch(error){
  const message=(error as {message?:string})?.message??'';
  const codes=[['Current consent','CONSENT_REQUIRED'],['Tip limit','TIP_LIMIT_REACHED'],['Event unavailable','EVENT_NOT_FOUND'],['DJ payouts','DJ_PAYOUTS_NOT_READY'],['Invalid request','INVALID_REQUEST'],['Idempotency key payload','REQUEST_CONFLICT'],['already settled','CHECKOUT_TERMINAL'],['Reconciliation required','RECONCILIATION_REQUIRED']] as const;
  const match=codes.find(([text])=>message.includes(text));
  return json({error_code:match?.[1]??'CHECKOUT_AMBIGUOUS',terminal:match?.[1]==='CHECKOUT_TERMINAL',message:match?.[1]==='RECONCILIATION_REQUIRED'?'Checkout requires review; no new charge was started.':'Checkout could not be confirmed. Retry the same tip.'},match?200:503);
 }
});
