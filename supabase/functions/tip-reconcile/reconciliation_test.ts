import { assertEquals,assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext';
import { reconcileEvidence,type ReconcileProvider } from './reconciliation.ts';
const row={id:'tip',reservation_id:'reservation',stripe_checkout_session_id:null,created_at:'2026-01-01'};
const session={id:'cs_found',metadata:{reservation_id:'reservation'},status:'expired',payment_status:'unpaid',payment_intent:{id:'pi',status:'canceled'},amount_total:500,currency:'usd',livemode:false,expires_at:1800000000} as unknown as Stripe.Checkout.Session;
Deno.test('paginated discovery retrieves authoritative session; missing session never age releases',async()=>{
 let pages=0,reads=0;
 const p:ReconcileProvider={list:async params=>{pages++;return params.starting_after?{data:[session],has_more:false}:{data:[{...session,id:'cs_other',metadata:{}}],has_more:true};},retrieve:async()=>{reads++;return session;}};
 const e=await reconcileEvidence(row,p);assertEquals(pages,2);assertEquals(reads,1);assertEquals(e.kind,'expired');assertEquals(e.terminal,true);
 p.list=async()=>({data:[],has_more:false});const unresolved=await reconcileEvidence(row,p);assertEquals(unresolved.kind,'review');
 p.list=async()=>({data:[session,{...session,id:'cs_duplicate'}],has_more:false});await assertRejects(()=>reconcileEvidence(row,p));
});
Deno.test('processing PI and provider failure never release ambiguous funds',async()=>{
 const p:ReconcileProvider={list:async()=>({data:[session],has_more:false}),retrieve:async()=>({...session,payment_intent:{id:'pi',status:'processing'} as Stripe.PaymentIntent})};
 assertEquals((await reconcileEvidence(row,p)).kind,'review');
 p.retrieve=()=>Promise.reject(Error('timeout'));await assertRejects(()=>reconcileEvidence(row,p));
});
