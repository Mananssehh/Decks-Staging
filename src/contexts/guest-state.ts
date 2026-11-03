import {createContext,useContext} from 'react';
import type {GuestSession,GuestSnapshot} from '@/lib/guestApplication';
export interface GuestState{enabled:boolean;session:GuestSession|null;snapshot:GuestSnapshot|null;join:(code:string,nickname:string)=>Promise<GuestSession>;load:(session:GuestSession)=>Promise<GuestSnapshot>;select:(session:GuestSession)=>void}
export const GuestContext=createContext<GuestState|null>(null);
export function useGuest(){return useContext(GuestContext);}