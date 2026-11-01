import {assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
let writes=0;
const backend=Deno.serve({port:8795},req=>{
 const path=new URL(req.url).pathname;
 if(req.method!=='GET')writes++;
 if(path==='/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111'});
 if(path.includes('events'))return Response.json({id:'22222222-2222-4222-8222-222222222222',dj_id:'33333333-3333-4333-8333-333333333333',is_active:true,requests_status:'open',ended_at:null});
 if(path.includes('dj_payout_accounts'))return Response.json({charges_enabled:true,payouts_enabled:true,livemode:false});
 return Response.json({message:'uninstalled'},{status:500});
});
Deno.env.set('SUPABASE_URL','http://localhost:8795');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','local-fake');Deno.env.set('STRIPE_SECRET_KEY','sk_test_local_fake');
const serve=Deno.serve;let server:ReturnType<typeof Deno.serve>|undefined;
Deno.serve=((handler:Deno.ServeHandler)=>{server=serve({port:8794},handler);return server;}) as typeof Deno.serve;
await import('./index.ts');Deno.serve=serve;
Deno.test({name:'canonical readiness never reserves or contacts Stripe; checkout fails closed without installed contract',sanitizeOps:false,sanitizeResources:false,async fn(){
 const post=async(body:unknown)=>{const r=await fetch('http://localhost:8794',{method:'POST',headers:{authorization:'Bearer local-fake','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 assertEquals((await post({event_id:'22222222-2222-4222-8222-222222222222',check_only:true})).body.ready,true);assertEquals(writes,0);
 assertEquals((await post({event_id:'22222222-2222-4222-8222-222222222222',amount_cents:500,request_key:'11111111-1111-4111-8111-111111111111'})).status,503);
 await server?.shutdown();await backend.shutdown();
}});
