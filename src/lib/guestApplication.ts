import type { SongRequestRow } from '@/components/SongRequestCard';
import type { NowPlayingRow } from '@/lib/nowPlaying';
export const GUEST_BACKEND='ldxgejbzmpvsvozqmpfe';
export const ENABLE_GUEST_APPLICATION=false;
export function guestEnabled(backend:string,flag=ENABLE_GUEST_APPLICATION){return flag&&backend===GUEST_BACKEND;}
export interface GuestSession{principal_id:string;session_id:string;event_id:string;token:string;expires_at:string;code:string;nickname:string}
export interface GuestSnapshot{
 revision:string;event:{id:string;name:string;venue:string|null;dj_name:string;is_active:boolean;requests_status:'live'|'paused'|'ended';allow_explicit:boolean;require_approval:boolean;cooldown_seconds:number;rules_text:string|null};
 profile:{id:string;nickname:string;points:number;is_premium?:boolean;is_public?:boolean};
 songs:(SongRequestRow&{is_mine:boolean;my_vote:1|-1|null;profile_linkable?:boolean})[];now_playing:NowPlayingRow|null;
 ledger:{id:string;amount:number;type:'earned'|'spent'|'refunded'|'manual_adjustment';reason:string;created_at:string;event_id:string|null;song_request_id:string|null}[];
}
export class GuestError extends Error{constructor(public status:number,public code:string){super(status===503?'Service temporarily unavailable. Please retry later.':status===401?'This event session is unavailable.':status===429?'Please wait before trying again.':code.replace(/_/g,' '));}}
export function secureBootstrap(storage:Storage,backend:string){
 const key=`decks:guest:${backend}:bootstrap`,saved=storage.getItem(key);if(saved&&/^[0-9a-f]{64}$/.test(saved))return saved;
 const bytes=crypto.getRandomValues(new Uint8Array(32)),secret=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');storage.setItem(key,secret);return secret;
}
export class GuestStore{
 readonly prefix:string;
 constructor(readonly storage:Storage,readonly backend:string){this.prefix=`decks:guest:${backend}:`;}
 bootstrap(){return secureBootstrap(this.storage,this.backend);}
 sessions():GuestSession[]{try{return JSON.parse(this.storage.getItem(this.prefix+'sessions')??'[]').filter((s:GuestSession)=>typeof s.token==='string'&&/^[a-f0-9]{64}$/.test(s.token)&&typeof s.event_id==='string');}catch{return [];}}
 save(session:GuestSession){this.storage.setItem(this.prefix+'sessions',JSON.stringify([...this.sessions().filter(s=>s.event_id!==session.event_id),session]));}
 byCode(code:string){return this.sessions().find(s=>s.code===code.toUpperCase());}
 current(){const id=this.storage.getItem(this.prefix+'current');return this.sessions().find(s=>s.event_id===id)??this.sessions().at(-1)??null;}
 select(event:string){this.storage.setItem(this.prefix+'current',event);}
 intent(email?:string){this.storage.setItem(this.prefix+'claim',JSON.stringify({bootstrap:this.bootstrap(),requested_at:Date.now(),email:email?.trim().toLowerCase()}));}
 pending(){try{const p=JSON.parse(this.storage.getItem(this.prefix+'claim')??'null');return p&&/^[a-f0-9]{64}$/.test(p.bootstrap)?p as {bootstrap:string;requested_at:number;email?:string}:null;}catch{return null;}}
 completeClaim(){this.storage.removeItem(this.prefix+'claim');this.storage.removeItem(this.prefix+'sessions');this.storage.removeItem(this.prefix+'current');this.storage.removeItem(this.prefix+'bootstrap');}
}
export type Invoke=(action:string,payload:Record<string,unknown>)=>Promise<Record<string,unknown>>;
export async function joinGuest(store:GuestStore,invoke:Invoke,code:string,nickname:string){
 const r=await invoke('join',{bootstrap:store.bootstrap(),code,nickname});
 const s={...r,code:code.toUpperCase(),nickname} as unknown as GuestSession;
 if(typeof s.token!=='string'||typeof s.principal_id!=='string'||typeof s.event_id!=='string')throw new GuestError(503,'invalid_response');
 store.save(s);store.select(s.event_id);return s;
}
export function safeHttps(value:string|null|undefined){if(!value)return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}