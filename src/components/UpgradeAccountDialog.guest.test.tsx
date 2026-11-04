import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {UpgradeAccountDialog} from './UpgradeAccountDialog';
const m=vi.hoisted(()=>({signup:vi.fn(),claim:vi.fn(),intent:vi.fn(),refresh:vi.fn(),success:vi.fn(),error:vi.fn(),resend:vi.fn()}));
vi.mock('@/contexts/auth-state',()=>({useAuth:()=>({profile:null,refreshProfile:m.refresh})}));
vi.mock('@/hooks/useActor',()=>({useActor:()=>({kind:'guest',profile:{nickname:'Guest'}})}));
vi.mock('@/lib/guestClient',()=>({guestStore:()=>({intent:m.intent}),claimPendingGuest:m.claim}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{signUp:m.signup,resend:m.resend}}}));
vi.mock('sonner',()=>({toast:{success:m.success,error:m.error}}));
afterEach(cleanup);beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});
it.each([true,false])('guest signup reports confirmation state accurately (immediate claim %s) and binds intent email',async(confirmed)=>{
 m.signup.mockResolvedValue({data:{session:confirmed?{user:{email_confirmed_at:'2026-11-03'}}:null},error:null});m.claim.mockResolvedValue(confirmed);
 render(<MemoryRouter><UpgradeAccountDialog open onOpenChange={vi.fn()}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'guest@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'SafePassword123!'}});fireEvent.click(screen.getByRole('button',{name:'Create account'}));
 if(confirmed){await waitFor(()=>expect(m.success).toHaveBeenCalledOnce());expect(m.success.mock.calls[0][0]).toBe('Account created — your guest progress is linked.');}
 else {await screen.findByRole('region',{name:'Email confirmation'});expect(m.success).not.toHaveBeenCalled();expect(m.claim).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:/Resend in/})).toBeDisabled();}
 expect(m.intent).toHaveBeenCalledWith('guest@example.test');expect(m.refresh).toHaveBeenCalledTimes(confirmed?1:0);
 expect(m.signup.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/auth/callback?next=%2Fprofile`);
});