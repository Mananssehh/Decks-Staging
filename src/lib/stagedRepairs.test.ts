import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { setSongVote, transitionRequest, writeBroadcast, setQueuePosition } from './stagedRepairs';
describe('staged mutation contracts', () => {
 beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: null, error: null }); });
 it('sets desired absence rather than toggling on retries', async () => {
  await setSongVote('song',null); await setSongVote('song',null);
  expect(rpc.mock.calls).toEqual([['set_song_vote',{_song_request_id:'song',_value:null}],['set_song_vote',{_song_request_id:'song',_value:null}]]);
 });
 it('passes vote -1 without a client user identity', async () => {
  await setSongVote('song',-1);expect(rpc).toHaveBeenCalledWith('set_song_vote',{_song_request_id:'song',_value:-1});
 });
 it('makes one owner-scoped playback call', async () => {
  await transitionRequest('event','song','playing');expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('dj_transition_request',{_event_id:'event',_song_request_id:'song',_status:'playing'});
 });
 it('propagates atomic mirror failure', async () => {
  rpc.mockResolvedValue({data:null,error:{message:'mirror failure'}});
  await expect(transitionRequest('event','song','playing')).rejects.toEqual({message:'mirror failure'});
 });
 it('fails closed when broadcast result is absent',async()=>{await expect(writeBroadcast('event',{title:'Track'})).rejects.toThrow('Broadcast was not saved');});
 it('passes queue position through owner boundary',async()=>{await setQueuePosition('event','song',3);expect(rpc).toHaveBeenCalledWith('dj_set_queue_position',{_event_id:'event',_song_request_id:'song',_position:3});});
});
