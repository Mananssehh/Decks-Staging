import { it,expect } from 'vitest';
import { tipRequestKey } from './tipRequestKey';
it('retries and cross-tab reads reuse logical UUID while another amount has a new identity',()=>{
 localStorage.clear();const first=tipRequestKey('u','e','s',500);
 expect(tipRequestKey('u','e','s',500)).toBe(first);expect(tipRequestKey('u','e','s',100)).not.toBe(first);
 expect(tipRequestKey('other','e','s',500)).not.toBe(first);
});
import { clearTerminalTipKey } from './tipRequestKey';
it('only an authoritative terminal response rotates matching logical key; stale responses cannot clear a newer key',()=>{
 localStorage.clear();const first=tipRequestKey('u','e',null,500);
 clearTerminalTipKey('u','e',null,500,'stale');expect(tipRequestKey('u','e',null,500)).toBe(first);
 clearTerminalTipKey('u','e',null,500,first);const second=tipRequestKey('u','e',null,500);expect(second).not.toBe(first);
 clearTerminalTipKey('u','e',null,500,first);expect(tipRequestKey('u','e',null,500)).toBe(second);
});
