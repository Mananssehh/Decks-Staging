import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {MemoryRouter,Routes,Route,useParams} from 'react-router-dom';
import ActivityLedger from './ActivityLedger';
const KNOWN='f5290e13-b1e8-49e0-8632-75c71563b024',UNKNOWN='0b7c1f0e-0000-4000-8000-000000000001';
const session={principal_id:'p',session_id:'s',event_id:KNOWN,token:'a'.repeat(64),expires_at:'2099-01-01',code:'GUESTQB',nickname:'Guest'};
vi.mock('@/contexts/auth-state',()=>({useAuth:()=>({user:null,loading:false})}));
vi.mock('@/hooks/useActor',()=>({useActor:()=>({id:'p',profile:{nickname:'Guest',points:16},guest:{session}})}));
vi.mock('@/lib/guestClient',()=>({guestApplicationEnabled:true,guestStore:()=>({sessions:()=>[session],contextEvent:()=>null}),actorLedger:vi.fn(async()=>[
 {id:'1',amount:10,type:'earned',reason:'Joined event',created_at:'2026-11-04T00:00:00Z',event_id:KNOWN,song_request_id:null},
 {id:'2',amount:5,type:'earned',reason:'Other event',created_at:'2026-11-04T00:00:00Z',event_id:UNKNOWN,song_request_id:null}])}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/components/AppHeader',()=>({AppHeader:()=>null}));
vi.mock('@/components/SiteFooter',()=>({SiteFooter:()=>null}));
vi.mock('@/components/GuestRecovery',()=>({GuestRecovery:()=>null}));
function Ev(){return <div>event:{useParams().code}</div>;}
it('links own ledger events by known room code and leaves unknown events unlinked',async()=>{
 render(<MemoryRouter initialEntries={['/profile/activity']}><Routes><Route path="/profile/activity" element={<ActivityLedger/>}/><Route path="/event/:code" element={<Ev/>}/></Routes></MemoryRouter>);
 const other=await screen.findByText('Other event');
 expect(other.closest('a')).toBeNull();
 expect(document.querySelector(`a[href*="${KNOWN}"]`)).toBeNull();
 fireEvent.click(screen.getByText('Joined event'));
 await waitFor(()=>expect(screen.getByText('event:GUESTQB')).toBeTruthy());
});
