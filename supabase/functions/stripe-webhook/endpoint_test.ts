import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext';
let effects=0;let broken=false;
const backend=Deno.serve({port:8799},()=>{effects++;return broken?Response.json({message:'missing contract'},{status:500}):Response.json('payment-v3');});
Deno.env.set('STRIPE_SECRET_KEY','sk_test_local_fake');Deno.env.set('STRIPE_WEBHOOK_SECRET_PLATFORM','whsec_local_fake');Deno.env.set('SUPABASE_URL','http://localhost:8799');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','local-fake');
const serve=Deno.serve;let server:ReturnType<typeof Deno.serve>|undefined;
Deno.serve=((handler:Deno.ServeHandler)=>{server=serve({port:8798},handler);return server;}) as typeof Deno.serve;
await import('./index.ts');Deno.serve=serve;
const stripe=new Stripe('sk_test_local_fake',{apiVersion:'2024-12-18.acacia'});
Deno.test({name:'canonical signature verification occurs before ANY DB effect; missing schema fails retryably',sanitizeOps:false,sanitizeResources:false,async fn(){
 const body=JSON.stringify({id:'evt_fixture',type:'customer.created',created:1800000000,livemode:false,data:{object:{}}});
 let r=await fetch('http://localhost:8798',{method:'POST',headers:{'stripe-signature':'bad'},body});await r.text();assertEquals(r.status,400);assertEquals(effects,0);
 const sig=await stripe.webhooks.generateTestHeaderStringAsync({payload:body,secret:'whsec_local_fake'});
 r=await fetch('http://localhost:8798',{method:'POST',headers:{'stripe-signature':sig},body});await r.text();assertEquals(r.status,200);
 broken=true;r=await fetch('http://localhost:8798',{method:'POST',headers:{'stripe-signature':sig},body});await r.text();assertEquals(r.status,500);
 await server?.shutdown();await backend.shutdown();
}});
