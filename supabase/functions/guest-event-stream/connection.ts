import {authFrame,frame,validAuth,type Backend,type Peer,type Clock,clock as realClock} from './protocol.ts';
import {Hubs} from './hubs.ts';
export class Connection{
 private state:'waiting'|'authenticating'|'ready'|'closed'='waiting';private timer:unknown;private remove?:()=>void;private pingAt=-Infinity;
 constructor(private peer:Peer,private backend:Backend,private hubs:Hubs,private clock:Clock=realClock){this.timer=clock.later(()=>this.close(1008,'auth_timeout'),5000);}
 private close(code:number,reason:string){this.cleanup();try{this.peer.close(code,reason);}catch{/* closed */}}
 cleanup(){this.state='closed';this.clock.cancel(this.timer);this.remove?.();this.remove=undefined;}
 async message(data:unknown){
  if(this.state==='closed')return;
  if(this.state==='ready'){
   const x=frame(data);if(!x||Object.keys(x).length!==1||!['ping','pong'].includes(String(x.type)))return this.close(1008,'receive_only');
   if(this.clock.now()-this.pingAt<1000)return this.close(1008,'ping_rate');this.pingAt=this.clock.now();this.hubs.touch(this.peer);
   if(this.peer.bufferedAmount>65536)return this.close(1013,'slow_client');
   if(x.type==='ping')try{this.peer.send('{"type":"pong"}');}catch{this.close(1011,'transport_unavailable');}return;
  }
  if(this.state!=='waiting')return this.close(1008,'unexpected_frame');
  const input=authFrame(data);if(!input)return this.close(1008,'invalid_auth');this.state='authenticating';
  try{
   const r=await this.backend.auth(input.event_id,input.token);
   // No raw token retained in connection/hub state. Local auth frame dies here.
   if((this.state as string)==='closed')return;
   if(!r.ok&&r.status===503){this.peer.send('{"type":"service_unavailable","retry":true}');return this.close(1013,'service_unavailable');}
   if(!validAuth(r,input.event_id,this.clock.now()))return this.close(1008,'invalid_session');
   this.clock.cancel(this.timer);this.state='ready';
   this.remove=this.hubs.add(r.event_id,r.session_id,Date.parse(r.expires_at),r.revision,this.peer)??undefined;
   if(!this.remove)this.close(1013,'capacity');
  }catch{try{this.peer.send('{"type":"service_unavailable","retry":true}');}catch{/* closed */}this.close(1013,'service_unavailable');}
 }
}