import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import Auth from './Auth';
const m=vi.hoisted(()=>({anonymous:false,signup:vi.fn(),update:vi.fn(),rpc:vi.fn(),invoke:vi.fn(),success:vi.fn(),error:vi.fn(),intent:vi.fn()}));
vi.mock('@/components/AppHeader',()=>({AppHeader:()=>null}));
vi.mock('@/contexts/auth-state',()=>({useAuth:()=>({user:m.anonymous?{id:'legacy',is_anonymous:true}:null,profile:m.anonymous?{nickname:'Guest'}:null,isAnonymous:m.anonymous,isDJ:false,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{signUp:m.signup,updateUser:m.update},rpc:m.rpc,functions:{invoke:m.invoke}}}));
vi.mock('@/lib/guestClient',()=>({guestApplicationEnabled:true,guestStore:()=>({pending:()=>({bootstrap:'proof'}),intent:m.intent})}));
vi.mock('@/lib/guestFunnel',()=>({logGuestFunnel:vi.fn()}));
vi.mock('sonner',()=>({toast:{success:m.success,error:m.error}}));
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class {observe(){}unobserve(){}disconnect(){}});sessionStorage.clear();vi.clearAllMocks();m.anonymous=false;m.signup.mockResolvedValue({data:{session:null},error:null});m.update.mockResolvedValue({data:{user:{is_anonymous:true}},error:null});});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function submit(){fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Guest QA'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'safe@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'SafePassword123!'}});fireEvent.click(screen.getByRole('button',{name:'Create account'}));await screen.findByRole('region',{name:'Email confirmation'});}
it('DJ signup without session persists onboarding confirmation and never welcomes or sends managed mail',async()=>{
 render(<MemoryRouter initialEntries={['/auth?role=dj']}><Auth/></MemoryRouter>);await submit();expect(m.signup.mock.calls[0][0].options.emailRedirectTo).toBe(`${location.origin}/auth/callback?next=%2Fdj%2Fonboarding`);expect(m.success).not.toHaveBeenCalled();expect(m.invoke).not.toHaveBeenCalled();cleanup();render(<MemoryRouter><Auth/></MemoryRouter>);expect(screen.getByRole('region',{name:'Email confirmation'})).toBeInTheDocument();
});
it('legacy anonymous update has confirmation redirect and defers profile completion until verification',async()=>{
 m.anonymous=true;render(<MemoryRouter initialEntries={['/auth?next=%2Fevent%2FGUESTQB']}><Auth/></MemoryRouter>);await submit();expect(m.update).toHaveBeenCalledWith({email:'safe@example.test',password:'SafePassword123!'},{emailRedirectTo:`${location.origin}/auth/callback?next=%2Fevent%2FGUESTQB`});expect(m.rpc).not.toHaveBeenCalled();expect(m.success).not.toHaveBeenCalled();expect(m.invoke).not.toHaveBeenCalled();
});
it('signup failure leaves form available and does not invent confirmation',async()=>{
 m.signup.mockResolvedValue({data:{session:null},error:new Error('Signup refused')});render(<MemoryRouter initialEntries={['/auth?role=dj']}><Auth/></MemoryRouter>);fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Guest QA'}});fireEvent.change(screen.getByLabelText('Email'),{target:{value:'safe@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'SafePassword123!'}});fireEvent.click(screen.getByRole('button',{name:'Create account'}));await waitFor(()=>expect(m.error).toHaveBeenCalledWith('Signup refused'));expect(screen.queryByRole('region',{name:'Email confirmation'})).not.toBeInTheDocument();
});