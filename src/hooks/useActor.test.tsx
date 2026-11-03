import {renderHook} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {useActor} from './useActor';
const state=vi.hoisted(()=>({auth:{user:null as null|{id:string},isDJ:true,profile:null,isAnonymous:false,loading:false},guest:{enabled:true,session:{principal_id:'guest'},snapshot:{profile:{id:'guest',points:15}}}}));
vi.mock('@/contexts/auth-state',()=>({useAuth:()=>state.auth}));
vi.mock('@/contexts/guest-state',()=>({useGuest:()=>state.guest}));
it('guest is never an Auth user or DJ even with stale role state',()=>{state.auth.user=null;const {result}=renderHook(()=>useActor());expect(result.current.kind).toBe('guest');expect(result.current.isDJ).toBe(false);expect(result.current.auth.user).toBeNull();expect(result.current.id).toBe('guest');});
it('real legacy Auth takes precedence over stored guest credential',()=>{state.auth.user={id:'legacy'};const {result}=renderHook(()=>useActor());expect(result.current.kind).toBe('auth');expect(result.current.id).toBe('legacy');expect(result.current.guest).toBeNull();state.auth.user=null;});