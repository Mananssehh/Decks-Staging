// SOURCE ONLY until independent payment-v3 installation; combined reserved + legacy router.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getStripe,json,corsHeaders } from '../_shared/stripe.ts';
import { requirePaymentContract } from '../_shared/payment-contract.ts';
import { routeFinancial } from './financial-router.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const secrets=[Deno.env.get('STRIPE_WEBHOOK_SECRET_PLATFORM'),Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT')].filter((s):s is string=>!!s);
 const signature=req.headers.get('stripe-signature');if(!signature)return json({error:'Missing signature'},400);
 if(!secrets.length)return json({error:'Webhook not configured'},503);
 try{
  const stripe=getStripe(),raw=await req.text();let event=null;
  for(const secret of secrets){try{event=await stripe.webhooks.constructEventAsync(raw,signature,secret);break;}catch{/* Try the other configured signing secret. */}}
  if(!event)return json({error:'Invalid signature'},400);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return json({error:'Service unavailable'},503);
  const db=createClient(url,key);await requirePaymentContract(db);
  await routeFinancial(event,stripe,db);
  return json({received:true,notifications:'domain_not_configured'});
 }catch{return json({error:'Evidence could not be persisted; retry required'},500);}
});
