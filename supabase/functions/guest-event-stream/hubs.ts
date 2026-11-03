import {type Backend,type Peer,type Clock,clock as realClock} from './protocol.ts';
type Client={peer:Peer;session:string;expiry:number;revision:string;lastPing:number};
type Hub={event:string;clients:Set<Client>;timer?:unknown;running:boolean;abort:boolean};
export class Hubs{
 private hubs=new Map<string,Hub>();private count=0;private stopped=false;
 constructor(private backend:Backend,private clock:Clock=realClock){}
 get size(){return this.hubs.size;}
 get connections(){return this.count;}
 add(event:string,session:string,expiry:number,revision:string,peer:Peer):(()=>void)|null{
  if(this.stopped||this.count>=1024)return null;
  let h=this.hubs.get(event);if(!h){h={event,clients:new Set(),running:false,abort:false};this.hubs.set(event,h);}
  if(h.clients.size>=256)return null;
  const c:Client={peer,session,expiry,revision,lastPing:this.clock.now()};h.clients.add(c);this.count++;
  const hub=h;this.send(hub,c,{type:'ready',revision,resync:true});this.schedule(hub);
  return ()=>this.remove(hub,c);
 }
 touch(peer:Peer){for(const h of this.hubs.values())for(const c of h.clients)if(c.peer===peer)c.lastPing=this.clock.now();}
 private remove(h:Hub,c:Client){if(!h.clients.delete(c))return;this.count--;if(!h.clients.size){h.abort=true;if(h.timer!==undefined)this.clock.cancel(h.timer);h.timer=undefined;this.hubs.delete(h.event);}}
 private close(h:Hub,c:Client,code:number,reason:string){this.remove(h,c);try{c.peer.close(code,reason);}catch{/* closed socket */}}
 private send(h:Hub,c:Client,message:object){
  if(c.peer.bufferedAmount>65536){this.close(h,c,1013,'slow_client');return;}
  try{c.peer.send(JSON.stringify(message));}catch{this.close(h,c,1011,'transport_unavailable');}
 }
 private schedule(h:Hub){if(h.abort||h.running||h.timer!==undefined)return;h.timer=this.clock.later(()=>{h.timer=undefined;void this.poll(h);},2000);}
 private async poll(h:Hub){
  if(h.abort||h.running)return;h.running=true;
  const batch=[...h.clients];
  try{
   const r=await this.backend.poll(h.event,[...new Set(batch.map(c=>c.session))]);if(h.abort)return;
   if(!r.ok){for(const c of [...h.clients]){this.send(h,c,{type:'service_unavailable',retry:true});this.close(h,c,1013,'service_unavailable');}return;}
   if(r.event_id!==h.event||!/^\d+$/.test(r.revision)){throw new Error('invalid_backend');}
   const valid=new Set(r.valid_session_ids);
   // Validate/close entire batch BEFORE sending ANY new revision.
   for(const c of batch)if(h.clients.has(c)&&(!valid.has(c.session)||c.expiry<=this.clock.now()))this.close(h,c,1008,'session_unavailable');
   for(const c of batch)if(h.clients.has(c)){
    if(c.peer.bufferedAmount>65536){this.close(h,c,1013,'slow_client');continue;}
    if(this.clock.now()-c.lastPing>60000){this.close(h,c,1001,'heartbeat_timeout');continue;}
    if(BigInt(r.revision)>BigInt(c.revision)){c.revision=r.revision;this.send(h,c,{type:'invalidate',revision:r.revision,lifecycle:r.lifecycle});}
   }
  }catch{for(const c of [...h.clients]){this.send(h,c,{type:'service_unavailable',retry:true});this.close(h,c,1013,'service_unavailable');}}
  finally{h.running=false;this.schedule(h);}
 }
 shutdown(){this.stopped=true;for(const h of [...this.hubs.values()])for(const c of [...h.clients]){this.send(h,c,{type:'reconnect',resync:true});this.close(h,c,1001,'worker_shutdown');}}
}