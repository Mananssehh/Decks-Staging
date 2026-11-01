import type Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext';
import { paymentRpc,type RpcClient } from '../_shared/payment-contract.ts';
import { sessionEvidence,type Evidence } from '../_shared/payment-evidence.ts';
const id=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id??null;
export async function routeFinancial(event:Stripe.Event,stripe:Stripe,db:RpcClient):Promise<boolean>{
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(event)));
 const fingerprint=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
 const base:Evidence={event_id:event.id,event_type:event.type,created:event.created,event_fingerprint:fingerprint};
 let e:Evidence;
 if(event.type==='account.updated'){
  const supplied=event.data.object as Stripe.Account;
  // Retrieve current authoritative account, not potentially stale out-of-order event snapshot.
  const a=await stripe.accounts.retrieve(supplied.id);
  await paymentRpc(db,'followup_sync_account',{_e:{...base,account_id:a.id,payouts_enabled:a.payouts_enabled,charges_enabled:a.charges_enabled,details_submitted:a.details_submitted,livemode:a.livemode}});
  return true;
 }
 if(event.type.startsWith('checkout.session.')){
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))return false;
  const s=await stripe.checkout.sessions.retrieve((event.data.object as Stripe.Checkout.Session).id,{expand:['payment_intent']});
  e=sessionEvidence(s);
  if(event.type==='checkout.session.async_payment_failed'&&typeof s.payment_intent==='object'&&s.payment_intent?.status==='canceled'){e.kind='failed';e.terminal=true;}
 }else if(event.type.startsWith('payment_intent.')){
  if(!['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled'].includes(event.type))return false;
  const p=await stripe.paymentIntents.retrieve((event.data.object as Stripe.PaymentIntent).id);
  e={reservation_id:p.metadata.reservation_id??null,tip_id:p.metadata.tip_id??null,payment_intent:p.id,charge_id:id(p.latest_charge),amount_cents:p.amount,currency:p.currency,livemode:p.livemode,destination:id(p.transfer_data?.destination),fee:p.application_fee_amount,
  kind:p.status==='succeeded'?'paid':p.status==='canceled'?'failed':'pending',terminal:p.status==='canceled'};
 }else if(['charge.succeeded','charge.refunded','refund.created','refund.updated','charge.dispute.created','charge.dispute.closed'].includes(event.type)){
  const o=event.data.object as Stripe.Charge|Stripe.Refund|Stripe.Dispute;
  const chargeId=o.object==='charge'?o.id:id((o as Stripe.Refund|Stripe.Dispute).charge);
  if(!chargeId)throw Error('Missing charge evidence');
  const ch=await stripe.charges.retrieve(chargeId,event.account?{stripeAccount:event.account}:undefined);
  e={reservation_id:ch.metadata?.reservation_id??null,tip_id:ch.metadata?.tip_id??null,payment_intent:id(ch.payment_intent),charge_id:ch.id,amount_cents:ch.amount,currency:ch.currency,livemode:ch.livemode,kind:'charge',refunded_amount_cents:ch.amount_refunded};
  if(event.type==='charge.refunded')e.kind='refund';
  if(event.type.startsWith('refund.')){
   const refund=await stripe.refunds.retrieve(o.id,event.account?{stripeAccount:event.account}:undefined);
   if(refund.status==='succeeded'){e.kind='refund';e.refund_id=refund.id;}
  }
  if(event.type.startsWith('charge.dispute.')){
   const d=await stripe.disputes.retrieve(o.id,event.account?{stripeAccount:event.account}:undefined);
   e.kind=d.status==='won'?'dispute_won':d.status==='lost'?'dispute_lost':'dispute_open';e.dispute_id=d.id;
  }
 }else return false;
 await paymentRpc(db,'followup_apply_financial_event',{_e:{...base,...e}});return true;
}
