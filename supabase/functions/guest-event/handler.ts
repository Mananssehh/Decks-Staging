// Staging endpoint. Tokens never reach URLs, logs or analytics.
import {boundedBody,ActorError} from '../_shared/application-actor.ts';
export const CONTRACT = 'guest-integration-v1';
const HOST = 'ldxgejbzmpvsvozqmpfe.supabase.co';
const actions = ['contract','join','resume','snapshot','request','vote','remove','profile','ledger','report','funnel','consent','public_profile','tip_summary'] as const;
export type Action = typeof actions[number];
export type Rpc = (action: Action, payload: Record<string, unknown>) => Promise<{data: unknown; error: unknown; status?: number}>;
export type Log = (entry: Record<string, string|number>) => void;
export interface Dependencies { url?: string; rpc?: Rpc; log?: Log; id?: () => string }
// Allowlisted upstream diagnostics: operation, SQLSTATE/PostgREST code, category, status, duration and a
// random correlation ID only. Never payloads, tokens, bootstraps, codes, SQL details, raw messages or PII.
const sqlstate=/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;
const categories: Record<string,string>={'57014':'statement_timeout','55P03':'lock_timeout','40P01':'deadlock','40001':'serialization','53300':'too_many_connections','57P01':'admin_shutdown','PGRST003':'pool_timeout','PGRST000':'db_unreachable','PGRST001':'db_unreachable'};
export function diagnose(error: unknown, status?: number){
 const raw=error && typeof error==='object' ? (error as {code?: unknown}).code : undefined;
 const code=typeof raw==='string' && sqlstate.test(raw) ? raw : 'none';
 const upstream=Number.isInteger(status) && Number(status)>=100 && Number(status)<=599 ? Number(status) : 0;
 const category=categories[code] ?? (code.startsWith('08')?'connection':code.startsWith('53')?'resources':upstream===504?'gateway_timeout':code!=='none'?'sql_error':'transport');
 return {sqlstate:code,category,upstream_status:upstream};
}
const defaultLog: Log=(entry)=>console.error(JSON.stringify(entry));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret = /^[0-9a-f]{64}$/;
// Exact staging browser origins only: no wildcard, suffix, subdomain or substring matching.
export const ALLOWED_ORIGINS: readonly string[] = ['https://decks-staging.lovable.app','https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app'];
const base = {'Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Expose-Headers':'x-correlation-id','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
/** null = no Origin header (non-browser caller, no CORS grant); false = browser origin outside the allowlist. */
export function allowedOrigin(req: Request): string|null|false { const o=req.headers.get('origin'); if(o===null)return null; return ALLOWED_ORIGINS.includes(o)?o:false; }
export function staging(url?: string) { try { const u=new URL(url ?? ''); return u.protocol==='https:' && u.hostname===HOST && !u.port && !u.username && !u.password && u.pathname==='/'; } catch {return false;} }
type Cors=Record<string,string>;
const response=(cors: Cors,status: number,body: unknown,extra: Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...cors,...extra}});
const object=(v: unknown): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
export function validate(action: Action,p: Record<string,unknown>): Record<string,unknown>|null {
 const out: Record<string,unknown>={};
 const text=(key:string,max:number,required=false,pattern?:RegExp)=>{const v=p[key];if(v===undefined)return !required;if(typeof v!=='string'||v.length>max||(pattern&&!pattern.test(v)))return false;out[key]=v;return true;};
 if(action==='contract')return out;
 if(action==='join')return text('bootstrap',64,true,secret)&&text('code',64,true)&&text('nickname',24,true)?out:null;
 if(!text('event_id',36,true,uuid)||!text('token',64,true,secret))return null;
 if(action==='request'){
  if(!text('idempotency_key',36,true,uuid)||!text('source_platform',32,true)||!text('source_song_id',512,true)||!text('title',200,true)||!text('artist',200,true))return null;
  for(const k of ['album','album_art_url','preview_url','external_url'])if(!text(k,k==='album'?200:2048))return null;
  if(p.duration_ms!==undefined){if(!Number.isInteger(p.duration_ms)||Number(p.duration_ms)<0||Number(p.duration_ms)>86400000)return null;out.duration_ms=p.duration_ms;}
  if(p.explicit!==undefined){if(typeof p.explicit!=='boolean')return null;out.explicit=p.explicit;}
 }
 if(action==='vote'||action==='remove'){if(!text('request_id',36,true,uuid))return null;if(action==='vote'){if(p.value!==-1&&p.value!==0&&p.value!==1)return null;out.value=p.value;}}
 if(action==='profile'&&!text('nickname',24))return null;
 if(action==='profile'&&p.is_public!==undefined){if(typeof p.is_public!=='boolean')return null;out.is_public=p.is_public;}
 if(action==='public_profile'&&!text('target_id',36,true,uuid))return null;
 if(action==='ledger'){if(p.offset!==undefined){if(!Number.isInteger(p.offset)||Number(p.offset)<0||Number(p.offset)>100000)return null;out.offset=p.offset;}if(!text('filter',16))return null;}
 if(action==='report'&&(!text('target_id',36,true,uuid)||!text('target_type',16,true)||!text('reason',32,true)||!text('details',500)))return null;
 if(action==='funnel'&&!text('event_type',40,true))return null;
 return out;
}
export function createHandler(deps: Dependencies){return async(req:Request):Promise<Response>=>{
 const origin=allowedOrigin(req);
 // Unsupported browser origins are refused before any body read, validation or backend call.
 if(origin===false)return new Response(req.method==='OPTIONS'?null:JSON.stringify({ok:false,status:403,error:'origin_not_allowed'}),{status:403,headers:base});
 const cors: Cors=origin?{...base,'Access-Control-Allow-Origin':origin}:base;
 const fail=(status: number,error: string,extra: Record<string,string>={})=>response(cors,status,{ok:false,status,error},extra);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!staging(deps.url)||!deps.rpc)return fail(503,'guest_unavailable');
 if(req.method!=='POST')return fail(405,'method_not_allowed');
 let b:unknown;try{b=await boundedBody(req);}catch(e){return e instanceof ActorError?fail(e.status,e.status===413?'payload_too_large':'invalid_json'):fail(503,'upstream_unavailable');}
 if(!object(b)||typeof b.action!=='string'||!(actions as readonly string[]).includes(b.action)||!object(b.payload??{}))return fail(400,'invalid_action');
 const action=b.action as Action,p=validate(action,(b.payload??{}) as Record<string,unknown>);if(!p)return fail(400,'invalid_input');
 const started=Date.now(),log=deps.log??defaultLog;
 const upstream=(d:{sqlstate:string;category:string;upstream_status:number})=>{const cid=(deps.id??(()=>crypto.randomUUID()))();
  try{log({evt:'guest_event_upstream',cid,action,...d,ms:Date.now()-started});}catch{/* logging never changes the response */}
  return fail(503,'upstream_unavailable',{'x-correlation-id':cid});};
 try{const r=await deps.rpc(action,p);if(r.error)return upstream(diagnose(r.error,r.status));if(!object(r.data))return upstream({sqlstate:'none',category:'invalid_response',upstream_status:0});
 if(r.data.ok===true)return response(cors,200,r.data);
 const status=Number(r.data.status);if(!Number.isInteger(status)||status<400||status>599)return upstream({sqlstate:'none',category:'invalid_response',upstream_status:0});
 const error=typeof r.data.error==='string'&&/^[a-z_]{1,64}$/.test(r.data.error)?r.data.error:'upstream_unavailable';
 return fail(status,error);
 }catch{return upstream({sqlstate:'none',category:'transport',upstream_status:0});}
};}
