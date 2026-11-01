// Canonical combined router: provider and DB entirely fake; actual DB accounting is tested with PostgreSQL.
import { assertEquals,assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext';
import { routeFinancial } from './financial-router.ts';
function harness(){
 const writes:{name:string;args?:Record<string,unknown>}[]=[];
 let fail=false;
 const session={id:'cs_fixture',amount_total:500,currency:'usd',livemode:false,status:'complete',payment_status:'paid',expires_at:1900000000,metadata:{reservation_id:'11111111-1111-4111-8111-111111111111',tip_id:'22222222-2222-4222-8222-222222222222'},payment_intent:{id:'pi_fixture',status:'succeeded',metadata:{},application_fee_amount:150,transfer_data:{destination:'acct_fixture'},latest_charge:'ch_fixture'}};
 const charge={id:'ch_fixture',amount:500,amount_refunded:250,currency:'usd',livemode:false,metadata:session.metadata,payment_intent:'pi_fixture'};
 const stripe={checkout:{sessions:{retrieve:async()=>session}},paymentIntents:{retrieve:async()=>({...session.payment_intent,amount:500,currency:'usd',livemode:false,metadata:session.metadata})},charges:{retrieve:async()=>charge},refunds:{retrieve:async()=>({id:'re_fixture',status:'succeeded'})},disputes:{retrieve:async()=>({id:'dp_fixture',status:'won'})},accounts:{retrieve:async()=>({id:'acct_fixture',payouts_enabled:true,charges_enabled:true,details_submitted:true,livemode:false})}} as unknown as Stripe;
 const db={rpc:async(name:string,args?:Record<string,unknown>)=>{if(fail)return {data:null,error:Error('down')};writes.push({name,args});return {data:'tip',error:null};}};
 const event=(type:string,object:unknown)=>({id:`evt_${type}`,type,created:1800000000,data:{object},livemode:false} as Stripe.Event);
 return {writes,session,charge,stripe,db,event,fail:()=>{fail=true;}};
}
Deno.test('canonical reserved AND legacy checkout, PI, refund, dispute and account routes use atomic boundaries',async()=>{
 const h=harness();
 for(const type of ['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','payment_intent.succeeded','payment_intent.payment_failed','charge.succeeded','charge.refunded','refund.created','refund.updated','charge.dispute.created','charge.dispute.closed']){
  await routeFinancial(h.event(type,{id:'fixture',object:type.startsWith('charge.')&&!type.includes('dispute')?'charge':'refund',charge:'ch_fixture'}),h.stripe,h.db);
  assertEquals(h.writes.at(-1)?.name,'followup_apply_financial_event');
 }
 h.session.metadata={reservation_id:'',tip_id:''};await routeFinancial(h.event('checkout.session.completed',{id:'cs_legacy'}),h.stripe,h.db);
 assertEquals((h.writes.at(-1)?.args?._e as Record<string,unknown>).session_id,'cs_fixture');
 await routeFinancial(h.event('account.updated',{id:'acct_fixture'}),h.stripe,h.db);assertEquals(h.writes.at(-1)?.name,'followup_sync_account');
});
Deno.test('provider and persistence failures propagate, never false ACK; unrelated events have no effect',async()=>{
 const h=harness();assertEquals(await routeFinancial(h.event('customer.created',{}),h.stripe,h.db),false);assertEquals(h.writes.length,0);
 h.fail();await assertRejects(()=>routeFinancial(h.event('payment_intent.succeeded',{id:'pi_fixture'}),h.stripe,h.db));
 h.stripe.charges.retrieve=()=>Promise.reject(Error('provider unavailable'));await assertRejects(()=>routeFinancial(h.event('refund.updated',{id:'re_fixture',charge:'ch_fixture'}),h.stripe,h.db));
});
