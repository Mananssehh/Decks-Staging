import {createHandler,staging,validate} from './handler.ts';
const url='https://ldxgejbzmpvsvozqmpfe.supabase.co';
const token='a'.repeat(64),id='00000000-0000-4000-8000-000000000001';
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
Deno.test('only exact staging host accepted',()=>{for(const u of [undefined,'http://ldxgejbzmpvsvozqmpfe.supabase.co',url+'.evil',url+':123','https://x:y@ldxgejbzmpvsvozqmpfe.supabase.co',url+'/wrong'])equal(staging(u),false);equal(staging(url),true);});
Deno.test('UUID alone never authorizes',()=>{equal(validate('snapshot',{event_id:id}),null);equal(validate('join',{bootstrap:id,code:'ROOM1',nickname:'Guest'}),null);});
Deno.test('desired vote state exact -1/0/1',()=>{for(const value of [-2,2,null,'1'])equal(validate('vote',{event_id:id,token,request_id:id,value}),null);for(const value of [-1,0,1])equal(validate('vote',{event_id:id,token,request_id:id,value})?.value,value);});
Deno.test('unknown fields stripped, analytics credentials never forwarded',()=>{equal(validate('funnel',{event_id:id,token,event_type:'guest_prompt_shown',metadata:{token}}),{event_id:id,token,event_type:'guest_prompt_shown'});});
Deno.test('oversized streaming body canceled without content length',async()=>{let canceled=false,calls=0;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(4096));},cancel(){canceled=true;}});const h=createHandler({url,rpc:async()=>{calls++;return {data:{ok:true},error:null};}});const r=await h(new Request('https://local',{method:'POST',body:stream}));equal(r.status,413);equal(canceled,true);equal(calls,0);});
Deno.test('one call only, typed 429 preserved, no retry',async()=>{let calls=0;const h=createHandler({url,rpc:async()=>{calls++;return {data:{ok:false,status:429,error:'guest_rate_limited'},error:null};}});const r=await h(new Request('https://local',{method:'POST',body:JSON.stringify({action:'snapshot',payload:{event_id:id,token}})}));equal(r.status,429);equal(calls,1);});
Deno.test('error objects never leak upstream details',async()=>{const h=createHandler({url,rpc:async()=>({data:null,error:{token}})});const r=await h(new Request('https://local',{method:'POST',body:'{"action":"contract"}'}));equal(r.status,503);equal((await r.text()).includes(token),false);});
Deno.test('input type and request bounds',()=>{equal(validate('request',{event_id:id,token,idempotency_key:id,source_platform:'itunes',source_song_id:'1',title:'x',artist:'a',duration_ms:1.5}),null);equal(validate('profile',{event_id:id,token,nickname:'x'.repeat(25)}),null);});

Deno.test('malformed, nonobject and invalid UTF-8 return 400 without app calls',async()=>{
 let calls=0;const h=createHandler({url,rpc:async()=>{calls++;return {data:{ok:true},error:null};}});
 for(const body of ['{','null','[]','true','"x"',new Uint8Array([0xff])]){const r=await h(new Request('https://local',{method:'POST',body}));equal(r.status,400);equal((await r.json()).error,'invalid_json');}equal(calls,0);
});

Deno.test('upstream failures log only allowlisted operation, SQLSTATE, category and correlation ID',async()=>{
 const bootstrap='b'.repeat(64),logs:Record<string,string|number>[]=[];
 const cases:[unknown,number|undefined,string,string][]=[
  [{code:'57014',message:`canceling statement ${token}`,details:bootstrap,hint:'GUESTQA'},500,'57014','statement_timeout'],
  [{code:'PGRST003',message:'Timed out acquiring connection from connection pool.'},504,'PGRST003','pool_timeout'],
  [{code:'55P03',message:'lock'},500,'55P03','lock_timeout'],
  [{code:`x${token}`,message:token},undefined,'none','transport'],
 ];
 for(const [error,status,code,category] of cases){
  const h=createHandler({url,id:()=>'cid-1',log:e=>logs.push(e),rpc:async()=>({data:null,error,status})});
  const r=await h(new Request('https://local',{method:'POST',body:JSON.stringify({action:'vote',payload:{event_id:id,token,request_id:id,value:1}})}));
  equal(r.status,503);equal(await r.json(),{ok:false,status:503,error:'upstream_unavailable'});equal(r.headers.get('x-correlation-id'),'cid-1');
  const e=logs.at(-1)!;equal(Object.keys(e).sort(),['action','category','cid','evt','ms','sqlstate','upstream_status']);
  equal([e.action,e.sqlstate,e.category],['vote',code,category]);
 }
 const text=JSON.stringify(logs);for(const s of [token,bootstrap,'GUESTQA','canceling','Timed out',id])equal(text.includes(s),false);
});
Deno.test('typed backend refusals and successes are not logged as upstream failures; throws are',async()=>{
 const logs:unknown[]=[];let mode='typed';
 const h=createHandler({url,log:e=>logs.push(e),rpc:async()=>{if(mode==='throw')throw Error(token);return mode==='ok'?{data:{ok:true},error:null}:{data:{ok:false,status:401,error:'invalid_session'},error:null};}});
 const req=()=>new Request('https://local',{method:'POST',body:JSON.stringify({action:'snapshot',payload:{event_id:id,token}})});
 equal((await h(req())).status,401);mode='ok';equal((await h(req())).status,200);equal(logs.length,0);
 mode='throw';const r=await h(req());equal(r.status,503);equal(logs.length,1);equal(JSON.stringify(logs).includes(token),false);
});
Deno.test('logger failure never changes public response',async()=>{
 const h=createHandler({url,log:()=>{throw Error('sink down');},rpc:async()=>({data:null,error:{code:'57014'}})});
 equal((await h(new Request('https://local',{method:'POST',body:'{"action":"contract"}'}))).status,503);
});

