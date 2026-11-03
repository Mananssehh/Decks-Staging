// payment-v3 independently installed in staging. Readiness is advisory; reservations remain authoritative.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getStripe,getStripeMode,json,corsHeaders } from '../_shared/stripe.ts';
import { paymentRpc,requirePaymentContract,paymentOrigin } from '../_shared/payment-contract.ts';
import { createReservedCheckout,type CheckoutInput,type Reservation } from './checkout.ts';
import { checkReadiness,type ReadinessTip } from './readiness.ts';
import {resolveApplicationActor,boundedBody,ActorError} from '../_shared/application-actor.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error_code:'INVALID_REQUEST'},405);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return json({error_code:'SERVICE_FAILED'},503);
 const db=createClient(url,key);
 try {
  const body=await boundedBody(req);
  const actor=await resolveApplicationActor(req.headers,body,'tip',{backendUrl:url,auth:async token=>{const {data,error}=await db.auth.getUser(token);return error?null:data.user?.id??null;},guest:async(event,token,operation)=>{const {data,error}=await db.rpc('guest_application_actor',{_event_id:event,_token:token,_operation:operation});return error?{ok:false,status:503}:data;}});
  let aliases=actor.aliases;
  if(!actor.guest&&url==='https://ldxgejbzmpvsvozqmpfe.supabase.co'){const {data}=await db.rpc('application_actor_aliases',{_actor:actor.id});if(Array.isArray(data))aliases=data;}
  if(!body||typeof body.event_id!=='string'||! /^[0-9a-f-]{36}$/i.test(body.event_id))return json({error_code:'INVALID_REQUEST'},400);
  if(body.check_only===true){
   const result=await checkReadiness(actor.id,body.event_id,typeof body.amount_cents==='number'?body.amount_cents:100,{
    db,origin:Deno.env.get('APP_ORIGIN'),backendUrl:url,mode:getStripeMode(),now:Date.now,
    event:async()=>{const {data,error}=await db.from('events').select('dj_id,is_active,ended_at,requests_status').eq('id',body.event_id).maybeSingle();if(error)throw error;return data;},
    member:async()=>{const {data,error}=await db.from('event_participants').select('id').eq('event_id',body.event_id).in('user_id',aliases).limit(1).maybeSingle();if(error)throw error;return !!data;},
    banned:async()=>{const {data,error}=await db.from('event_banned_guests').select('id').eq('event_id',body.event_id).in('user_id',aliases).limit(1).maybeSingle();if(error)throw error;return !!data;},
    payout:async(dj)=>{const {data,error}=await db.from('dj_payout_accounts').select('stripe_account_id,charges_enabled,payouts_enabled,livemode').eq('user_id',dj).maybeSingle();if(error)throw error;return data;},
    tips:async(offset)=>{const {data,error}=await db.from('dj_tips').select('event_id,status,gross_amount_cents,created_at').in('user_id',aliases).in('status',['pending','succeeded']).order('id').range(offset,offset+999);if(error)throw error;return data as ReadinessTip[];},
   });return json(result);
  }
  await requirePaymentContract(db);
  const origin=paymentOrigin(Deno.env.get('APP_ORIGIN'),url);
  if(getStripeMode()==='unknown')return json({ready:false,error_code:'STRIPE_CONFIG_ERROR'},503);
  const stripe=getStripe();
  const result=await createReservedCheckout(actor.id,body as unknown as CheckoutInput,{
   reserve:(uid,input)=>paymentRpc<Reservation>(db,'followup_reserve_tip',{_user_id:uid,_request_key:input.request_key,_event_id:input.event_id,_amount_cents:input.amount_cents,_song_request_id:input.song_request_id??null,_origin:origin}),
   create:(params,opts)=>stripe.checkout.sessions.create(params as Parameters<typeof stripe.checkout.sessions.create>[0],opts),
   attach:(id,s)=>paymentRpc<void>(db,'followup_attach_tip_session',{_reservation_id:id,_session_id:s.id,_url:s.url,_expires_at:new Date(s.expires_at*1000).toISOString()}),
   origin,live:getStripeMode()==='live',now:Date.now,
  });return json(result);
 }catch(error){
  if(error instanceof ActorError)return json({ready:false,error_code:error.code},error.status);
  const message=(error as {message?:string})?.message??'';
  const codes=[['Current consent','CONSENT_REQUIRED'],['Tip limit','TIP_LIMIT_REACHED'],['Event unavailable','EVENT_NOT_FOUND'],['DJ payouts','DJ_PAYOUTS_NOT_READY'],['Invalid request','INVALID_REQUEST'],['Idempotency key payload','REQUEST_CONFLICT'],['already settled','CHECKOUT_TERMINAL'],['Reconciliation required','RECONCILIATION_REQUIRED']] as const;
  const match=codes.find(([text])=>message.includes(text));
  const configError=message.includes('APP_ORIGIN')||message.includes('Payment integration');
  return json({ready:false,error_code:configError?'STRIPE_CONFIG_ERROR':match?.[1]??'CHECKOUT_AMBIGUOUS',terminal:match?.[1]==='CHECKOUT_TERMINAL',message:configError?'Tips are temporarily unavailable.':match?.[1]==='RECONCILIATION_REQUIRED'?'Checkout requires review; no new charge was started.':'Checkout could not be confirmed. Retry the same tip.'},match?200:503);
 }
});
