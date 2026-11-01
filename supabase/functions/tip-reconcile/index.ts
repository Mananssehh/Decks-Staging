// Reconciles pending dj_tips rows against Stripe.
//
// DRY RUN BY DEFAULT: with no `apply: true` in the body this function only
// reports proposed counts and never writes a row.
//
// Classification uses the real Stripe state, never local heuristics:
//   session.status         -> open | complete | expired
//   session.payment_status -> paid | unpaid | no_payment_required
//   payment_intent.status  -> when a PI exists (delayed payment methods)
//
// Admin-only: caller must hold the `admin` role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getStripe, json } from "../_shared/stripe.ts";

import { paymentRpc,requirePaymentContract } from '../_shared/payment-contract.ts';
import { reconcileEvidence } from './reconciliation.ts';
async function evidenceDigest(e:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(e)));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}

export type Resolution = "expired" | "succeeded" | "failed" | "pending_live" | "unresolved";

export interface SessionView {
  status?: string | null;
  payment_status?: string | null;
  payment_intent_status?: string | null;
  payment_intent_id?: string | null;
  expires_at?: number | null;
}

/** Pure classifier — unit tested without Stripe. */
export function classify(view: SessionView | null): Resolution {
  if (!view) return "unresolved";
  const { status, payment_status, payment_intent_status } = view;

  if (status === "complete" && payment_status === "paid") return "succeeded";
  if (payment_intent_status === "succeeded") return "succeeded";

  if (status === "expired") {
    // An expired session can still have a PI that later succeeded (async).
    return payment_intent_status === "processing" ? "unresolved" : "expired";
  }
  if (status === "open") return "pending_live";
  if (status === "complete") {
    // Complete but unpaid == delayed payment method still in flight or failed.
    if (payment_intent_status === "processing" || payment_intent_status === "requires_action") return "pending_live";
    if (
      payment_intent_status === "canceled" ||
      payment_intent_status === "requires_payment_method"
    ) return "failed";
    return "unresolved";
  }
  return "unresolved";
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return json({error:'Service unavailable'},503);
 const db=createClient(url,key),token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return json({error:'Unauthorized'},401);
 const {data:u,error:a}=await db.auth.getUser(token);if(a||!u.user)return json({error:'Unauthorized'},401);
 try{
  if(!await paymentRpc<boolean>(db,'has_role',{_user_id:u.user.id,_role:'admin'}))return json({error:'Forbidden'},403);
  await requirePaymentContract(db);
  const body=await req.json();const apply=body.apply===true;
  const limit=body.limit??100;if(!Number.isInteger(limit)||limit<1||limit>1000)return json({error:'Invalid limit'},400);
  const {data:tips,error}=await db.from('dj_tips').select('id,stripe_checkout_session_id,created_at').eq('status','pending').order('created_at').limit(limit);if(error)throw error;
  const stripe=getStripe();const results=[];
  for(const row of tips??[]){
   const {data:r,error:re}=await db.from('followup_tip_reservations').select('id').eq('tip_id',row.id).maybeSingle();if(re)throw re;
   const e=await reconcileEvidence({...row,reservation_id:r?.id??null},{retrieve:id=>stripe.checkout.sessions.retrieve(id,{expand:['payment_intent']}),list:params=>stripe.checkout.sessions.list(params)});
   results.push({tip_id:row.id,resolution:e.kind});
   if(apply)await paymentRpc(db,'followup_apply_financial_event',{_e:{...e,event_id:`reconcile:${row.id}:${await evidenceDigest(e)}`,event_type:'reconciliation'}});
  }
  return json({dry_run:!apply,results,notifications:'domain_not_configured'});
 }catch{return json({error:'Authoritative reconciliation failed; amounts retained'},500);}
});
