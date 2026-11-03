// Source-only staging endpoint. Tokens never reach URLs, logs or analytics.
export const CONTRACT = 'guest-integration-v1';
const HOST = 'ldxgejbzmpvsvozqmpfe.supabase.co';
const actions = ['contract','join','resume','snapshot','request','vote','remove','profile','ledger','report','funnel','consent','public_profile','tip_summary'] as const;
export type Action = typeof actions[number];
export type Rpc = (action: Action, payload: Record<string, unknown>) => Promise<{data: unknown; error: unknown}>;
export interface Dependencies { url?: string; rpc?: Rpc }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret = /^[0-9a-f]{64}$/;
const headers = {'Access-Control-Allow-Origin':'https://id-preview--3bde3db6-ee77-4460-95f2-891bb19a0278.lovable.app','Access-Control-Allow-Headers':'content-type,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
export function staging(url?: string) { try { const u=new URL(url ?? ''); return u.protocol==='https:' && u.hostname===HOST && !u.port && !u.username && !u.password && u.pathname==='/'; } catch {return false;} }
const response=(status: number,body: unknown)=>new Response(JSON.stringify(body),{status,headers});
const fail=(status: number,error: string)=>response(status,{ok:false,status,error});
const object=(v: unknown): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
export async function bounded(req: Request): Promise<string|null> {
 const reader=req.body?.getReader(); if(!reader)return '';
 const chunks: Uint8Array[]=[]; let size=0;
 try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return null;}chunks.push(value);}
 const bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }catch{await reader.cancel().catch(()=>{});return null;}finally{reader.releaseLock();}
}
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
 if(action==='report'&&(!text('target_id',36,true,uuid)||!text('target_type',16,true)||!text('reason',32,true)||!text('details',500)))return null;
 if(action==='funnel'&&!text('event_type',40,true))return null;
 return out;
}
export function createHandler(deps: Dependencies){return async(req:Request):Promise<Response>=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!staging(deps.url)||!deps.rpc)return fail(503,'guest_unavailable');
 if(req.method!=='POST')return fail(405,'method_not_allowed');
 const raw=await bounded(req);if(raw===null)return fail(413,'payload_too_large');
 let b:unknown;try{b=JSON.parse(raw);}catch{return fail(400,'invalid_json');}
 if(!object(b)||typeof b.action!=='string'||!(actions as readonly string[]).includes(b.action)||!object(b.payload??{}))return fail(400,'invalid_action');
 const action=b.action as Action,p=validate(action,(b.payload??{}) as Record<string,unknown>);if(!p)return fail(400,'invalid_input');
 try{const r=await deps.rpc(action,p);if(r.error||!object(r.data))return fail(503,'upstream_unavailable');
 if(r.data.ok===true)return response(200,r.data);
 const status=Number(r.data.status);if(!Number.isInteger(status)||status<400||status>599)return fail(503,'upstream_unavailable');
 const error=typeof r.data.error==='string'&&/^[a-z_]{1,64}$/.test(r.data.error)?r.data.error:'upstream_unavailable';
 return fail(status,error);
 }catch{return fail(503,'upstream_unavailable');}
};}
