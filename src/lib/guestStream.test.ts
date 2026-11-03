import {it,expect,vi,afterEach} from 'vitest';
import {connectGuestStream} from './guestStream';
import type {GuestSession} from './guestApplication';
afterEach(()=>vi.useRealTimers());
it('authenticates in first frame, resyncs reconnect, preserves503 and cleans all timers',()=>{
 vi.useFakeTimers();const sockets:WebSocket[]=[],sent:string[]=[],refresh=vi.fn(),terminal=vi.fn();
 const factory=vi.fn((url:string)=>{expect(url).not.toContain('secret');const s={readyState:1,send:(v:string)=>sent.push(v),close:vi.fn(),onopen:null,onmessage:null,onclose:null,onerror:null} as unknown as WebSocket;sockets.push(s);return s;});
 const s={event_id:'event',token:'secret',session_id:'session'} as GuestSession;
 const stop=connectGuestStream(s,refresh,terminal,'wss://example/stream',factory);
 sockets[0].onopen?.call(sockets[0],new Event('open'));expect(JSON.parse(sent[0])).toEqual({type:'auth',event_id:'event',token:'secret'});
 sockets[0].onmessage?.call(sockets[0],new MessageEvent('message',{data:'{"type":"ready","revision":"7"}'}));expect(refresh).toHaveBeenCalledTimes(1);
 sockets[0].onclose?.call(sockets[0],new CloseEvent('close',{code:1013}));vi.advanceTimersByTime(2000);expect(sockets).toHaveLength(2);expect(terminal).not.toHaveBeenCalled();
 sockets[1].onmessage?.call(sockets[1],new MessageEvent('message',{data:'{"type":"ready","revision":"9"}'}));expect(refresh).toHaveBeenCalledTimes(2);
 stop();expect(vi.getTimerCount()).toBe(0);window.dispatchEvent(new Event('online'));expect(sockets).toHaveLength(2);
});
it('terminal banned close stops reconnect and fallback without clearing credentials',()=>{
 vi.useFakeTimers();const refresh=vi.fn(),terminal=vi.fn();const s={onclose:null,close:vi.fn()} as unknown as WebSocket;const factory=vi.fn(()=>s);
 const stop=connectGuestStream({event_id:'event',token:'proof'} as GuestSession,refresh,terminal,'wss://example',factory);
 s.onclose?.call(s,new CloseEvent('close',{code:1008}));vi.advanceTimersByTime(90000);expect(terminal).toHaveBeenCalledOnce();expect(factory).toHaveBeenCalledOnce();expect(refresh).not.toHaveBeenCalled();stop();expect(vi.getTimerCount()).toBe(0);
});