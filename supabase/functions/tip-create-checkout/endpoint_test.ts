import {assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
let writes=0,contracts=0,contract=true,member=true,banned=false,pending=0;
const backend=Deno.serve({port:8795},req=>{
 const path=new URL(req.url).pathname;
 if(path.endsWith('/rpc/followup_payment_contract')){contracts++;return contract?Response.json('payment-v3'):Response.json({message:'Payment integration not installed'},{status:500});}
 if(req.method!=='GET')writes++;
 if(path==='/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
 if(path.includes('event_participants'))return member?Response.json({id:'membership'}):new Response(null,{status:204});
 if(path.includes('event_banned_guests'))return banned?Response.json({id:'ban'}):new Response(null,{status:204});
 if(path.includes('events'))return Response.json({id:'22222222-2222-4222-8222-222222222222',dj_id:'33333333-3333-4333-8333-333333333333',is_active:true,requests_status:'open',ended_at:null});
 if(path.includes('dj_payout_accounts'))return Response.json({stripe_account_id:'acct_fake',charges_enabled:true,payouts_enabled:true,livemode:false});
 if(path.includes('dj_tips'))return Response.json(pending?[{event_id:'22222222-2222-4222-8222-222222222222',status:'pending',gross_amount_cents:pending,created_at:'2020-01-01'}]:[]);
 return Response.json({message:'unexpected endpoint'},{status:500});
});
Deno.env.set('SUPABASE_URL','http://localhost:8795');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','local-fake');Deno.env.set('STRIPE_SECRET_KEY',' \trk_test_LocalFake123\n');Deno.env.set('APP_ORIGIN','https://fixture.invalid');
const serve=Deno.serve;let server:ReturnType<typeof Deno.serve>|undefined;
Deno.serve=((handler:Deno.ServeHandler)=>{server=serve({port:8794},handler);return server;}) as typeof Deno.serve;
await import('./index.ts');Deno.serve=serve;
Deno.test({name:'canonical readiness config/member/ban/cap checks are read-only and never contact Stripe',sanitizeOps:false,sanitizeResources:false,async fn(){
 const post=async()=>{const r=await fetch('http://localhost:8794',{method:'POST',headers:{authorization:'Bearer local-fake','content-type':'application/json'},body:JSON.stringify({event_id:'22222222-2222-4222-8222-222222222222',check_only:true})});return {status:r.status,body:await r.json()};};
 assertEquals((await post()).body.ready,true);assertEquals(contracts,1);
 Deno.env.set('STRIPE_SECRET_KEY','rk_live_LocalFake123');assertEquals((await post()).body.ready,false);
 Deno.env.set('STRIPE_SECRET_KEY','rk_test_');assertEquals((await post()).body.ready,false);
 Deno.env.set('STRIPE_SECRET_KEY','rk_test_LocalFake123');
 contract=false;assertEquals((await post()).status,503);contract=true;
 Deno.env.delete('APP_ORIGIN');assertEquals((await post()).body.ready,false);Deno.env.set('APP_ORIGIN','https://fixture.invalid');
 member=false;assertEquals((await post()).body.ready,false);member=true;
 banned=true;assertEquals((await post()).body.ready,false);banned=false;
 pending=10000;assertEquals((await post()).body.error_code,'TIP_LIMIT_REACHED');
 assertEquals(writes,0);
 await server?.shutdown();await backend.shutdown();
}});
