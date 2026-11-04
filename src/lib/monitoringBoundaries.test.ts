import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({invoke:vi.fn(),rpc:vi.fn(),finish:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:m.invoke},rpc:m.rpc}}));
vi.mock('./monitoring',()=>({beginMonitoring:()=>m.finish,monitored:async(_action:string,op:()=>Promise<unknown>)=>op()}));
import {guestInvoke} from './guestClient';
import {searchMusic,RateLimitedError} from './musicSearch';
beforeEach(()=>vi.clearAllMocks());
describe('shared actor monitoring preserves outcomes without provider calls',()=>{
 it('reports guest typed 503 before throwing, never passing payload/proof to telemetry',async()=>{
  m.invoke.mockResolvedValue({data:{ok:false,status:503,error:'upstream_unavailable'},error:null});
  await expect(guestInvoke('vote',{token:'PRIVATE',request_id:'PRIVATE'})).rejects.toMatchObject({status:503,code:'upstream_unavailable'});
  expect(m.finish).toHaveBeenCalledExactlyOnceWith('server',503);expect(JSON.stringify(m.finish.mock.calls)).not.toContain('PRIVATE');
 });
 it('preserves acknowledgement object and treats cooldown as business outcome',async()=>{
  const result={ok:true,outcome:'created',request_id:'PRIVATE'};m.invoke.mockResolvedValue({data:result,error:null});
  await expect(guestInvoke('request',{})).resolves.toBe(result);expect(m.finish).toHaveBeenCalledWith('success');
  m.finish.mockClear();m.invoke.mockResolvedValue({data:{ok:true,outcome:'cooldown'},error:null});
  await expect(guestInvoke('request',{})).resolves.toMatchObject({outcome:'cooldown'});expect(m.finish).toHaveBeenCalledWith('business_rejection');
 });
 it('does not invoke search for short input and preserves transport errors/rate limit',async()=>{
  await expect(searchMusic('x')).resolves.toEqual({provider:'none',results:[]});expect(m.invoke).not.toHaveBeenCalled();
  const error=new TypeError('private transport error');m.invoke.mockResolvedValue({data:null,error});await expect(searchMusic('track')).rejects.toBe(error);
  m.invoke.mockResolvedValue({data:{error:'rate_limited'},error:null});await expect(searchMusic('track')).rejects.toBeInstanceOf(RateLimitedError);
 });
});