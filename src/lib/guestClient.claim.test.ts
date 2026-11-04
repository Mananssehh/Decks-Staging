import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:m.session},rpc:m.rpc}}));
vi.mock('./guestApplication',async(importOriginal)=>({...await importOriginal<typeof import('./guestApplication')>(),guestEnabled:()=>true}));
import {claimPendingGuest,guestStore} from './guestClient';
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();guestStore().intent('expected@example.test');m.rpc.mockResolvedValue({data:{ok:true},error:null});});
it.each([
 {id:'other',email:'unrelated@example.test',email_confirmed_at:'now',is_anonymous:false},
 {id:'anonymous',email:'expected@example.test',email_confirmed_at:'now',is_anonymous:true},
 {id:'unconfirmed',email:'expected@example.test',is_anonymous:false},
])('never claims an unrelated, anonymous or unconfirmed session',async(user)=>{m.session.mockResolvedValue({data:{user},error:null});expect(await claimPendingGuest()).toBe(false);expect(m.rpc).not.toHaveBeenCalled();expect(guestStore().pending()).not.toBeNull();});
it('only matching confirmed registered account claims; failed claim retains proof until confirmed retry',async()=>{
 m.session.mockResolvedValue({data:{user:{id:'target',email:'EXPECTED@example.test',email_confirmed_at:'now',is_anonymous:false}},error:null});
 const proof=guestStore().pending()?.bootstrap;m.rpc.mockResolvedValueOnce({data:null,error:{message:'unavailable'}});await expect(claimPendingGuest()).rejects.toThrow();expect(guestStore().pending()?.bootstrap).toBe(proof);expect(await claimPendingGuest()).toBe(true);expect(m.rpc).toHaveBeenLastCalledWith('claim_guest_principal',{_bootstrap:proof});expect(guestStore().pending()).toBeNull();
});
it('auth verification failure retains pending proof without claiming',async()=>{m.session.mockResolvedValue({data:{user:null},error:{message:'invalid session'}});expect(await claimPendingGuest()).toBe(false);expect(m.rpc).not.toHaveBeenCalled();expect(guestStore().pending()).not.toBeNull();});