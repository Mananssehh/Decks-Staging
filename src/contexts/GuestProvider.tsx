import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import {GuestContext} from './guest-state';
import {guestApplicationEnabled,guestStore,guestInvoke,guestSnapshot} from '@/lib/guestClient';
import {joinGuest,type GuestSession,type GuestSnapshot} from '@/lib/guestApplication';
import {useAuth} from './auth-state';
import {claimPendingGuest} from '@/lib/guestClient';
export function GuestProvider({children}:{children:ReactNode}){
 const auth=useAuth();
 const [session,setSession]=useState<GuestSession|null>(()=>guestApplicationEnabled?guestStore().current():null);
 const [snapshot,setSnapshot]=useState<GuestSnapshot|null>(null);
 useEffect(()=>{if(!auth.user||auth.user.is_anonymous||!auth.user.email_confirmed_at)return;void claimPendingGuest().then(claimed=>{if(claimed)void auth.refreshProfile();}).catch(()=>{/* preserve proof; callback/dialog can retry explicitly */});},[auth]);
 useEffect(()=>{if(!guestApplicationEnabled)return;const sync=()=>{setSession(guestStore().current());};window.addEventListener('storage',sync);window.addEventListener('decks:guest-change',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('decks:guest-change',sync);};},[]);
 const select=useCallback((s:GuestSession)=>{guestStore().select(s.event_id);setSession(s);},[]);
 const join=useCallback(async(code:string,nickname:string)=>{if(!guestApplicationEnabled)throw Error('Guest integration disabled');const s=await joinGuest(guestStore(),guestInvoke,code,nickname);select(s);return s;},[select]);
 const load=useCallback(async(s:GuestSession)=>{const data=await guestSnapshot(s);setSnapshot(data);return data;},[]);
 const value=useMemo(()=>({enabled:guestApplicationEnabled,session,snapshot,join,load,select}),[session,snapshot,join,load,select]);
 return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
}