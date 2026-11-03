export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function staging(url:string|undefined){return url==='https://ldxgejbzmpvsvozqmpfe.supabase.co';}
export function frame(data:unknown):Record<string,unknown>|null{
 if(typeof data!=='string'||new TextEncoder().encode(data).length>4096)return null;
 try{const x=JSON.parse(data);return x&&typeof x==='object'&&!Array.isArray(x)?x:null;}catch{return null;}
}
export function authFrame(data:unknown){
 const x=frame(data);
 if(!x||Object.keys(x).sort().join(',')!=='event_id,token,type'||x.type!=='auth'||typeof x.event_id!=='string'||!UUID.test(x.event_id)||typeof x.token!=='string'||!/^[0-9a-f]{64}$/.test(x.token))return null;
 return {event_id:x.event_id,token:x.token};
}
export type AuthResult={ok:true;session_id:string;actor_id:string;event_id:string;expires_at:string;revision:string}|{ok:false;status:number};
export type PollResult={ok:true;event_id:string;revision:string;valid_session_ids:string[];lifecycle:string}|{ok:false;status:number};
export interface Backend{auth(event:string,token:string):Promise<AuthResult>;poll(event:string,sessions:string[]):Promise<PollResult>}
export interface Peer{bufferedAmount:number;send(message:string):void;close(code:number,reason:string):void}
export interface Clock{now():number;later(fn:()=>void,ms:number):unknown;cancel(timer:unknown):void}
export const clock:Clock={now:()=>Date.now(),later:(fn,ms)=>setTimeout(fn,ms),cancel:t=>clearTimeout(t as ReturnType<typeof setTimeout>)};
export function validAuth(r:AuthResult,event:string,now:number):r is Extract<AuthResult,{ok:true}>{return r.ok&&r.event_id===event&&UUID.test(r.session_id)&&UUID.test(r.actor_id)&&/^\d+$/.test(r.revision)&&Date.parse(r.expires_at)>now;}