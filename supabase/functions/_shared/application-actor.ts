export interface ActorDeps{backendUrl:string|undefined;auth:(token:string)=>Promise<string|null>;guest:(event:string,token:string,operation:string)=>Promise<{ok?:boolean;actor_id?:string;alias_ids?:string[];status?:number}>}
export interface ResolvedActor{id:string;aliases:string[];guest:boolean;event:string|null}
export class ActorError extends Error{constructor(public status:number){super(status===503?'Service unavailable':'Unauthorized');}}
export async function resolveApplicationActor(headers:Headers,body:Record<string,unknown>,operation:string,deps:ActorDeps):Promise<ResolvedActor>{
 if(body.guest!==undefined){
  if(deps.backendUrl!=='https://ldxgejbzmpvsvozqmpfe.supabase.co')throw new ActorError(403);
  const g=body.guest as {event_id?:unknown;token?:unknown};
  if(!g||typeof g.event_id!=='string'||!/^[0-9a-f-]{36}$/i.test(g.event_id)||typeof g.token!=='string'||!/^[a-f0-9]{64}$/.test(g.token)||body.event_id!==undefined&&body.event_id!==g.event_id)throw new ActorError(401);
  const r=await deps.guest(g.event_id,g.token,operation);if(!r.ok||!r.actor_id)throw new ActorError(r.status??503);
  return {id:r.actor_id,aliases:r.alias_ids??[r.actor_id],guest:true,event:g.event_id};
 }
 const token=headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new ActorError(401);
 const id=await deps.auth(token);if(!id)throw new ActorError(401);return {id,aliases:[id],guest:false,event:null};
}
export async function boundedBody(req:Request):Promise<Record<string,unknown>>{
 const reader=req.body?.getReader();if(!reader)return {};const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>8192){await reader.cancel();throw new ActorError(413);}chunks.push(r.value);}const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ActorError(400);return parsed;}finally{reader.releaseLock();}
}