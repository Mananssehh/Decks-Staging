import {Hubs} from './hubs.ts';
import {Connection} from './connection.ts';
import {createHandler} from './handler.ts';
import {authFrame,type Backend,type Clock,type Peer,type PollResult} from './protocol.ts';
const event='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',token='a'.repeat(64);
function eq(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`Mismatch ${JSON.stringify(a)} != ${JSON.stringify(b)}`);}
class Time implements Clock{time=10000;seq=0;tasks=new Map<number,{fn:()=>void;at:number}>();now(){return this.time;}later(fn:()=>void,ms:number){const id=++this.seq;this.tasks.set(id,{fn,at:this.time+ms});return id;}cancel(t:unknown){this.tasks.delete(t as number);}async advance(ms:number){this.time+=ms;for(const [id,t] of [...this.tasks])if(t.at<=this.time){this.tasks.delete(id);t.fn();}for(let i=0;i<20;i++)await Promise.resolve();}}
class Socket implements Peer{bufferedAmount=0;messages:Record<string,unknown>[]=[];closed:{code:number;reason:string}[]=[];send(m:string){this.messages.push(JSON.parse(m));}close(code:number,reason:string){this.closed.push({code,reason});}}
function setup(){const time=new Time();let revision='1',polls=0;const valid=new Set([event,other]);let result:PollResult|undefined;const backend:Backend={auth:async(e)=>({ok:true,event_id:e,session_id:event,actor_id:other,expires_at:new Date(time.now()+120000).toISOString(),revision}),poll:async(e,ids)=>{polls++;return result??{ok:true,event_id:e,revision,valid_session_ids:ids.filter(id=>valid.has(id)),lifecycle:'live'};}};const hubs=new Hubs(backend,time);return {time,backend,hubs,valid,setRevision:(r:string)=>{revision=r;},setResult:(r:PollResult)=>{result=r;},polls:()=>polls};}
Deno.test('bounded auth frame rejects UUID-only, unknown fields, binary and oversized frames',()=>{eq(authFrame(JSON.stringify({type:'auth',event_id:event})),null);eq(authFrame(JSON.stringify({type:'auth',event_id:event,token,publish:true})),null);eq(authFrame(new Uint8Array(4)),null);eq(authFrame(' '.repeat(4097)),null);});
Deno.test('100 sockets share one event poller with trailing revisions and last-close cleanup',async()=>{
 const s=setup(),sockets=Array.from({length:100},()=>new Socket());const removes=sockets.map(p=>s.hubs.add(event,event,s.time.now()+120000,'1',p));eq(s.hubs.connections,100);eq(s.hubs.size,1);eq(s.time.tasks.size,1);
 s.setRevision('5');await s.time.advance(2000);eq(s.polls(),1);eq(sockets.every(p=>p.messages[1]?.revision==='5'),true);
 s.setRevision('6');await s.time.advance(2000);eq(s.polls(),2);eq(sockets[0].messages[2]?.revision,'6');
 removes.forEach(f=>f?.());eq(s.hubs.connections,0);eq(s.time.tasks.size,0);await s.time.advance(2000);eq(s.polls(),2);
});
Deno.test('different events own separate pollers, at most one inflight and cleanup during poll',async()=>{
 const s=setup();let resolve:(r:PollResult)=>void=()=>{};s.backend.poll=()=>new Promise(r=>{resolve=r;});
 const off=s.hubs.add(event,event,s.time.now()+120000,'1',new Socket());await s.time.advance(2000);eq(s.time.tasks.size,0);await s.time.advance(6000);eq(s.time.tasks.size,0);off?.();resolve({ok:true,event_id:event,revision:'9',valid_session_ids:[event],lifecycle:'live'});await s.time.advance(0);eq(s.hubs.size,0);eq(s.time.tasks.size,0);
 const x=setup();x.hubs.add(event,event,x.time.now()+120000,'1',new Socket());x.hubs.add(other,other,x.time.now()+120000,'1',new Socket());eq(x.time.tasks.size,2);x.hubs.shutdown();eq(x.time.tasks.size,0);
});
Deno.test('ban claim revoke invalid client closed before changed revision, expired closes too',async()=>{
 const s=setup(),bad=new Socket(),good=new Socket();s.hubs.add(event,event,s.time.now()+120000,'1',bad);s.hubs.add(event,other,s.time.now()+120000,'1',good);s.valid.delete(event);s.setRevision('2');await s.time.advance(2000);
 eq(bad.closed[0].code,1008);eq(bad.messages.length,1);eq(good.messages[1].revision,'2');s.hubs.shutdown();
 const x=setup(),expired=new Socket();x.hubs.add(event,event,x.time.now()+1000,'1',expired);x.setRevision('8');await x.time.advance(2000);eq(expired.closed[0].code,1008);eq(expired.messages.length,1);
});
Deno.test('503 and network failure send retry hint, never invalid-auth, stop polling',async()=>{for(const network of [false,true]){const s=setup(),p=new Socket();if(network)s.backend.poll=async()=>{throw Error('network');};else s.setResult({ok:false,status:503});s.hubs.add(event,event,s.time.now()+120000,'1',p);await s.time.advance(2000);eq(p.closed[0].code,1013);eq(p.messages[1],{type:'service_unavailable',retry:true});eq(s.time.tasks.size,0);}});
Deno.test('backpressure closes slow client without new invalidation, capacity bounded 256/event',async()=>{const s=setup(),p=new Socket();s.hubs.add(event,event,s.time.now()+120000,'1',p);p.bufferedAmount=65537;s.setRevision('2');await s.time.advance(2000);eq(p.closed[0].code,1013);eq(p.messages.length,1);for(let i=0;i<256;i++)s.hubs.add(event,event,s.time.now()+120000,'1',new Socket());eq(s.hubs.add(event,event,s.time.now()+120000,'1',new Socket()),null);s.hubs.shutdown();});
Deno.test('worker shutdown hints reconnect; reconnect ready requires full snapshot resync',()=>{const s=setup(),p=new Socket();s.hubs.add(event,event,s.time.now()+120000,'1',p);s.hubs.shutdown();eq(p.messages[1],{type:'reconnect',resync:true});eq(p.closed[0].code,1001);const next=setup(),reconnected=new Socket();next.hubs.add(event,event,next.time.now()+120000,'7',reconnected);eq(reconnected.messages[0],{type:'ready',revision:'7',resync:true});next.hubs.shutdown();});
Deno.test('auth deadline, cross-event/expired/revoked response rejected and no publish relayed',async()=>{
 for(const variant of ['timeout','cross','expired','revoked','publish']){const s=setup(),p=new Socket();if(variant==='cross')s.backend.auth=async()=>({ok:true,event_id:other,session_id:event,actor_id:other,expires_at:new Date(s.time.now()+10000).toISOString(),revision:'1'});if(variant==='expired')s.backend.auth=async()=>({ok:true,event_id:event,session_id:event,actor_id:other,expires_at:new Date(0).toISOString(),revision:'1'});if(variant==='revoked')s.backend.auth=async()=>({ok:false,status:401});const c=new Connection(p,s.backend,s.hubs,s.time);if(variant==='timeout')await s.time.advance(5000);else await c.message(JSON.stringify({type:'auth',event_id:event,token}));if(variant==='publish')await c.message('{"type":"publish","payload":"never"}');eq(p.closed[0]?.code,1008);eq(p.messages.some(m=>m.type==='publish'),false);c.cleanup();eq(s.time.tasks.size,0);}
});
Deno.test('after auth only bounded ping/pong; reauth closes, raw token absent from state',async()=>{const s=setup(),p=new Socket(),c=new Connection(p,s.backend,s.hubs,s.time);await c.message(JSON.stringify({type:'auth',event_id:event,token}));eq(JSON.stringify(c).includes(token),false);await c.message('{"type":"ping"}');eq(p.messages[1],{type:'pong'});await c.message(JSON.stringify({type:'auth',event_id:event,token}));eq(p.closed[0].code,1008);});
Deno.test('auth backend503 preserves credential/retry semantics',async()=>{const s=setup(),p=new Socket();s.backend.auth=async()=>({ok:false,status:503});const c=new Connection(p,s.backend,s.hubs,s.time);await c.message(JSON.stringify({type:'auth',event_id:event,token}));eq(p.closed[0].code,1013);eq(p.messages[0],{type:'service_unavailable',retry:true});});
Deno.test('GET upgrade only, exact staging, token URL and subprotocol rejected without upgrade',()=>{
 const s=setup();let upgrades=0;const upgrade=()=>{upgrades++;return {socket:Object.assign(new Socket(),{onmessage:null,onclose:null,onerror:null}),response:new Response('upgraded')};};
 const handler=createHandler('https://ldxgejbzmpvsvozqmpfe.supabase.co',s.backend,s.hubs,upgrade);
 eq(handler(new Request('https://local',{method:'POST'})).status,405);eq(handler(new Request('https://local')).status,426);eq(handler(new Request('https://local?token=secret',{headers:{upgrade:'websocket'}})).status,400);eq(handler(new Request('https://local',{headers:{upgrade:'websocket','sec-websocket-protocol':'secret'}})).status,400);eq(createHandler('https://wrong',s.backend,s.hubs,upgrade)(new Request('https://local')).status,503);eq(upgrades,0);
});
Deno.test('native adapter path upgrades then auths, closes cleanly and releases deadline/hub timers',async()=>{
 const s=setup(),socket=Object.assign(new Socket(),{onmessage:null as ((e:{data:unknown})=>void)|null,onclose:null as (()=>void)|null,onerror:null as (()=>void)|null});
 const handler=createHandler('https://ldxgejbzmpvsvozqmpfe.supabase.co',s.backend,s.hubs,()=>({socket,response:new Response('upgraded')}),s.time);
 eq(handler(new Request('https://local',{headers:{upgrade:'websocket'}})).status,200);
 socket.onmessage?.({data:JSON.stringify({type:'auth',event_id:event,token})});for(let i=0;i<20;i++)await Promise.resolve();eq(socket.messages[0],{type:'ready',revision:'1',resync:true});eq(s.hubs.connections,1);
 socket.onclose?.();eq(s.hubs.connections,0);eq(s.time.tasks.size,0);
});
Deno.test('bounded connection rollover gives reconnect resync and cleans up instead of assuming worker lifetime',async()=>{
 const s=setup(),p=new Socket(),c=new Connection(p,s.backend,s.hubs,s.time);await c.message(JSON.stringify({type:'auth',event_id:event,token}));await s.time.advance(120000);eq(p.messages.some(m=>m.type==='reconnect'&&m.resync===true),true);eq(p.closed[0].code,1001);eq(s.hubs.connections,0);eq(s.time.tasks.size,0);
});