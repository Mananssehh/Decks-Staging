import type Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext';
export type Evidence=Record<string,string|number|boolean|null>;
const id=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id??null;
export function sessionEvidence(s:Stripe.Checkout.Session):Evidence {
 const pi=typeof s.payment_intent==='object'?s.payment_intent:null;
 return {reservation_id:s.metadata?.reservation_id??pi?.metadata?.reservation_id??null,tip_id:s.metadata?.tip_id??pi?.metadata?.tip_id??null,
 session_id:s.id,payment_intent:id(s.payment_intent),charge_id:pi?id(pi.latest_charge):null,
 amount_cents:s.amount_total,currency:s.currency,livemode:s.livemode,expires_at:s.expires_at,
 destination:pi?id(pi.transfer_data?.destination):null,fee:pi?.application_fee_amount??null,
 kind:pi?.status==='succeeded'||s.status==='complete'&&s.payment_status==='paid'?'paid':s.status==='expired'?'expired':'pending',
 terminal:s.status==='expired'&&(!pi||['canceled','requires_payment_method'].includes(pi.status))};
}
