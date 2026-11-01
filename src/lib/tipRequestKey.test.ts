import { it,expect } from 'vitest';
import { tipRequestKey } from './tipRequestKey';
it('retries and cross-tab reads reuse logical UUID while another amount has a new identity',()=>{
 localStorage.clear();const first=tipRequestKey('u','e','s',500);
 expect(tipRequestKey('u','e','s',500)).toBe(first);expect(tipRequestKey('u','e','s',100)).not.toBe(first);
 expect(tipRequestKey('other','e','s',500)).not.toBe(first);
});