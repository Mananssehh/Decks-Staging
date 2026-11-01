import { createJoinHandler } from './handler.ts';
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
const req=(body:unknown,auth=true)=>new Request('http://local/join',{method:'POST',headers:auth?{Authorization:'Bearer fixture-token'}:{},body:JSON.stringify(body)});
Deno.test('verified session token forwarded, never caller identity',async()=>{
 let args:unknown;
 const handler=createJoinHandler({authenticate:async()=> 'verified-id',join:async(...a)=>{args=a;return {ok:true};}});
 equal((await handler(req({code:'ROOM01',nickname:'Nick'}))).status,200);equal(args,['fixture-token','ROOM01','Nick']);
});
Deno.test('identity injection is chargeable invalid attempt',async()=>{
 let code:unknown;
 const handler=createJoinHandler({authenticate:async()=> 'verified-id',join:async(_t,c)=>{code=c;return {ok:false,reason:'unavailable'};}});
 equal(await (await handler(req({code:'ROOM01',user_id:'forged'}))).json(),{ok:false,reason:'unavailable'});equal(code,'');
});
Deno.test('no token or invalid session never calls admission',async()=>{
 let n=0;const handler=createJoinHandler({authenticate:async()=>null,join:async()=>{n++;}});
 equal((await handler(req({code:'ROOM01'},false))).status,401);equal((await handler(req({code:'ROOM01'}))).status,401);equal(n,0);
});
Deno.test('DB errors fail closed with generic answer',async()=>{
 const handler=createJoinHandler({authenticate:async()=> 'verified',join:async()=>{throw new Error('database failed');}});
 const response=await handler(req({code:'ROOM01'}));equal(response.status,500);equal(await response.json(),{ok:false,reason:'unavailable'});
});
Deno.test('100 same-network identities and retries have no flat IP restriction',async()=>{
 let n=0;const handler=createJoinHandler({authenticate:async()=> 'verified',join:async()=>{n++;return {ok:true};}});
 const results=await Promise.all(Array.from({length:200},()=>handler(req({code:'ROOM01'}))));equal(results.every(r=>r.status===200),true);equal(n,200);
});
