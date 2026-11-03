import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {GuestContext} from './guest-state';
import {guestApplicationEnabled,guestStore,guestInvoke,guestSnapshot} from '@/lib/guestClient';
import {joinGuest,type GuestSession,type GuestSnapshot} from '@/lib/guestApplication';
import {useAuth} from './auth-state';
import {claimPendingGuest} from '@/lib/guestClient';
export function GuestProvider({children}:{children:ReactNode}){
 const auth=useAuth();
 const [session,setSession]=useState<GuestSession|null>(()=>guestApplicationEnabled?guestStore().current():null);
 const [result,setResult]=useState<{key:string;data:GuestSnapshot}|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState<Error|null>(null);
 const [attempt,setAttempt]=useState(0);
 const key=!auth.user&&session?session.event_id+':'+session.session_id+':'+session.token:null;
 const selected=useRef(key);selected.current=key;
 const inflight=useRef(new Map<string,Promise<GuestSnapshot>>());
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const snapshot=result?.key===key?result.data:null;
 const authUser=auth.user;const refreshProfile=auth.refreshProfile;
 useEffect(()=>{if(!authUser||authUser.is_anonymous||!authUser.email_confirmed_at)return;void claimPendingGuest().then(async claimed=>{if(claimed)await refreshProfile();}).catch(()=>{/* preserve proof; callback/dialog can retry explicitly */});},[authUser,refreshProfile]);
 useEffect(()=>{if(!guestApplicationEnabled)return;const sync=()=>{setSession(guestStore().current());};window.addEventListener('storage',sync);window.addEventListener('decks:guest-change',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('decks:guest-change',sync);};},[]);
 const select=useCallback((s:GuestSession)=>{guestStore().select(s.event_id);setSession(prev=>prev?.event_id===s.event_id&&prev?.token===s.token?prev:s);},[]);
 const join=useCallback(async(code:string,nickname:string)=>{if(!guestApplicationEnabled)throw Error('Guest integration disabled');const s=await joinGuest(guestStore(),guestInvoke,code,nickname);select(s);return s;},[select]);
 const load=useCallback(async(s:GuestSession)=>{
  const requestKey=s.event_id+':'+s.session_id+':'+s.token;
  let pending=inflight.current.get(requestKey);
  if(!pending){pending=guestSnapshot(s);inflight.current.set(requestKey,pending);}
  try{const data=await pending;if(mounted.current&&selected.current===requestKey){setResult({key:requestKey,data});setError(null);}return data;}
  catch(e){if(mounted.current&&selected.current===requestKey)setError(e instanceof Error?e:Error('Could not load guest profile.'));throw e;}
  finally{if(inflight.current.get(requestKey)===pending)inflight.current.delete(requestKey);}
 },[]);
 useEffect(()=>{
  setError(null);if(!key||!session||auth.loading){setLoading(false);return;}
  let cancelled=false;setLoading(true);
  void load(session).catch(()=>{/* load exposes the typed error without erasing proof */}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 // Session identity, not object identity, governs restoration and cancellation.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,auth.loading,attempt,load]);
 const retry=useCallback(()=>setAttempt(n=>n+1),[]);
 const value=useMemo(()=>({enabled:guestApplicationEnabled,session,snapshot,loading,error,retry,join,load,select}),[session,snapshot,loading,error,retry,join,load,select]);
 return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
}