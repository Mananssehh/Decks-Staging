import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createReservedCheckout, type CheckoutDeps, type Reservation } from "./checkout.ts";
const id='11111111-1111-4111-8111-111111111111';
const input={request_key:id,event_id:id,amount_cents:500};
function fixture(){
 const r:Reservation={id,tip_id:id,user_id:'verified-user',amount_cents:500,retry_until:'2030-01-01',state:'reserved',session_id:null,session_url:null,
 checkout_parameters:{destination:'acct_fake',livemode:false,fee:150,room_code:'ROOM',dj_name:'Fixture',event_name:'Fixture',expires_at:1900000000,song_request_id:null,success_url:'https://fixture.invalid/event/ROOM?tip=success',cancel_url:'https://fixture.invalid/event/ROOM?tip=cancel'}};
 const calls:{params:Record<string,unknown>;key:string}[]=[];let attachFail=false;let timeout=false;
 const session={id:'cs_fake',url:'https://checkout.stripe.com/c/pay/fake',expires_at:1900000000};
 const deps:CheckoutDeps={reserve:async user=>{assertEquals(user,'verified-user');return r;},
 create:async(params,options)=>{calls.push({params,key:options.idempotencyKey});if(timeout){timeout=false;throw Error('ambiguous timeout after provider accepted');}return session;},
 attach:async()=>{if(attachFail){attachFail=false;throw Error('db unavailable');}r.session_id=session.id;r.session_url=session.url;r.state='attached';},origin:'https://fixture.invalid',live:false,now:()=>1800000000000};
 return {r,calls,deps,failAttach:()=>{attachFail=true;},timeout:()=>{timeout=true;}};
}
Deno.test('session persistence failure retries exact params and stable Stripe idempotency key',async()=>{
 const f=fixture();f.failAttach();await assertRejects(()=>createReservedCheckout('verified-user',input,f.deps));
 await createReservedCheckout('verified-user',input,f.deps);
 assertEquals(f.calls.length,2);assertEquals(f.calls[0],f.calls[1]);assertEquals(f.calls[0].key,`decks-tip:${id}`);
 await createReservedCheckout('verified-user',input,f.deps);assertEquals(f.calls.length,2);
});
Deno.test('timeout retains reservation and reuses same provider request',async()=>{
 const f=fixture();f.timeout();await assertRejects(()=>createReservedCheckout('verified-user',input,f.deps));assertEquals(f.r.state,'reserved');
 await createReservedCheckout('verified-user',input,f.deps);assertEquals(f.calls[0],f.calls[1]);
});
Deno.test('past provider retry horizon refuses new provider call without releasing funds',async()=>{
 const f=fixture();f.r.retry_until='2020-01-01';await assertRejects(()=>createReservedCheckout('verified-user',input,f.deps));assertEquals(f.calls.length,0);assertEquals(f.r.state,'reserved');
});
Deno.test('invalid amounts and keys never reserve or create',async()=>{
 const f=fixture();for(const amount of [99,5001,101.5])await assertRejects(()=>createReservedCheckout('verified-user',{...input,amount_cents:amount},f.deps));assertEquals(f.calls.length,0);
});
Deno.test('runtime origin change does not mutate frozen redirects',async()=>{const f=fixture();f.failAttach();await assertRejects(()=>createReservedCheckout('verified-user',input,f.deps));f.deps.origin='https://changed.invalid';await createReservedCheckout('verified-user',input,f.deps);assertEquals(f.calls[0].params,f.calls[1].params);});
Deno.test('parallel creates after timeout and persistence failure use one fake-provider session',async()=>{
 const f=fixture();const sessions=new Map<string,{id:string;url:string;expires_at:number}>();let creates=0;
 f.deps.create=async(_,opts)=>{let s=sessions.get(opts.idempotencyKey);if(!s){creates++;s={id:'cs_once',url:'https://checkout.stripe.com/c/pay/once',expires_at:1900000000};sessions.set(opts.idempotencyKey,s);}return s;};
 await Promise.all(Array.from({length:10},()=>createReservedCheckout('verified-user',input,f.deps)));
 assertEquals(creates,1);assertEquals(sessions.size,1);
});
