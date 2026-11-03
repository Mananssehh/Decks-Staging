import {staging,type Backend,type Peer} from './protocol.ts';
import {Hubs} from './hubs.ts';
import {Connection} from './connection.ts';
export type Upgrade=(req:Request)=>{socket:Peer&{onmessage:((e:{data:unknown})=>void)|null;onclose:(()=>void)|null;onerror:(()=>void)|null};response:Response};
export function createHandler(url:string|undefined,backend:Backend|undefined,hubs:Hubs,upgrade:Upgrade){
 let sockets=0;
 return (req:Request)=>{
  if(!staging(url)||!backend)return new Response('service_unavailable',{status:503});
  if(req.method!=='GET')return new Response('method_not_allowed',{status:405});
  const parsed=new URL(req.url);
  if(parsed.search||req.headers.has('sec-websocket-protocol'))return new Response('invalid_transport',{status:400});
  if(req.headers.get('upgrade')?.toLowerCase()!=='websocket')return new Response('upgrade_required',{status:426});
  if(sockets>=1024)return new Response('capacity',{status:503});
  const {socket,response}=upgrade(req);sockets++;let done=false;
  const connection=new Connection(socket,backend,hubs);
  const cleanup=()=>{if(done)return;done=true;sockets--;connection.cleanup();};
  socket.onmessage=e=>{void connection.message(e.data);};socket.onclose=cleanup;socket.onerror=()=>{cleanup();try{socket.close(1011,'transport_unavailable');}catch{/* closed */}};
  return response;
 };
}