const PUBLISHED='https://decks-staging.lovable.app',PREVIEW='https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app';
const REJECTED=['https://encore-request-rally.lovable.app','https://linku99.com','https://www.linku99.com','https://decks-staging.lovable.app.evil.com','https://evil-decks-staging.lovable.app','https://x.decks-staging.lovable.app','http://decks-staging.lovable.app','https://decks-staging.lovable.app:8443','https://decks-staging.lovable.app/','https://DECKS-STAGING.lovable.app','https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app.evil.com','https://id-preview-evil--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app','https://lovable.app','null','*',''];
function corsHandler(){let calls=0;const h=createHandler({url,rpc:async()=>{calls++;return {data:{ok:true,contract:'guest-integration-v1'},error:null};}});return {h,calls:()=>calls};}
const post=(origin?:string)=>new Request('https://local',{method:'POST',body:'{"action":"contract"}',headers:origin===undefined?{}:{origin}});
const options=(origin?:string)=>new Request('https://local',{method:'OPTIONS',headers:origin===undefined?{}:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,apikey,x-client-info'}});
Deno.test('published and preview staging origins are echoed exactly with Vary: Origin',async()=>{
 for(const origin of [PUBLISHED,PREVIEW]){const s=corsHandler();const r=await s.h(post(origin));equal(r.status,200);equal(r.headers.get('access-control-allow-origin'),origin);equal(r.headers.get('vary'),'Origin');equal(s.calls(),1);}
});
Deno.test('production, malicious suffix/subdomain/scheme/port and null origins are refused before any backend call',async()=>{
 for(const origin of REJECTED){const s=corsHandler();const r=await s.h(post(origin));equal(r.status,403);equal(r.headers.get('access-control-allow-origin'),null);equal(r.headers.get('vary'),'Origin');equal(await r.json(),{ok:false,status:403,error:'origin_not_allowed'});equal(s.calls(),0);}
});
Deno.test('rejected origin never consumes the request body',async()=>{
 let pulled=false;const stream=new ReadableStream({pull(c){pulled=true;c.enqueue(new Uint8Array(16));c.close();}},{highWaterMark:0});
 const s=corsHandler();const r=await s.h(new Request('https://local',{method:'POST',body:stream,headers:{origin:'https://linku99.com'}}));equal(r.status,403);equal(pulled,false);equal(s.calls(),0);
});
Deno.test('missing origin gets no CORS grant and no wildcard; staging and validation still enforced',async()=>{
 const s=corsHandler();const r=await s.h(post());equal(r.status,200);equal(r.headers.get('access-control-allow-origin'),null);equal(r.headers.get('vary'),'Origin');
 const off=createHandler({url:'https://prod.supabase.co',rpc:async()=>({data:{ok:true},error:null})});
 const denied=await off(post(PUBLISHED));equal(denied.status,503);equal((await denied.json()).error,'guest_unavailable');equal(denied.headers.get('access-control-allow-origin'),PUBLISHED);
 const bad=await s.h(new Request('https://local',{method:'POST',body:'{"action":"snapshot","payload":{}}',headers:{origin:PUBLISHED}}));equal(bad.status,400);equal(bad.headers.get('access-control-allow-origin'),PUBLISHED);
});
Deno.test('allowed OPTIONS preflight returns 204 with exact origin, methods and headers',async()=>{
 for(const origin of [PUBLISHED,PREVIEW]){const s=corsHandler();const r=await s.h(options(origin));equal(r.status,204);equal(r.headers.get('access-control-allow-origin'),origin);equal(r.headers.get('access-control-allow-methods'),'POST,OPTIONS');equal(r.headers.get('access-control-allow-headers'),'authorization,content-type,apikey,x-client-info');equal(r.headers.get('vary'),'Origin');equal(await r.text(),'');equal(s.calls(),0);}
});
Deno.test('rejected OPTIONS preflight returns 403 without any allow-origin',async()=>{
 for(const origin of REJECTED){const s=corsHandler();const r=await s.h(options(origin));equal(r.status,403);equal(r.headers.get('access-control-allow-origin'),null);equal(r.headers.get('vary'),'Origin');equal(s.calls(),0);}
 const s=corsHandler();const r=await s.h(options());equal(r.status,204);equal(r.headers.get('access-control-allow-origin'),null);
});
