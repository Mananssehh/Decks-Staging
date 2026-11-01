import type Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext';
import { sessionEvidence,type Evidence } from '../stripe-webhook/financial-router.ts';
export interface ReconcileRow {id:string;stripe_checkout_session_id:string|null;reservation_id?:string|null;created_at:string}
export interface ReconcileProvider {
 retrieve:(id:string)=>Promise<Stripe.Checkout.Session>;
 list:(params:{limit:100;starting_after?:string;created:{gte:number}})=>Promise<{data:Stripe.Checkout.Session[];has_more:boolean}>;
}
// A complete paginated search can discover a session, never prove a timed-out create did not exist.
export async function reconcileEvidence(row:ReconcileRow,provider:ReconcileProvider):Promise<Evidence>{
 let s:Stripe.Checkout.Session|undefined;
 if(row.stripe_checkout_session_id)s=await provider.retrieve(row.stripe_checkout_session_id);
 else if(row.reservation_id){
  let cursor:string|undefined;const matches:Stripe.Checkout.Session[]=[];
  for(let page=0;page<100;page++){
   const batch=await provider.list({limit:100,starting_after:cursor,created:{gte:Math.floor(Date.parse(row.created_at)/1000)-60}});
   matches.push(...batch.data.filter(x=>x.metadata?.reservation_id===row.reservation_id));
   if(!batch.has_more)break;
   const next=batch.data.at(-1)?.id;if(!next||next===cursor)throw Error('Invalid pagination');cursor=next;
   if(page===99)throw Error('Pagination incomplete');
  }
  if(matches.length>1)throw Error('Multiple sessions require financial review');
  if(matches.length===1)s=await provider.retrieve(matches[0].id);
 }
 if(!s)return {tip_id:row.id,reservation_id:row.reservation_id??null,kind:'review',reason:'no_authoritative_session_evidence'};
 const e=sessionEvidence(s);
 if(e.kind==='expired'&&!e.terminal)return {...e,kind:'review',reason:'payment_intent_nonterminal'};
 return {...e,tip_id:row.id,reservation_id:row.reservation_id??e.reservation_id};
}
