import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {TipDialog} from './TipDialog';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),consent:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},functions:{invoke:mocks.invoke}}}));
vi.mock('@/lib/consent',()=>({recordConsent:mocks.consent,CURRENT_CONSENT_VERSION:'v2-tips-2026-06-12'}));
vi.mock('sonner',()=>({toast:{error:mocks.error,success:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();});
it('double click and ambiguous retry reuse one logical key; definitive terminal checkout permits a new key',async()=>{
 let finish:((v:unknown)=>void)|undefined;const calls:Record<string,unknown>[]=[];
 mocks.invoke.mockImplementation((_name:string,opts:{body:Record<string,unknown>})=>{
  if(opts.body.check_only)return Promise.resolve({data:{ready:true},error:null});
  calls.push(opts.body);return new Promise(resolve=>{finish=resolve;});
 });
 render(<TipDialog open eventId="event" onOpenChange={()=>{}}/>);
 await waitFor(()=>expect(mocks.invoke).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('checkbox'));
 const button=screen.getByRole('button',{name:'Tip $5'});
 fireEvent.click(button);fireEvent.click(button);
 await waitFor(()=>expect(calls.length).toBe(1));expect(calls[0].amount_cents).toBe(500);
 if(!finish)throw Error('request missing');finish({data:{error_code:'CHECKOUT_AMBIGUOUS'},error:null});
 await waitFor(()=>expect(button).not.toBeDisabled());fireEvent.click(button);
 await waitFor(()=>expect(calls.length).toBe(2));expect(calls[1].request_key).toBe(calls[0].request_key);
 if(!finish)throw Error('request missing');finish({data:{error_code:'CHECKOUT_TERMINAL',terminal:true},error:null});
 await waitFor(()=>expect(button).not.toBeDisabled());fireEvent.click(button);
 await waitFor(()=>expect(calls.length).toBe(3));expect(calls[2].request_key).not.toBe(calls[0].request_key);
 if(!finish)throw Error('request missing');finish({data:{error_code:'RECONCILIATION_REQUIRED'},error:null});
});
