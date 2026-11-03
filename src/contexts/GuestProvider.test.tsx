import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {GuestProvider} from './GuestProvider';
import {useGuest} from './guest-state';
import {GuestStore,GuestError,type GuestSession,type GuestSnapshot} from '@/lib/guestApplication';
import ActivityLedger from '@/pages/ActivityLedger';
import Profile from '@/pages/Profile';
import PublicProfile from '@/pages/PublicProfile';
import {RequireDJ,RequireAdmin} from '@/components/guards/RouteGuards';

const m=vi.hoisted(()=>({snapshot:vi.fn(),ledger:vi.fn(),invoke:vi.fn(),claim:vi.fn(),auth:{user:null as null|{id:string},profile:null,loading:false,isDJ:false,refreshProfile:vi.fn()}}));
vi.mock('./auth-state',()=>({useAuth:()=>m.auth}));
vi.mock('@/lib/guestClient',()=>({guestApplicationEnabled:true,guestStore:()=>new GuestStore(localStorage,'test'),guestSnapshot:m.snapshot,guestInvoke:m.invoke,claimPendingGuest:m.claim,actorLedger:m.ledger,guestScope:(s:GuestSession)=>({event_id:s.event_id,token:s.token})}));
vi.mock('@/components/AppHeader',()=>({AppHeader:()=>null}));
vi.mock('@/components/SiteFooter',()=>({SiteFooter:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn(),from:vi.fn()}}));

const session=(id='event'):GuestSession=>({event_id:id,session_id:id,principal_id:'guest',token:'a'.repeat(64),expires_at:'2030-01-01',code:id,nickname:'Restored Guest'});
function snapshot(id='event'):GuestSnapshot{return {event:{id,name:id} as GuestSnapshot['event'],profile:{id:'guest',nickname:'Restored Guest',points:18},songs:[],ledger:[],now_playing:null,revision:'1'};}
function mount(page:React.ReactNode,path='/activity'){return render(<MemoryRouter initialEntries={[path]}><GuestProvider><Routes><Route path="/activity" element={page}/><Route path="/profile" element={page}/><Route path="/users/:userId" element={page}/><Route path="/auth" element={<div>Auth only</div>}/><Route path="/" element={<div>Denied home</div>}/></Routes></GuestProvider></MemoryRouter>);}
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();m.auth.user=null;m.snapshot.mockResolvedValue(snapshot());m.ledger.mockResolvedValue([{id:'tx',amount:3,type:'earned',reason:'Joined event',created_at:'2026-11-03T01:00:00Z',event_id:null,song_request_id:null}]);new GuestStore(localStorage,'test').save(session());});
afterEach(cleanup);
it('reload directly to /activity restores profile and ledger without Auth routing or repeated loads',async()=>{
 mount(<ActivityLedger/>);await screen.findByText('Joined event');expect(screen.getByText('18')).toBeTruthy();expect(screen.queryByText('Auth only')).toBeNull();expect(m.snapshot).toHaveBeenCalledTimes(1);expect(m.ledger).toHaveBeenCalledTimes(1);
});
it('restored guest profile is accessible without an Auth-only guard',async()=>{mount(<Profile/>,'/profile');await screen.findByRole('heading',{name:'Restored Guest'});expect(screen.queryByText('Auth only')).toBeNull();expect(m.snapshot).toHaveBeenCalledTimes(1);});
it.each(['dj','admin'])('restored guest cannot enter %s guards',async(role)=>{mount(role==='dj'?<RequireDJ><span>Secret</span></RequireDJ>:<RequireAdmin><span>Secret</span></RequireAdmin>);await screen.findByText(role==='dj'?'Auth only':'Denied home');expect(screen.queryByText('Secret')).toBeNull();expect(m.auth.user).toBeNull();});
it('profile restoration failure exposes retry and recovers',async()=>{m.snapshot.mockRejectedValueOnce(new GuestError(503,'temporary'));mount(<Profile/>,'/profile');await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByRole('heading',{name:'Restored Guest'});expect(m.snapshot).toHaveBeenCalledTimes(2);});
it('503 on restoration shows retry and recovers without clearing bootstrap or event proof',async()=>{
 const store=new GuestStore(localStorage,'test'),proof=store.bootstrap();m.snapshot.mockRejectedValueOnce(new GuestError(503,'temporary'));
 mount(<ActivityLedger/>);await screen.findByRole('alert');expect(screen.getByText(/temporarily unavailable/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('Joined event');expect(store.bootstrap()).toBe(proof);expect(store.current()?.token).toBe(session().token);expect(m.snapshot).toHaveBeenCalledTimes(2);
});
it('ledger failure recovers by retry; expired proof offers rejoin rather than infinite spinner',async()=>{
 m.ledger.mockRejectedValueOnce(new GuestError(503,'temporary'));mount(<ActivityLedger/>);await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('Joined event');cleanup();
 m.snapshot.mockRejectedValueOnce(new GuestError(401,'expired'));mount(<ActivityLedger/>);expect(await screen.findByRole('link',{name:'Rejoin event'})).toBeTruthy();expect(new GuestStore(localStorage,'test').current()?.token).toBe(session().token);
});
it('temporary public-profile failure is not falsely reported missing and can recover',async()=>{
 m.invoke.mockRejectedValueOnce(new GuestError(503,'temporary')).mockResolvedValue({profile:{found:true,is_public:false,nickname:'Other Guest'}});
 mount(<PublicProfile/>,'/users/other');await screen.findByRole('alert');expect(screen.queryByText('User not found')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByRole('heading',{name:'Other Guest'});
});
it('ledger filter race discards the old response',async()=>{
 let resolveOld=(rows:GuestSnapshot['ledger'])=>{};m.ledger.mockImplementationOnce(()=>new Promise<GuestSnapshot['ledger']>(r=>{resolveOld=r;})).mockResolvedValue([{id:'new',amount:-1,type:'spent',reason:'Current filter',created_at:'2026-11-03T01:00:00Z',event_id:null,song_request_id:null}]);
 mount(<ActivityLedger/>);await screen.findByRole('tab',{name:'Spent'});fireEvent.mouseDown(screen.getByRole('tab',{name:'Spent'}),{button:0,ctrlKey:false});await screen.findByText('Current filter');await act(async()=>resolveOld([{id:'old',amount:3,type:'earned',reason:'Stale response',created_at:'2026-11-03T01:00:00Z',event_id:null,song_request_id:null}]));expect(screen.queryByText('Stale response')).toBeNull();
});
function Selected(){const guest=useGuest();return <><span>{guest?.snapshot?.event.id??'empty'}</span><button onClick={()=>guest?.select(session('second'))}>Select second</button></>;}
it('selection and Auth changes cancel stale snapshot application and never reuse previous event profile',async()=>{
 let resolveFirst=(s:GuestSnapshot)=>{};m.snapshot.mockImplementationOnce(()=>new Promise<GuestSnapshot>(r=>{resolveFirst=r;})).mockResolvedValue(snapshot('second'));
 const tree=render(<GuestProvider><Selected/></GuestProvider>);await waitFor(()=>expect(m.snapshot).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByText('Select second'));await screen.findByText('second');await act(async()=>resolveFirst(snapshot('event')));expect(screen.queryByText('event')).toBeNull();
 m.auth.user={id:'registered'};tree.rerender(<GuestProvider><Selected/></GuestProvider>);await screen.findByText('empty');expect(m.snapshot).toHaveBeenCalledTimes(2);
});