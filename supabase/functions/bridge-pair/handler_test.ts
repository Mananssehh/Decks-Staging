import { createBridgePairHandler } from './handler.ts';
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Assertion failed');}
const req=(code='123456')=>new Request('http://local/pair',{method:'POST',headers:{'x-forwarded-for':'fixture-ip'},body:JSON.stringify({code})});
Deno.test('pair success preserves desktop contract',async()=>{
 const h=createBridgePairHandler(async()=>({ok:true,event_id:'fixture-event',ingest_token:'fixture-nonsecret'}),'http://local');
 const r=await h(req());equal(r.status,200);equal(await r.json(),{event_id:'fixture-event',ingest_token:'fixture-nonsecret',edge_function_url:'http://local/functions/v1/now-playing-ingest'});
});
Deno.test('claim errors fail closed',async()=>{const h=createBridgePairHandler(async()=>{throw new Error('DB');},'http://local');equal((await h(req())).status,500);});
Deno.test('DB rate denial maps 429',async()=>{const h=createBridgePairHandler(async()=>({ok:false,reason:'rate_limited'}),'http://local');equal((await h(req())).status,429);});
Deno.test('invalid input still counts as failed atomic claim',async()=>{
 let args:unknown;const h=createBridgePairHandler(async(...a)=>{args=a;return {ok:false};},'http://local');equal((await h(req('bad'))).status,404);equal(args,['','unverified-gateway']);
});
Deno.test('spoofed forwarding addresses cannot create new rate buckets',async()=>{
 const keys:string[]=[];const h=createBridgePairHandler(async(_c,key)=>{keys.push(key);return {ok:false};},'http://local');
 for(const address of ['1.2.3.4','5.6.7.8','x'.repeat(500)])await h(new Request('http://local/pair',{method:'POST',headers:{'x-forwarded-for':address},body:'{"code":"123456"}'}));
 equal(keys,['unverified-gateway','unverified-gateway','unverified-gateway']);
});
