import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import Join from './Join';
const m=vi.hoisted(()=>({join:vi.fn(),signup:vi.fn(),rpc:vi.fn(),invoke:vi.fn()}));
vi.mock('@/contexts/auth-state',()=>({useAuth:()=>({user:null,profile:null,isAnonymous:false,loading:false,refreshProfile:vi.fn()})}));
vi.mock('@/contexts/guest-state',()=>({useGuest:()=>({enabled:true,join:m.join})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{signInAnonymously:m.signup},rpc:m.rpc,functions:{invoke:m.invoke}}}));
vi.mock('@/components/AppHeader',()=>({AppHeader:()=>null}));
vi.mock('@/components/SiteFooter',()=>({SiteFooter:()=>null}));
vi.mock('@/components/SEO',()=>({SEO:()=>null}));
vi.mock('@/components/GuestLimitReachedDialog',()=>({GuestLimitReachedDialog:()=>null}));
it('fresh flagged Join authorizes only guest API with no anonymous Auth signup',async()=>{
 m.join.mockResolvedValue({event_id:'event'});render(<MemoryRouter initialEntries={['/join?code=ROOM1']}><Join/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText(/nickname/i),{target:{value:'Party Guest'}});
 fireEvent.submit(screen.getByLabelText(/nickname/i).closest('form') as HTMLFormElement);
 await waitFor(()=>expect(m.join).toHaveBeenCalledWith('ROOM1','Party Guest'));
 expect(m.signup).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();expect(m.invoke).not.toHaveBeenCalled();
});