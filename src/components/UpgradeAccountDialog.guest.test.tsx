import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {UpgradeAccountDialog} from './UpgradeAccountDialog';
const m=vi.hoisted(()=>({signup:vi.fn(),claim:vi.fn(),intent:vi.fn(),refresh:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/contexts/auth-state',()=>({useAuth:()=>({profile:null,refreshProfile:m.refresh})}));
vi.mock('@/hooks/useActor',()=>({useActor:()=>({kind:'guest',profile:{nickname:'Guest'}})}));
vi.mock('@/lib/guestClient',()=>({guestStore:()=>({intent:m.intent}),claimPendingGuest:m.claim}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{signUp:m.signup}}}));
vi.mock('sonner',()=>({toast:{success:m.success,error:m.error}}));
afterEach(cleanup);beforeEach(()=>vi.clearAllMocks());
it.each([true,false])('guest signup reports confirmation state accurately (immediate claim %s) and binds intent email',async(confirmed)=>{
 m.signup.mockResolvedValue({data:{session:confirmed?{user:{email_confirmed_at:'2026-11-03'}}:null},error:null});m.claim.mockResolvedValue(confirmed);
 render(<MemoryRouter><UpgradeAccountDialog open onOpenChange={vi.fn()}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'guest@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'SafePassword123!'}});fireEvent.click(screen.getByRole('button',{name:'Create account'}));
 await waitFor(()=>expect(m.success).toHaveBeenCalledOnce());expect(m.intent).toHaveBeenCalledWith('guest@example.test');expect(m.success.mock.calls[0][0]).toBe(confirmed?'Account created — your guest progress is linked.':'Check your email to confirm your account. Your guest progress stays saved until linking completes.');expect(m.refresh).toHaveBeenCalledTimes(confirmed?1:0);
});