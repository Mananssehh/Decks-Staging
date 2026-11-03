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
