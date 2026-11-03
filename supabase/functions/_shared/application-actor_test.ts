import {resolveApplicationActor,boundedBody,ActorError} from './application-actor.ts';
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Mismatch');}
const id='00000000-0000-4000-8000-000000000001',token='a'.repeat(64);
Deno.test('guest resolver validates server actor without Auth/provider calls',async()=>{let auth=0,guest=0;const r=await resolveApplicationActor(new Headers(),{event_id:id,guest:{event_id:id,token}},'catalog',{backendUrl:'https://ldxgejbzmpvsvozqmpfe.supabase.co',auth:async()=>{auth++;return id;},guest:async()=>{guest++;return {ok:true,actor_id:id,alias_ids:[id]};}});equal(r.id,id);equal(auth,0);equal(guest,1);});
Deno.test('real Auth resolver keeps existing token path',async()=>{let guest=0;const r=await resolveApplicationActor(new Headers({authorization:'Bearer real'}),{},'tip',{backendUrl:'https://other',auth:async t=>t==='real'?id:null,guest:async()=>{guest++;return {};}});equal(r.guest,false);equal(guest,0);});
Deno.test('invalid staging scope and forged guest fail before Auth/provider',async()=>{for(const body of [{guest:{event_id:id,token:id}},{event_id:'other',guest:{event_id:id,token}}]){let calls=0;try{await resolveApplicationActor(new Headers(),body,'tip',{backendUrl:'https://ldxgejbzmpvsvozqmpfe.supabase.co',auth:async()=>{calls++;return id;},guest:async()=>{calls++;return {};}});throw Error('accepted');}catch(e){equal(e instanceof ActorError,true);equal(calls,0);}}});
Deno.test('body bounded and canceled once, guest503 distinguished from401',async()=>{let canceled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(9000));},cancel(){canceled=true;}});try{await boundedBody(new Request('https://local',{method:'POST',body:stream}));throw Error('accepted');}catch(e){equal((e as ActorError).status,413);equal(canceled,true);}try{await resolveApplicationActor(new Headers(),{guest:{event_id:id,token}},'tip',{backendUrl:'https://ldxgejbzmpvsvozqmpfe.supabase.co',auth:async()=>null,guest:async()=>({ok:false,status:503})});}catch(e){equal((e as ActorError).status,503);}});

for(const [name,body] of [['malformed','{'],['empty',''],['null','null'],['array','[]'],['string','"x"'],['number','1'],['boolean','true'],['invalid UTF-8',new Uint8Array([0xc3,0x28])]] as const){
 Deno.test(`bounded body ${name} is typed 400 before actor/provider work`,async()=>{
  let auth=0,guest=0,provider=0,caught:unknown;
  try{const parsed=await boundedBody(new Request('https://local',{method:'POST',body}));await resolveApplicationActor(new Headers({authorization:'Bearer test'}),parsed,'tip',{backendUrl:'https://ldxgejbzmpvsvozqmpfe.supabase.co',auth:async()=>{auth++;return id;},guest:async()=>{guest++;return {ok:true,actor_id:id};}});provider++;}catch(e){caught=e;}
  equal(caught instanceof ActorError,true);equal((caught as ActorError).status,400);equal((caught as ActorError).code,'INVALID_REQUEST');equal([auth,guest,provider],[0,0,0]);
 });
}
Deno.test('missing body is typed 400',async()=>{let caught:unknown;try{await boundedBody(new Request('https://local',{method:'POST'}));}catch(e){caught=e;}equal((caught as ActorError).status,400);});
Deno.test('8192 byte object accepted, 8193 bytes rejected with typed 413 before dependencies',async()=>{
 const body=JSON.stringify({x:'a'.repeat(8184)});equal(new TextEncoder().encode(body).length,8192);equal((await boundedBody(new Request('https://local',{method:'POST',body}))).x,'a'.repeat(8184));
 let caught:unknown,calls=0;try{await boundedBody(new Request('https://local',{method:'POST',body:body+' '}));calls++;}catch(e){caught=e;}equal((caught as ActorError).status,413);equal((caught as ActorError).code,'PAYLOAD_TOO_LARGE');equal(calls,0);
});