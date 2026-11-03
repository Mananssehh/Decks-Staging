import {supabase} from '@/integrations/supabase/client';
import {GuestError,GuestStore,guestEnabled,type GuestSession,type GuestSnapshot} from './guestApplication';
export const guestApplicationEnabled=guestEnabled(import.meta.env.VITE_SUPABASE_PROJECT_ID);
export function guestStore(){return new GuestStore(localStorage,import.meta.env.VITE_SUPABASE_PROJECT_ID);}
export async function guestInvoke(action:string,payload:Record<string,unknown>):Promise<Record<string,unknown>>{
 const {data,error}=await supabase.functions.invoke('guest-event',{body:{action,payload}});
 let result=data;if(!result&&error&&'context' in error){try{result=await (error.context as Response).json();}catch{/* typed unavailable below */}}
 if(!result||result.ok!==true)throw new GuestError(result?.status??503,result?.error??'service_unavailable');return result;
}
export function guestScope(session:GuestSession){return {event_id:session.event_id,token:session.token};}
export async function guestSnapshot(session:GuestSession){return (await guestInvoke('snapshot',guestScope(session))).snapshot as unknown as GuestSnapshot;}
// Staged generated types remain actual hosted schema; reviewed RPC names are isolated here.
type RpcResult={data:unknown;error:{message:string}|null};
const applicationRpc=supabase.rpc as unknown as (name:string,args?:Record<string,unknown>)=>Promise<RpcResult>;
export async function ownEventSnapshot(event:string){const r=await applicationRpc('get_my_event_snapshot',{_event_id:event});if(r.error)throw Error(r.error.message);const p=r.data as {ok:boolean;snapshot:GuestSnapshot;error:string};if(!p?.ok)throw Error(p?.error??'Snapshot unavailable');return p.snapshot;}
export async function claimPendingGuest(){
 if(!guestApplicationEnabled)return false;
 const store=guestStore(),intent=store.pending();if(!intent)return false;
 const {data}=await supabase.auth.getSession(),user=data.session?.user;
 if(!user||user.is_anonymous||!user.email_confirmed_at)return false;
 const r=await applicationRpc('claim_guest_principal',{_bootstrap:intent.bootstrap});const p=r.data as {ok?:boolean};
 if(r.error||!p?.ok)throw Error('Guest progress could not be linked. Your guest credentials are still saved.');
 store.completeClaim();window.dispatchEvent(new Event('decks:guest-change'));return true;
}
export async function ownAliases(){if(!guestApplicationEnabled)return [];const r=await applicationRpc('get_my_principal_aliases');return Array.isArray(r.data)?r.data as string[]:[];}